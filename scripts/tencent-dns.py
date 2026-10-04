#!/usr/bin/env python3
"""Restricted DNSPod V3 client and Certbot DNS-01 hooks; Python standard library only.

Reference: TencentCloud's official Python SDK common/abstract_client.py,
common/sign.py and dnspod/v20210323/models.py in
https://github.com/TencentCloud/tencentcloud-sdk-python .

No A/AAAA/CNAME mutations are implemented. Credentials and TXT values never
appear in diagnostic output. Auth stdout is exclusively the created RecordId.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, HTTPSHandler, build_opener


DOMAIN = 'lycee-toolbox.top'
ENDPOINT = 'dnspod.tencentcloudapi.com'
API_VERSION = '2021-03-23'
CONTENT_TYPE = 'application/json; charset=utf-8'
VISIBLE_TYPES = frozenset(('A', 'AAAA', 'CNAME', 'NS'))
LABEL = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z')
VALIDATION = re.compile(r'[A-Za-z0-9_-]{32,128}\Z')
REMARK_PREFIX = 'lycee-acme-dns01:'


class DnsError(Exception):
    """A safe diagnostic without credentials, request payloads, or TXT values."""


class ApiError(DnsError):
    def __init__(self, code, request_id=''):
        self.code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', code) else 'UnknownError'
        self.request_id = request_id if isinstance(request_id, str) and re.fullmatch(r'[A-Za-z0-9-]{1,80}', request_id) else ''
        suffix = f' (request {self.request_id})' if self.request_id else ''
        super().__init__(f'DNSPod API error: {self.code}{suffix}')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DnsError('DNSPod redirects are refused')


def load_credentials(path):
    try:
        text = Path(path).read_text(encoding='utf-8-sig')
        if Path(path).suffix.lower() == '.csv':
            rows = list(csv.DictReader(text.splitlines()))
            if len(rows) != 1:
                raise DnsError('Credentials CSV must contain exactly one account')
            values = dict(rows[0], Domain=DOMAIN)
        else:
            values = json.loads(text)
    except (OSError, ValueError, TypeError, csv.Error):
        raise DnsError('Unable to read DNSPod credentials') from None
    if not isinstance(values, dict) or values.get('Domain') != DOMAIN:
        raise DnsError('Credentials must be restricted to the configured project domain')
    for field in ('SecretId', 'SecretKey'):
        value = values.get(field)
        if not isinstance(value, str) or not value or value.strip() != value or any(c.isspace() for c in value):
            raise DnsError('DNSPod credentials are missing or invalid')
    return values


def challenge_subdomain(domain):
    if not isinstance(domain, str):
        raise DnsError('CERTBOT_DOMAIN is required')
    domain = domain.lower()
    if domain.endswith('.'):
        domain = domain[:-1]
    if domain.startswith('*.'):
        if domain != f'*.preview.{DOMAIN}':
            raise DnsError('Wildcard challenge is outside the project allowlist')
        domain = domain[2:]
    if domain == DOMAIN:
        relative = ''
    elif domain == f'www.{DOMAIN}':
        relative = 'www'
    elif domain == f'preview.{DOMAIN}':
        relative = 'preview'
    elif domain.endswith(f'.preview.{DOMAIN}'):
        label = domain[:-len(f'.preview.{DOMAIN}')]
        if not LABEL.fullmatch(label):
            raise DnsError('Preview challenge must have exactly one valid DNS label')
        relative = label + '.preview'
    else:
        raise DnsError('Challenge domain is outside the project allowlist')
    return '_acme-challenge' + ('.' + relative if relative else '')


def checked_challenge_name(name):
    if name == '_acme-challenge':
        return name
    if not isinstance(name, str) or not name.startswith('_acme-challenge.'):
        raise DnsError('Only allowed ACME challenge TXT hosts may be changed')
    relative = name[len('_acme-challenge.'):]
    if challenge_subdomain(relative + '.' + DOMAIN) != name:
        raise DnsError('Invalid ACME challenge host')
    return name


def challenge_values(environ):
    name = challenge_subdomain(environ.get('CERTBOT_DOMAIN'))
    validation = environ.get('CERTBOT_VALIDATION', '')
    if not isinstance(validation, str) or not VALIDATION.fullmatch(validation):
        raise DnsError('CERTBOT_VALIDATION is missing or invalid')
    return name, validation


def record_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9][0-9]{0,19}', str(value)):
        raise DnsError('Invalid challenge record ID')
    return int(value)


def challenge_remark(name, validation):
    digest = hashlib.sha256((name + '\0' + validation).encode('utf-8')).hexdigest()
    return REMARK_PREFIX + digest


def signed_headers(secret_id, secret_key, action, payload, timestamp):
    """Match the official SDK's TC3 content-type;host canonical request."""
    stamp = int(timestamp)
    date = datetime.fromtimestamp(stamp, timezone.utc).strftime('%Y-%m-%d')
    canonical_headers = f'content-type:{CONTENT_TYPE}\nhost:{ENDPOINT}\n'
    canonical_request = '\n'.join(('POST', '/', '', canonical_headers, 'content-type;host', hashlib.sha256(payload).hexdigest()))
    scope = date + '/dnspod/tc3_request'
    string_to_sign = '\n'.join(('TC3-HMAC-SHA256', str(stamp), scope, hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()))
    key = hmac.new(('TC3' + secret_key).encode('utf-8'), date.encode('utf-8'), hashlib.sha256).digest()
    key = hmac.new(key, b'dnspod', hashlib.sha256).digest()
    key = hmac.new(key, b'tc3_request', hashlib.sha256).digest()
    signature = hmac.new(key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    return {'Content-Type': CONTENT_TYPE, 'Host': ENDPOINT, 'X-TC-Action': action,
            'X-TC-Version': API_VERSION, 'X-TC-Timestamp': str(stamp),
            'Authorization': f'TC3-HMAC-SHA256 Credential={secret_id}/{scope}, SignedHeaders=content-type;host, Signature={signature}'}


class DnsPod:
    def __init__(self, credentials, opener=None, now=time.time, timeout=20):
        if credentials.get('Domain') != DOMAIN:
            raise DnsError('DNSPod domain guard failed')
        self.credentials = credentials
        self.opener = opener or build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        self.now = now
        self.timeout = timeout
        self._verified_cleanup_ids = set()

    def call(self, action, params):
        if action not in ('DescribeRecordList', 'DescribeRecord', 'CreateRecord', 'DeleteRecord'):
            raise DnsError('DNSPod action is outside the allowlist')
        if params.get('Domain') != DOMAIN or 'DomainId' in params:
            raise DnsError('DNSPod domain guard failed')
        if action == 'CreateRecord':
            if params.get('RecordType') != 'TXT' or params.get('Status') != 'ENABLE':
                raise DnsError('Only new enabled ACME TXT records may be created')
            checked_challenge_name(params.get('SubDomain'))
            if not VALIDATION.fullmatch(params.get('Value', '')):
                raise DnsError('Invalid ACME validation value')
        if action in ('DescribeRecord', 'DeleteRecord'):
            record_id(params.get('RecordId'))
        if action == 'DeleteRecord':
            approved = record_id(params.get('RecordId'))
            if approved not in self._verified_cleanup_ids:
                raise DnsError('DeleteRecord requires a verified challenge ownership check')
            self._verified_cleanup_ids.remove(approved)
        payload = json.dumps(params, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        headers = signed_headers(self.credentials['SecretId'], self.credentials['SecretKey'], action, payload, self.now())
        request = Request('https://' + ENDPOINT + '/', data=payload, headers=headers, method='POST')
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise DnsError('DNSPod response exceeds the permitted size')
            result = json.loads(raw).get('Response')
        except HTTPError as error:
            raise DnsError(f'DNSPod HTTP error {error.code}') from None
        except (URLError, TimeoutError, OSError):
            raise DnsError('Unable to reach DNSPod') from None
        except (ValueError, AttributeError, TypeError):
            raise DnsError('Invalid DNSPod response') from None
        if not isinstance(result, dict):
            raise DnsError('Invalid DNSPod response')
        if result.get('Error'):
            error = result['Error']
            if not isinstance(error, dict):
                raise DnsError('Invalid DNSPod error response')
            raise ApiError(error.get('Code', ''), result.get('RequestId', ''))
        return result

    def list_metadata(self):
        records = []
        for kind in sorted(VISIBLE_TYPES):
            offset = 0
            for _ in range(1000):
                result = self.call('DescribeRecordList', {'Domain': DOMAIN, 'RecordType': kind,
                    'Offset': offset, 'Limit': 100, 'ErrorOnEmpty': 'no'})
                page = result.get('RecordList') or []
                if not isinstance(page, list):
                    raise DnsError('Invalid DNSPod record list')
                for item in page:
                    if not isinstance(item, dict) or item.get('Type') not in VISIBLE_TYPES:
                        continue
                    fields = ('RecordId', 'Name', 'Type', 'Value', 'Status', 'TTL', 'Line', 'UpdatedOn')
                    records.append({field: item[field] for field in fields if field in item})
                if len(page) < 100:
                    break
                offset += len(page)
            else:
                raise DnsError('DNSPod record pagination limit exceeded')
        return sorted(records, key=lambda item: (item.get('Type', ''), item.get('Name', ''), item.get('RecordId', 0)))

    def create_challenge(self, name, validation):
        checked_challenge_name(name)
        if not VALIDATION.fullmatch(validation):
            raise DnsError('Invalid ACME validation value')
        # CreateRecord is never retried: an uncertain timeout must not duplicate a write.
        result = self.call('CreateRecord', {'Domain': DOMAIN, 'SubDomain': name, 'RecordType': 'TXT',
            'RecordLine': '默认', 'Value': validation, 'Status': 'ENABLE',
            'Remark': challenge_remark(name, validation)})
        return record_id(result.get('RecordId'))

    def cleanup_challenge(self, created_id, name, validation):
        checked_challenge_name(name)
        if not isinstance(validation, str) or not VALIDATION.fullmatch(validation):
            raise DnsError('Invalid ACME validation value')
        created_id = record_id(created_id)
        try:
            result = self.call('DescribeRecord', {'Domain': DOMAIN, 'RecordId': created_id})
        except ApiError as error:
            if error.code == 'ResourceNotFound.NoDataOfRecord':
                return False
            raise
        info = result.get('RecordInfo')
        if not isinstance(info, dict) or record_id(info.get('Id')) != created_id:
            raise DnsError('Challenge record identity could not be verified; cleanup refused')
        if info.get('SubDomain') != name or info.get('RecordType') != 'TXT' or info.get('Value') != validation:
            raise DnsError('Challenge record changed or belongs to another challenge; cleanup refused')
        if info.get('Remark') != challenge_remark(name, validation):
            raise DnsError('Challenge record is not owned by this hook; cleanup refused')
        self._verified_cleanup_ids.add(created_id)
        self.call('DeleteRecord', {'Domain': DOMAIN, 'RecordId': created_id})
        return True


def propagation_seconds(value):
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError('Propagation wait must be an integer of at least 60 seconds') from None
    if seconds < 60:
        raise argparse.ArgumentTypeError('Propagation wait must be at least 60 seconds')
    return seconds


def wait_propagation(seconds, sleeper=time.sleep):
    seconds = propagation_seconds(seconds)
    while seconds:
        interval = min(seconds, 30)
        sleeper(interval)
        seconds -= interval


def main(argv=None, *, environ=None, client_factory=DnsPod, sleeper=time.sleep):
    environ = os.environ if environ is None else environ
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', required=True, metavar='FILE')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list', help='Show only A/AAAA/CNAME/NS metadata')
    auth = commands.add_parser('acme-auth', help='Certbot manual authentication hook')
    auth.add_argument('--propagation-seconds', type=propagation_seconds,
        default=environ.get('DNS_PROPAGATION_SECONDS', '120'))
    commands.add_parser('acme-cleanup', help='Delete only the verified record created for this challenge')
    args = parser.parse_args(argv)
    try:
        credentials = load_credentials(args.credentials)
        if args.command == 'list':
            print(json.dumps({'Domain': DOMAIN, 'Records': client_factory(credentials).list_metadata()}, ensure_ascii=True, indent=2))
            return 0
        name, validation = challenge_values(environ)
        if args.command == 'acme-auth':
            seconds = propagation_seconds(args.propagation_seconds)
            created_id = client_factory(credentials).create_challenge(name, validation)
            print(created_id, flush=True)
            wait_propagation(seconds, sleeper)
        else:
            output = environ.get('CERTBOT_AUTH_OUTPUT', '').strip()
            created_id = record_id(output)
            client_factory(credentials).cleanup_challenge(created_id, name, validation)
        return 0
    except (DnsError, argparse.ArgumentTypeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('DNS hook interrupted', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
