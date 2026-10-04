"""COS protocol, confidentiality and readback boundaries; no real cloud requests."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import ssl
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('cos_backup', Path(__file__).resolve().parents[1] / 'deployment' / 'cos-backup.py')
cos = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cos)

CONFIG = {'SecretId': 'AKIDPUBLICEXAMPLE', 'SecretKey': 'public-dummy-secret-only',
          'Bucket': 'lycee-backup-1250000000', 'Region': 'ap-shanghai', 'Prefix': 'lycee-backups'}
STAMP = '20261004T030405Z-123'
PAYLOAD = cos.AGE_HEADER + b'-> X25519 public-test-stanza\n' + bytes(range(256)) * 8
CHECKSUM = hashlib.sha256(PAYLOAD).hexdigest()


class FakeResponse:
    def __init__(self, payload=b'', headers=None, status=200):
        self.payload = io.BytesIO(payload)
        self.headers = {key.lower(): str(value) for key, value in (headers or {}).items()}
        self.status = status
        self.read_sizes = []

    def getheader(self, name):
        return self.headers.get(name.lower())

    def read(self, size):
        self.read_sizes.append(size)
        return self.payload.read(size)

    def close(self):
        self.payload.close()


class FakeStore:
    """A transport boundary that preserves uploaded bytes and independent metadata."""
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.responses = []
        self.redirect = False
        self.corrupt_archive = False
        self.corrupt_sidecar = False
        self.bad_metadata = False
        self.truncate = False

    def factory(self, host, *, port, timeout, context):
        if host != 'lycee-backup-1250000000.cos.ap-shanghai.myqcloud.com' or port != 443:
            raise AssertionError('Unexpected endpoint')
        if not isinstance(context, ssl.SSLContext) or context.verify_mode != ssl.CERT_REQUIRED or not context.check_hostname:
            raise AssertionError('TLS verification must remain enabled')
        store = self

        class Connection:
            def request(self, method, path, *, body, headers):
                store.calls.append((method, host, path, headers))
                self.method, self.path = method, path
                if method == 'PUT':
                    data = body.read()
                    expected_md5 = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
                    if headers['Content-MD5'] != expected_md5 or headers['Content-Length'] != str(len(data)):
                        raise AssertionError('Invalid upload integrity headers')
                    if headers['x-cos-acl'] != 'private':
                        raise AssertionError('Object ACL must be private')
                    store.objects[path] = (data, headers['x-cos-meta-sha256'])

            def getresponse(self):
                if store.redirect:
                    response = FakeResponse(b'error with credentials never logged', {'Location': 'https://evil.example/private'}, 307)
                elif self.method == 'PUT':
                    response = FakeResponse()
                else:
                    data, checksum = store.objects[self.path]
                    headers = {'Content-Length': len(data), 'x-cos-meta-sha256': checksum, 'ETag': 'arbitrary-multipart-etag'}
                    if store.bad_metadata:
                        headers['x-cos-meta-sha256'] = '0' * 64
                    if self.method == 'GET':
                        if (store.corrupt_archive and self.path.endswith('.tar.age')) or (store.corrupt_sidecar and self.path.endswith('.sha256')):
                            data = b'X' + data[1:]
                        if store.truncate:
                            data = data[:-1]
                    response = FakeResponse(data if self.method == 'GET' else b'', headers)
                store.responses.append(response)
                return response

            def close(self):
                pass

        return Connection()


@contextlib.contextmanager
def archive_bytes(path, **kwargs):
    # Ownership/mode guards are tested separately; fixtures work on Windows too.
    yield io.BytesIO(PAYLOAD)


class CosBackupTests(unittest.TestCase):
    def test_native_signature_matches_official_document_canonical_example(self):
        # Tencent doc 436/7778, upload example: this digest is published there.
        headers = {'Date': 'Thu, 16 May 2019 06:45:51 GMT',
                   'Host': 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com',
                   'Content-Type': 'text/plain', 'Content-Length': '13',
                   'Content-MD5': 'mQ/fVh815F3k6TAUm8m0eg==', 'x-cos-acl': 'private',
                   'x-cos-grant-read': 'uin="100000000011"'}
        canonical, header_list = cos.canonical_request('PUT', '/exampleobject(腾讯云)', headers)
        self.assertEqual(hashlib.sha1(canonical.encode()).hexdigest(), '8b2751e77f43a0995d6e9eb9477f4b685cca4172')
        self.assertEqual(header_list, 'content-length;content-md5;content-type;date;host;x-cos-acl;x-cos-grant-read')

    def test_signature_matches_official_sdk_with_public_dummy_keys(self):
        # Frozen output of the reviewed upstream CosS3Auth class, expire=900,
        # time.time=1600000000. No live credential or API call generated it.
        headers = {'Host': 'lycee-backup-1250000000.cos.ap-shanghai.myqcloud.com',
                   'Content-Type': 'application/octet-stream', 'Content-Length': '1234',
                   'Content-MD5': 'AA+/==', 'x-cos-acl': 'private', 'x-cos-meta-sha256': 'a' * 64}
        signed = cos.signed_headers(CONFIG, 'PUT', '/lycee-backups/20261004T030405Z-123/backup.tar.age', headers, 1600000000)
        self.assertEqual(signed['Authorization'],
                         'q-sign-algorithm=sha1&q-ak=AKIDPUBLICEXAMPLE&q-sign-time=1599999940;1600000900'
                         '&q-key-time=1599999940;1600000900&q-header-list=content-length;content-md5;content-type;host;'
                         'x-cos-acl;x-cos-meta-sha256&q-url-param-list=&q-signature=55694933529de49d094544a5684ac600dd8d875f')
        self.assertNotIn(CONFIG['SecretKey'], signed['Authorization'])

    def test_endpoint_credentials_prefix_and_stamp_boundaries(self):
        self.assertEqual(cos.validate_credentials({k: v for k, v in CONFIG.items() if k != 'Prefix'})['Prefix'], 'lycee-backups')
        changes = [('Bucket', 'bucket'), ('Bucket', 'bucket-1250000000.evil.example'), ('Bucket', 'bucket/../../secret'),
                   ('Bucket', '-bucket-1250000000'), ('Region', 'ap-shanghai:443'), ('Region', 'ap-shanghai/evil'),
                   ('SecretId', 'AKID\r\nInjected: secret'), ('SecretKey', 'bad\nsecret'),
                   ('Prefix', '/outside'), ('Prefix', 'safe/../outside'), ('Prefix', 'safe//outside'),
                   ('Prefix', 'safe?secret=x'), ('Endpoint', 'https://evil.example')]
        for key, value in changes:
            with self.subTest(key=key, value=value), self.assertRaises(cos.BackupError):
                cos.validate_credentials(dict(CONFIG, **{key: value}))
        for stamp in ('20260230T030405Z-1', '20261004T250405Z-1', STAMP + '/other', '20261004T030405Z-0'):
            with self.subTest(stamp=stamp), self.assertRaises(cos.BackupError):
                cos.validate_stamp(stamp)

    def test_configuration_and_file_privacy_guards(self):
        valid = SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o600)
        cos.validate_private_metadata(valid, exact_mode=0o600)
        for uid, mode in ((1000, stat.S_IFREG | 0o600), (0, stat.S_IFLNK | 0o600), (0, stat.S_IFREG | 0o640), (0, stat.S_IFREG | 0o700)):
            with self.subTest(uid=uid, mode=mode), self.assertRaises(cos.BackupError):
                cos.validate_private_metadata(SimpleNamespace(st_uid=uid, st_mode=mode), exact_mode=0o600)
        with self.assertRaises(cos.BackupError), cos.private_file(Path('relative-secret.json')):
            pass
        for payload in (b'{"SecretKey":"one","SecretKey":"two"}', b'{"SecretKey":"malformed-private-value"', b'x' * 16385):
            @contextlib.contextmanager
            def config_bytes(path, **kwargs):
                self.assertEqual(kwargs, {'exact_mode': 0o600})
                yield io.BytesIO(payload)
            with patch.object(cos, 'private_file', config_bytes), self.assertRaises(cos.BackupError) as raised:
                cos.load_credentials('/etc/lycee/cos-backup.json')
            self.assertNotIn('malformed-private-value', str(raised.exception))

    def fixture_upload(self, store, checksum=CHECKSUM):
        with patch.object(cos, 'private_file', archive_bytes):
            return cos.upload_backup(Path(tempfile.gettempdir()).resolve() / 'backup.tar.age', STAMP, checksum,
                                     CONFIG, connection_factory=store.factory)

    def test_private_ciphertext_and_sidecar_are_read_back_before_success(self):
        store = FakeStore()
        report = self.fixture_upload(store)
        self.assertTrue(report['offsiteVerified'])
        self.assertEqual(report['sha256'], CHECKSUM)
        self.assertEqual([call[0] for call in store.calls], ['PUT', 'HEAD', 'GET', 'PUT', 'HEAD', 'GET'])
        archive_key = '/lycee-backups/' + STAMP + '/backup.tar.age'
        self.assertEqual(set(store.objects), {archive_key, archive_key + '.sha256'})
        self.assertEqual(store.objects[archive_key][0], PAYLOAD)
        self.assertEqual(store.objects[archive_key + '.sha256'][0], f'{CHECKSUM}  backup.tar.age\n'.encode())
        self.assertNotIn(CONFIG['SecretId'], json.dumps(report))
        self.assertNotIn(CONFIG['SecretKey'], json.dumps(report))
        self.assertTrue(all(n == cos.CHUNK for response in store.responses for n in response.read_sizes))

    def test_local_checksum_failure_and_plaintext_never_open_a_connection(self):
        store = FakeStore()
        with self.assertRaises(cos.BackupError):
            self.fixture_upload(store, '0' * 64)
        self.assertEqual(store.calls, [])
        for plaintext in (b'PGDMP private backup data', b'{"SecretKey":"private-value"}', b'-----BEGIN AGE ENCRYPTED FILE-----'):
            @contextlib.contextmanager
            def plaintext_file(path, **kwargs):
                yield io.BytesIO(plaintext)
            with patch.object(cos, 'private_file', plaintext_file), self.assertRaises(cos.BackupError):
                cos.upload_backup(Path(tempfile.gettempdir()).resolve() / 'backup.tar.age', STAMP,
                                  hashlib.sha256(plaintext).hexdigest(), CONFIG, connection_factory=store.factory)
        self.assertEqual(store.calls, [])

    def test_readback_corruption_truncation_and_metadata_mismatch_fail(self):
        for flag in ('corrupt_archive', 'corrupt_sidecar', 'truncate', 'bad_metadata'):
            store = FakeStore()
            setattr(store, flag, True)
            with self.subTest(flag=flag), self.assertRaises(cos.BackupError):
                self.fixture_upload(store)
            if flag in ('corrupt_archive', 'truncate', 'bad_metadata'):
                self.assertEqual(len(store.objects), 1, 'No checksum sidecar should be uploaded for an unverified archive')

    def test_redirects_are_rejected_without_sending_credentials_elsewhere(self):
        store = FakeStore()
        store.redirect = True
        with self.assertRaisesRegex(cos.BackupError, 'HTTP 307'):
            self.fixture_upload(store)
        self.assertEqual(len(store.calls), 1)
        self.assertNotIn('evil.example', store.calls[0][1])
        self.assertTrue(all(response.read_sizes == [] for response in store.responses))

    def test_client_rejects_other_operations_and_paths_before_network(self):
        factory = Mock()
        client = cos.CosClient(CONFIG, connection_factory=factory)
        for method, key in [('DELETE', 'lycee-backups/file'), ('PUT', 'other-prefix/file'),
                            ('GET', 'lycee-backups/../private'), ('GET', 'lycee-backups/https://evil.example/file'),
                            ('HEAD', 'lycee-backups/escaped%2fprivate'), ('GET', 'lycee-backups/file?acl')]:
            with self.subTest(method=method, key=key), self.assertRaises(cos.BackupError), client.request(method, key):
                pass
        factory.assert_not_called()

    def test_offline_check_never_contacts_cos_or_claims_offsite_verification(self):
        factory = Mock()
        argv = ['--archive', str(Path(tempfile.gettempdir()).resolve() / 'backup.tar.age'), '--stamp', STAMP,
                '--checksum', CHECKSUM, '--check']
        output = io.StringIO()
        with patch.object(cos.os, 'geteuid', return_value=0, create=True), patch.object(cos, 'load_credentials', return_value=CONFIG), \
                patch.object(cos, 'private_file', archive_bytes), patch.object(cos.http.client, 'HTTPSConnection', factory), \
                contextlib.redirect_stdout(output):
            cos.main(argv)
        factory.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {'backup': STAMP, 'checked': True, 'offsiteVerified': False})

    def test_failures_never_emit_success_or_sensitive_diagnostics(self):
        for exception in (OSError('private-secret Authorization leak'), RuntimeError(CONFIG['SecretKey'])):
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(cos, 'main', side_effect=exception), contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                self.assertEqual(cos.entrypoint(), 1)
            self.assertEqual(output.getvalue(), '')
            self.assertNotIn('private-secret', errors.getvalue())
            self.assertNotIn(CONFIG['SecretKey'], errors.getvalue())
        store = FakeStore()
        store.corrupt_archive = True
        output = io.StringIO()
        save = Mock()
        argv = ['cos-backup.py', '--archive', str(Path(tempfile.gettempdir()).resolve() / 'backup.tar.age'),
                '--stamp', STAMP, '--checksum', CHECKSUM]
        with patch.object(cos.os, 'geteuid', return_value=0, create=True), patch.object(cos, 'load_credentials', return_value=CONFIG), \
                patch.object(cos, 'private_file', archive_bytes), patch.object(cos.http.client, 'HTTPSConnection', store.factory), \
                patch.object(cos, 'save_report', save), patch.object(cos.sys, 'argv', argv), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cos.entrypoint(), 1)
        self.assertEqual(output.getvalue(), '')
        save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
