"""Export source business tables with pg_dump18; credentials stay out of argv/logs."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, unquote


def read_env(filename):
    values = {}
    for line in Path(filename).read_text(encoding='utf-8-sig').splitlines():
        match = re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*', line)
        if not match:
            continue
        value = match[2]
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(' #', 1)[0].rstrip()
        values[match[1]] = value
    return values


def export_business(env_file, expected_host, output):
    values = read_env(env_file)
    url = urlsplit(values.get('DATABASE_URL_UNPOOLED', ''))
    if not expected_host or url.hostname != expected_host or '-pooler' in (url.hostname or ''):
        raise ValueError('Source database host guard failed')
    if url.scheme not in ('postgres', 'postgresql') or not url.username or not url.path.strip('/'):
        raise ValueError('A direct PostgreSQL URL is required')
    child_env = os.environ.copy()
    child_env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGUSER=unquote(url.username),
                     PGPASSWORD=unquote(url.password or ''), PGDATABASE=unquote(url.path[1:]),
                     PGSSLMODE='verify-full', PGSSLROOTCERT='system', PGCONNECT_TIMEOUT='20',
                     PGOPTIONS='-c statement_timeout=120000')
    output = Path(output).resolve()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output.exists():
        raise ValueError('Backup path already exists; use a new timestamped filename')
    old_umask = os.umask(0o077)
    try:
        result = subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl',
                                 '--table=public.toolbox_*', '--exclude-table=public.toolbox_auth_*',
                                 '--file', str(output)], env=child_env, capture_output=True, timeout=240)
        if result.returncode:
            raise RuntimeError('pg_dump failed; source or target access must be checked privately')
        output.chmod(0o600)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        return {'bytes': output.stat().st_size, 'sha256': digest}
    finally:
        os.umask(old_umask)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--expect-host', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        import json
        print(json.dumps({'backup': export_business(args.env_file, args.expect_host, args.out)}))
    except Exception as error:
        print('Business backup failed: ' + type(error).__name__)
        raise SystemExit(1)
