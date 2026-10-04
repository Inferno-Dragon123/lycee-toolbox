#!/usr/bin/python3
# lycee-managed: encrypted COS offsite backup v1
"""Upload an existing age archive; only report success after remote readback.

No bucket creation, listing, deletion, plaintext upload, redirects or SDK dependency.
The caller must encrypt a restore-verified backup before invoking this command.
COS uses its native q-sign-* HMAC-SHA1 signature, not AWS Signature V4.
Protocol: https://cloud.tencent.com/document/product/436/7778
Reference: https://github.com/tencentyun/cos-python-sdk-v5/blob/master/qcloud_cos/cos_auth.py
"""
import argparse
import base64
from contextlib import contextmanager
import datetime as dt
import hashlib
import hmac
import http.client
import io
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import tempfile
import time
from urllib.parse import quote


DEFAULT_CREDENTIALS = '/etc/lycee/cos-backup.json'
AGE_HEADER = b'age-encryption.org/v1\n'
CHUNK = 1024 * 1024
MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024  # COS simple PUT limit; no multipart.
FIELDS = {'SecretId', 'SecretKey', 'Bucket', 'Region', 'Prefix'}


class BackupError(Exception):
    """Only fixed, credential-free diagnostic messages are exposed to the caller."""


def validate_credentials(raw):
    if not isinstance(raw, dict) or set(raw) - FIELDS:
        raise BackupError('COS configuration contains unsupported fields')
    for name in ('SecretId', 'SecretKey', 'Bucket', 'Region'):
        if not isinstance(raw.get(name), str):
            raise BackupError('COS configuration is incomplete')
    if not re.fullmatch(r'[A-Za-z0-9]{8,128}', raw['SecretId']):
        raise BackupError('COS SecretId format is invalid')
    if not re.fullmatch(r'[A-Za-z0-9_+=/-]{16,128}', raw['SecretKey']):
        raise BackupError('COS SecretKey format is invalid')
    bucket, region = raw['Bucket'], raw['Region']
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-[1-9][0-9]{4,19}', bucket):
        raise BackupError('COS bucket must include its numeric APPID suffix')
    if len(region) > 32 or not re.fullmatch(r'[a-z]{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*', region):
        raise BackupError('COS region format is invalid')
    host = f'{bucket}.cos.{region}.myqcloud.com'
    # COS documents a maximum complete default endpoint length of 60 characters.
    if len(host) > 60 or len(bucket) > 63:
        raise BackupError('COS bucket endpoint is too long')
    prefix = raw.get('Prefix', 'lycee-backups')
    if not isinstance(prefix, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}', prefix):
        raise BackupError('COS prefix format is invalid')
    if any(part in ('', '.', '..') for part in prefix.split('/')):
        raise BackupError('COS prefix must contain safe path segments')
    return dict(raw, Prefix=prefix)


def validate_private_metadata(metadata, *, exact_mode=None):
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
        raise BackupError('Backup input must be a root-owned regular file')
    mode = stat.S_IMODE(metadata.st_mode)
    if (exact_mode is not None and mode != exact_mode) or mode & 0o077:
        raise BackupError('Backup input permissions must be private to root')


@contextmanager
def private_file(path, *, exact_mode=None):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise BackupError('Backup input must use an absolute path without symlinks')
    # O_NOFOLLOW also prevents a final-component symlink swap after resolution.
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        validate_private_metadata(os.fstat(descriptor), exact_mode=exact_mode)
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            yield stream
    finally:
        os.close(descriptor)


def no_duplicate_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError('COS configuration contains duplicate fields')
        result[key] = value
    return result


def load_credentials(path):
    with private_file(path, exact_mode=0o600) as stream:
        raw = stream.read(16385)
    if len(raw) > 16384:
        raise BackupError('COS configuration is too large')
    try:
        data = json.loads(raw, object_pairs_hook=no_duplicate_fields)
    except (ValueError, UnicodeError):
        raise BackupError('COS configuration must be valid JSON') from None
    return validate_credentials(data)


def validate_stamp(stamp):
    if not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[1-9][0-9]{0,9}', stamp):
        raise BackupError('Backup stamp must use UTC timestamp and process ID')
    try:
        dt.datetime.strptime(stamp.split('-')[0], '%Y%m%dT%H%M%SZ')
    except ValueError:
        raise BackupError('Backup stamp contains an invalid UTC timestamp') from None
    return stamp


def inspect_archive(stream, checksum):
    if not re.fullmatch(r'[0-9a-f]{64}', checksum):
        raise BackupError('Expected archive checksum must be lowercase SHA256')
    stream.seek(0)
    if stream.read(len(AGE_HEADER)) != AGE_HEADER:
        raise BackupError('Only a binary age-encrypted archive may be uploaded')
    stream.seek(0)
    sha256, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    size = 0
    while block := stream.read(CHUNK):
        size += len(block)
        if size > MAX_ARCHIVE_BYTES:
            raise BackupError('Archive exceeds the COS simple PUT size limit')
        sha256.update(block)
        md5.update(block)
    if size < 100 or not hmac.compare_digest(sha256.hexdigest(), checksum):
        raise BackupError('Encrypted archive checksum or size is invalid')
    stream.seek(0)
    return size, base64.b64encode(md5.digest()).decode('ascii')


def canonical_request(method, pathname, headers):
    # COS signs the decoded URI path and RFC3986-encoded header values. Keys
    # are lowercase and sorted after encoding; spaces use %20, never '+'.
    encoded = {quote(str(k), safe='-_.~').lower(): quote(str(v), safe='-_.~')
               for k, v in headers.items()}
    names = sorted(encoded)
    text = f'{method.lower()}\n{pathname}\n\n' + '&'.join(f'{k}={encoded[k]}' for k in names) + '\n'
    return text, ';'.join(names)


def signed_headers(config, method, pathname, headers, now=None):
    now = int(time.time()) if now is None else int(now)
    key_time = f'{now - 60};{now + 900}'
    canonical, header_list = canonical_request(method, pathname, headers)
    sign_key = hmac.new(config['SecretKey'].encode(), key_time.encode(), hashlib.sha1).hexdigest()
    to_sign = f'sha1\n{key_time}\n{hashlib.sha1(canonical.encode()).hexdigest()}\n'
    signature = hmac.new(sign_key.encode(), to_sign.encode(), hashlib.sha1).hexdigest()
    authorization = (f'q-sign-algorithm=sha1&q-ak={config["SecretId"]}'
                     f'&q-sign-time={key_time}&q-key-time={key_time}'
                     f'&q-header-list={header_list}&q-url-param-list=&q-signature={signature}')
    return dict(headers, Authorization=authorization)


class CosClient:
    def __init__(self, config, connection_factory=None):
        self.config = validate_credentials(config)
        self.host = f'{self.config["Bucket"]}.cos.{self.config["Region"]}.myqcloud.com'
        self.connection_factory = connection_factory or http.client.HTTPSConnection

    @contextmanager
    def request(self, method, key, *, body=None, size=None, md5=None, sha256=None):
        if method not in {'PUT', 'HEAD', 'GET'}:
            raise BackupError('COS operation is not permitted')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9._/-]{1,512}', key):
            raise BackupError('COS object key is invalid')
        if not key.startswith(self.config['Prefix'] + '/') or any(p in ('', '.', '..') for p in key.split('/')):
            raise BackupError('COS object must remain within the configured prefix')
        path = '/' + key
        headers = {'Host': self.host}
        if method == 'PUT':
            headers.update({'Content-Type': 'application/octet-stream', 'Content-Length': str(size),
                            'Content-MD5': md5, 'x-cos-acl': 'private',
                            'x-cos-meta-sha256': sha256})
        headers = signed_headers(self.config, method, path, headers)
        connection = self.connection_factory(self.host, port=443, timeout=60, context=ssl.create_default_context())
        response = None
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            # http.client never follows redirects. Never log the server's
            # error body: it can contain request headers or credential IDs.
            if response.status != 200:
                raise BackupError(f'COS {method} failed with HTTP {response.status}')
            yield response
        finally:
            if response is not None:
                response.close()
            connection.close()

    def put(self, key, stream, size, md5, checksum):
        with self.request('PUT', key, body=stream, size=size, md5=md5, sha256=checksum):
            pass

    def verify(self, key, size, checksum):
        with self.request('HEAD', key) as response:
            if response.getheader('Content-Length') != str(size):
                raise BackupError('Remote backup size does not match')
            if response.getheader('x-cos-meta-sha256') != checksum:
                raise BackupError('Remote backup checksum metadata does not match')
        # ETag is deliberately ignored. Read actual ciphertext with bounded
        # memory and compare SHA256, even if HEAD metadata looks correct.
        digest, received = hashlib.sha256(), 0
        with self.request('GET', key) as response:
            if response.getheader('Content-Length') != str(size):
                raise BackupError('Remote backup readback size does not match')
            while block := response.read(CHUNK):
                received += len(block)
                if received > size:
                    raise BackupError('Remote backup readback exceeds expected size')
                digest.update(block)
        if received != size or not hmac.compare_digest(digest.hexdigest(), checksum):
            raise BackupError('Remote backup readback SHA256 does not match')


def upload_backup(archive, stamp, checksum, config, *, connection_factory=None):
    stamp = validate_stamp(stamp)
    archive = Path(archive)
    if not archive.name.endswith('.tar.age'):
        raise BackupError('Encrypted backup filename must end with .tar.age')
    config = validate_credentials(config)
    archive_key = f'{config["Prefix"]}/{stamp}/backup.tar.age'
    checksum_key = archive_key + '.sha256'
    sidecar = f'{checksum}  backup.tar.age\n'.encode('ascii')
    sidecar_checksum = hashlib.sha256(sidecar).hexdigest()
    sidecar_md5 = base64.b64encode(hashlib.md5(sidecar, usedforsecurity=False).digest()).decode('ascii')
    with private_file(archive) as stream:
        size, md5 = inspect_archive(stream, checksum)
        client = CosClient(config, connection_factory=connection_factory)
        client.put(archive_key, stream, size, md5, checksum)
        client.verify(archive_key, size, checksum)
        client.put(checksum_key, io.BytesIO(sidecar), len(sidecar), sidecar_md5, sidecar_checksum)
        client.verify(checksum_key, len(sidecar), sidecar_checksum)
    return {'backup': stamp, 'provider': 'tencent-cos', 'offsiteVerified': True,
            'bucket': config['Bucket'], 'region': config['Region'],
            'archiveKey': archive_key, 'checksumKey': checksum_key,
            'bytes': size, 'sha256': checksum,
            'verifiedUtc': dt.datetime.now(dt.timezone.utc).isoformat()}


def save_report(directory, report):
    # Atomic replacement avoids a partial success marker if the process dies.
    directory = Path(directory)
    metadata = directory.stat()
    if directory.resolve() != directory or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
        raise BackupError('Verification report directory must be controlled by root')
    descriptor, temporary = tempfile.mkstemp(prefix='.cos-verification-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(report, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / 'cos-verification.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, help='Absolute path to a root-private binary .tar.age archive')
    parser.add_argument('--stamp', required=True, help='Backup UTC timestamp and PID, e.g. 20261004T030405Z-123')
    parser.add_argument('--checksum', required=True, help='Expected SHA256 of the encrypted archive')
    parser.add_argument('--credentials', default=DEFAULT_CREDENTIALS, help='Root-owned 0600 COS JSON config')
    parser.add_argument('--check', action='store_true', help='Validate local inputs without any network request')
    args = parser.parse_args(argv)
    if getattr(os, 'geteuid', lambda: -1)() != 0:
        raise BackupError('COS backup must run as root')
    os.umask(0o077)
    config = load_credentials(args.credentials)
    validate_stamp(args.stamp)
    if not Path(args.archive).name.endswith('.tar.age'):
        raise BackupError('Encrypted backup filename must end with .tar.age')
    if args.check:
        with private_file(args.archive) as stream:
            inspect_archive(stream, args.checksum)
        print(json.dumps({'backup': args.stamp, 'checked': True, 'offsiteVerified': False}))
        return
    report = upload_backup(args.archive, args.stamp, args.checksum, config)
    save_report(Path(args.archive).parent, report)
    print(json.dumps(report, sort_keys=True))


def entrypoint():
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, BackupError) else type(error).__name__
        print('COS backup failed: ' + message, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(entrypoint())
