"""DNSPod signing and DNS-01 guards, without network or DNS modifications."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

SPEC = importlib.util.spec_from_file_location('tencent_dns', Path(__file__).resolve().parents[1] / 'scripts' / 'tencent-dns.py')
d = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(d)
TOKEN = 'Abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFG'
CREDS = {'SecretId': 'example-id', 'SecretKey': 'example-secret', 'Domain': d.DOMAIN}


class DnsTests(unittest.TestCase):
    def test_allowed_domain_boundaries(self):
        for domain, name in [('lycee-toolbox.top', '_acme-challenge'), ('www.lycee-toolbox.top', '_acme-challenge.www'),
                             ('preview.lycee-toolbox.top', '_acme-challenge.preview'),
                             ('*.preview.lycee-toolbox.top', '_acme-challenge.preview'),
                             ('feature-1.preview.lycee-toolbox.top', '_acme-challenge.feature-1.preview')]:
            self.assertEqual(d.challenge_subdomain(domain), name)
        for domain in ('evil.top', 'lycee-toolbox.top.evil.top', '*.lycee-toolbox.top', 'x.y.preview.lycee-toolbox.top',
                       'foo.lycee-toolbox.top', '-foo.preview.lycee-toolbox.top', 'www.lycee-toolbox.top/path'):
            with self.subTest(domain=domain), self.assertRaises(d.DnsError):
                d.challenge_subdomain(domain)

    def test_fixed_signed_endpoint_and_no_unapproved_mutations(self):
        opener = Mock()
        client = d.DnsPod(CREDS, opener=opener)
        for action, params in [('ModifyRecord', {'Domain': d.DOMAIN}),
                               ('CreateRecord', {'Domain': d.DOMAIN, 'RecordType': 'A', 'Status': 'ENABLE'}),
                               ('DescribeRecordList', {'Domain': 'other.top'}),
                               ('DescribeRecordList', {'Domain': d.DOMAIN, 'DomainId': 123}),
                               ('DeleteRecord', {'Domain': d.DOMAIN, 'RecordId': 42}),
                               ('CreateRecord', {'Domain': d.DOMAIN, 'SubDomain': 'www', 'RecordType': 'TXT', 'Status': 'ENABLE', 'Value': TOKEN})]:
            with self.subTest(action=action), self.assertRaises(d.DnsError):
                client.call(action, params)
        opener.open.assert_not_called()
        headers = d.signed_headers(CREDS['SecretId'], CREDS['SecretKey'], 'DescribeRecordList', b'{"Domain":"lycee-toolbox.top"}', 1600000000)
        self.assertEqual(headers['Host'], 'dnspod.tencentcloudapi.com')
        self.assertEqual(headers['X-TC-Version'], '2021-03-23')
        self.assertIn('2020-09-13/dnspod/tc3_request', headers['Authorization'])
        self.assertNotIn(CREDS['SecretKey'], headers['Authorization'])
        self.assertRegex(headers['Authorization'], r'Signature=[0-9a-f]{64}$')
        # Generated independently with TencentCloud's official SDK and dummy keys.
        self.assertTrue(headers['Authorization'].endswith('Signature=4daf23e6587787346751447ac079ede869b5c1d944a98b6011343af42145520e'))
        self.assertRaises(d.DnsError, d.NoRedirect().redirect_request, None, None, 302, '', {}, 'https://evil.top/')

    def test_list_never_exposes_txt_or_extra_fields(self):
        client = d.DnsPod(CREDS)
        def response(action, params):
            return {'RecordList': [{'RecordId': 1, 'Name': '@', 'Type': params['RecordType'], 'Value': 'public', 'Remark': 'private'},
                                   {'RecordId': 2, 'Name': '_acme-challenge', 'Type': 'TXT', 'Value': 'private-challenge'}]}
        client.call = Mock(side_effect=response)
        records = client.list_metadata()
        self.assertEqual(len(records), 4)
        self.assertTrue(all(record['Type'] in d.VISIBLE_TYPES and 'Remark' not in record for record in records))
        self.assertNotIn('private-challenge', json.dumps(records))
        self.assertEqual({call.args[1]['RecordType'] for call in client.call.call_args_list}, d.VISIBLE_TYPES)

    def test_auth_creates_new_txt_and_does_not_modify_existing_records(self):
        client = d.DnsPod(CREDS)
        client.call = Mock(return_value={'RecordId': 42})
        self.assertEqual(client.create_challenge('_acme-challenge.preview', TOKEN), 42)
        action, params = client.call.call_args.args
        self.assertEqual(action, 'CreateRecord')
        self.assertEqual(params['RecordType'], 'TXT')
        self.assertEqual(params['RecordLine'], '默认')
        self.assertEqual(params['Remark'], d.challenge_remark(params['SubDomain'], TOKEN))

    def test_cleanup_refuses_other_record_type_name_value_id_or_owner(self):
        name = '_acme-challenge.preview'
        info = {'Id': 42, 'SubDomain': name, 'RecordType': 'TXT', 'Value': TOKEN, 'Remark': d.challenge_remark(name, TOKEN)}
        for change in ({'Id': 43}, {'SubDomain': '_acme-challenge.www'}, {'RecordType': 'CNAME'},
                       {'Value': 'another-challenge'}, {'Remark': 'manually-created'}):
            with self.subTest(change=change):
                client = d.DnsPod(CREDS)
                client.call = Mock(return_value={'RecordInfo': dict(info, **change)})
                with self.assertRaises(d.DnsError):
                    client.cleanup_challenge(42, name, TOKEN)
                self.assertEqual([call.args[0] for call in client.call.call_args_list], ['DescribeRecord'])

    def test_cleanup_deletes_exact_verified_record_and_missing_is_idempotent(self):
        name = '_acme-challenge'
        client = d.DnsPod(CREDS)
        client.call = Mock(side_effect=[{'RecordInfo': {'Id': 42, 'SubDomain': name, 'RecordType': 'TXT', 'Value': TOKEN,
                                                       'Remark': d.challenge_remark(name, TOKEN)}}, {}])
        self.assertTrue(client.cleanup_challenge(42, name, TOKEN))
        self.assertEqual(client.call.call_args.args, ('DeleteRecord', {'Domain': d.DOMAIN, 'RecordId': 42}))
        for code in ('ResourceNotFound.NoDataOfRecord', 'InvalidParameter.RecordIdInvalid'):
            with self.subTest(missing_record_response=code):
                client.call = Mock(side_effect=d.ApiError(code))
                self.assertFalse(client.cleanup_challenge(42, name, TOKEN))
                client.call.assert_called_once_with('DescribeRecord', {'Domain': d.DOMAIN, 'RecordId': 42})

    def test_api_diagnostics_hide_payloads_and_credentials(self):
        raw = json.dumps({'Response': {'Error': {'Code': 'AuthFailure.SignatureFailure', 'Message': 'private-challenge example-secret'}}}).encode()
        response = Mock()
        response.read.return_value = raw
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        client = d.DnsPod(CREDS, opener=opener)
        with self.assertRaisesRegex(d.ApiError, 'AuthFailure.SignatureFailure') as caught:
            client.call('DescribeRecordList', {'Domain': d.DOMAIN})
        self.assertNotIn('private-challenge', str(caught.exception))
        self.assertNotIn('example-secret', str(caught.exception))
        self.assertEqual(opener.open.call_args.args[0].full_url, 'https://dnspod.tencentcloudapi.com/')

    def test_cli_stdout_and_minimum_propagation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials.json'
            path.write_text(json.dumps(CREDS))
            client = Mock()
            client.create_challenge.return_value = 42
            factory = Mock(return_value=client)
            sleeps = []
            environ = {'CERTBOT_DOMAIN': '*.preview.lycee-toolbox.top', 'CERTBOT_VALIDATION': TOKEN}
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = d.main(['--credentials', str(path), 'acme-auth', '--propagation-seconds', '65'],
                                environ=environ, client_factory=factory, sleeper=sleeps.append)
            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '42\n')
            self.assertEqual(sum(sleeps), 65)
            self.assertTrue(all(seconds <= 30 for seconds in sleeps))
            environ['CERTBOT_AUTH_OUTPUT'] = '42\n'
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                result = d.main(['--credentials', str(path), 'acme-cleanup'], environ=environ, client_factory=factory)
            self.assertEqual(result, 0)
            self.assertEqual(stdout.getvalue(), '')
            client.cleanup_challenge.assert_called_once_with(42, '_acme-challenge.preview', TOKEN)
            self.assertRaises(Exception, d.propagation_seconds, 59)

    def test_credentials_wrong_zone_and_malformed_auth_output_fail_before_api(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials.json'
            path.write_text(json.dumps(dict(CREDS, Domain='other.top')))
            self.assertRaises(d.DnsError, d.load_credentials, path)
            path.write_text(json.dumps(CREDS))
            factory = Mock()
            with contextlib.redirect_stderr(io.StringIO()):
                result = d.main(['--credentials', str(path), 'acme-cleanup'],
                    environ={'CERTBOT_DOMAIN': d.DOMAIN, 'CERTBOT_VALIDATION': TOKEN, 'CERTBOT_AUTH_OUTPUT': '42\n43'}, client_factory=factory)
            self.assertEqual(result, 1)
            factory.assert_not_called()


if __name__ == '__main__':
    unittest.main()
