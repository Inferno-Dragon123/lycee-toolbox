#!/usr/bin/python3
# lycee-managed: deployment manager v1
"""Root-owned deployment control plane. Application code always runs as its own user."""
import argparse
import contextlib
import datetime as dt
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from urllib.parse import urlparse

BASE = Path('/opt/lycee/instances')
CONFIG = Path('/etc/lycee/host.conf')
ENV_DIR = Path('/etc/lycee/instances')
INCOMING = Path('/var/lib/lycee/incoming')
MARKER = '# lycee-managed:'
TARGET_RE = re.compile(r'^(production|p-[0-9a-f]{12})$')
SHA_RE = re.compile(r'^[0-9a-f]{40}$')
ALLOWED_ROOTS = {'api', 'lib', 'public', 'scripts', 'migrations', 'data', 'node_modules',
                 'package.json', 'package-lock.json', 'lycee-japanese-database-final.json',
                 'lycee-chinese-database-final.json', 'RELEASE.json'}


def fail(message):
    raise RuntimeError(message)


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def read_env(file):
    # Matches this project's simple KEY=value EnvironmentFile format, without shell evaluation.
    result = {}
    for line in file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if not re.match(r'^[A-Z][A-Z0-9_]*=', line):
            fail(f'Invalid environment line in {file.name}')
        key, value = line.split('=', 1)
        if '\x00' in value or '\n' in value or '\r' in value:
            fail('Invalid environment value')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        result[key] = value
    return result


def config():
    st = CONFIG.stat()
    if st.st_uid != 0 or st.st_mode & 0o022:
        fail('host.conf must be root-owned and not group/world writable')
    return read_env(CONFIG)


def write_env(file, values, user):
    gid = grp.getgrnam(user).gr_gid
    text = MARKER + ' instance environment v1\n'
    for key, value in values.items():
        value = str(value)
        if any(x in value for x in ['\n', '\r', '\x00', '"', '\\']):
            fail(f'{key} needs a simple value without newline/double quote/backslash')
        text += f'{key}="{value}"\n'
    tmp = file.with_suffix('.new')
    tmp.write_text(text)
    os.chmod(tmp, 0o640)
    os.chown(tmp, 0, gid)
    tmp.replace(file)


def identity(target):
    return ('lycee-production', 'lycee_production') if target == 'production' else (
        'lycee-' + target, 'lycee_preview_' + target[2:])


def psql(sql, database='postgres'):
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                '-At', '-d', database], input=sql, capture_output=True).stdout.strip()


def create_preview(target, cfg, ref):
    user, database = identity(target)
    existing = [p for p in ENV_DIR.glob('p-*.env') if TARGET_RE.fullmatch(p.stem)]
    max_previews = min(2, max(1, int(cfg.get('PREVIEW_MAX', '2'))))
    if len(existing) >= max_previews:
        # Reject instead of unexpectedly deleting another person's active preview.
        fail(f'{max_previews} previews already exist; delete a branch or run expiry cleanup first')
    if not re.fullmatch(r'[a-z0-9.-]+', cfg.get('PREVIEW_DOMAIN', '')):
        fail('PREVIEW_DOMAIN is not configured')
    try:
        pwd.getpwnam(user)
    except KeyError:
        run(['useradd', '--system', '--user-group', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', user])
    run(['usermod', '-aG', 'lycee-assets', user])
    password = secrets.token_hex(32)
    if psql(f"SELECT 1 FROM pg_database WHERE datname='{database}';"):
        fail('Unexpected pre-existing preview database; inspect before reuse')
    if psql(f"SELECT 1 FROM pg_roles WHERE rolname='{database}';"):
        fail('Unexpected pre-existing preview DB role; inspect before reuse')
    psql(f"CREATE ROLE {database} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 12;")
    psql(f'CREATE DATABASE {database} OWNER {database};\nREVOKE ALL ON DATABASE {database} FROM PUBLIC;')
    port_min = int(cfg.get('PREVIEW_PORT_MIN', '3101'))
    used = {int(read_env(p)['PORT']) for p in existing}
    port = next((n for n in range(port_min, port_min + max_previews) if n not in used), None)
    if port is None or port < 1024 or port > 65000:
        fail('No valid preview port available')
    state_dir = Path('/var/lib/lycee') / target
    state_dir.mkdir(mode=0o750, exist_ok=True)
    os.chown(state_dir, pwd.getpwnam(user).pw_uid, grp.getgrnam(user).gr_gid)
    origin = f'https://{target}.{cfg["PREVIEW_DOMAIN"]}'
    url = f'postgresql://{database}:{password}@127.0.0.1:5432/{database}'
    values = {'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'TRUST_PROXY': 'loopback',
              'PORT': str(port), 'SITE_ORIGIN': origin, 'AUTH_PROVIDER': 'better-auth',
              'BETTER_AUTH_SECRET': secrets.token_hex(32), 'DATABASE_URL': url, 'DATABASE_URL_UNPOOLED': url,
              'IMAGE_STORAGE_DIR': '/var/lib/lycee/images',
              'IMAGE_PUBLIC_ORIGIN': origin, 'PDF_CONCURRENCY': '1',
              'DEPLOYMENT_KIND': 'preview'}
    # Explicit whitelist: NEVER read/copy the production .env or production SMTP account.
    for key in ['HOST', 'PORT', 'SECURE', 'USER', 'PASS', 'FROM']:
        value = cfg.get('PREVIEW_SMTP_' + key, '')
        if value:
            values['SMTP_' + key] = value
    write_env(ENV_DIR / f'{target}.env', values, user)
    return values


def init_production(args, cfg):
    if os.environ.get('SUDO_USER') in ('lycee-deploy', 'lycee-release'):
        fail('Only the host operator may initialize production')
    origin = args.origin or cfg.get('PRODUCTION_ORIGIN')
    parsed = urlparse(origin or '')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        fail('Use HTTPS origin or an isolated SSH tunnel HTTP loopback origin')
    user, database = identity('production')
    file = ENV_DIR / 'production.env'
    if file.exists() or psql(f"SELECT 1 FROM pg_database WHERE datname='{database}';") or psql(f"SELECT 1 FROM pg_roles WHERE rolname='{database}';"):
        fail('Production env, database or role already exists; initialization never overwrites it')
    password = secrets.token_hex(32)
    psql(f"CREATE ROLE {database} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;")
    psql(f'CREATE DATABASE {database} OWNER {database};\nREVOKE ALL ON DATABASE {database} FROM PUBLIC;')
    url = f'postgresql://{database}:{password}@127.0.0.1:5432/{database}'
    write_env(file, {'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'TRUST_PROXY': 'loopback',
        'PORT': cfg.get('PRODUCTION_PORT', '3100'), 'SITE_ORIGIN': origin,
        'AUTH_PROVIDER': 'better-auth', 'BETTER_AUTH_SECRET': secrets.token_hex(32),
        'DATABASE_URL': url, 'DATABASE_URL_UNPOOLED': url, 'DEPLOYMENT_KIND': 'production',
        'IMAGE_STORAGE_DIR': '/var/lib/lycee/images', 'IMAGE_PUBLIC_ORIGIN': origin,
        'PDF_CONCURRENCY': '1', 'MAINTENANCE_ENABLED': '0'}, user)
    print('Created local production role/database and private environment; SMTP and live deployment remain disabled.')


def app_run(user, release, env, script, *arguments):
    clean = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', **env}
    # Credentials travel in the environment, not process arguments/logged URLs.
    return run(['/usr/sbin/runuser', '-u', user, '--', '/usr/local/bin/node', str(release / script), *arguments],
               cwd=release, env=clean)


def validate_env(target, values, cfg):
    user, database = identity(target)
    for key in ['BETTER_AUTH_SECRET', 'SITE_ORIGIN', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'PORT']:
        if not values.get(key) or 'REPLACE_' in values[key]:
            fail(f'{key} must be configured for {target}')
    for key in ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']:
        parsed = urlparse(values[key])
        if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path != '/' + database or parsed.username != database:
            fail(f'{target} must use its own localhost database and role')
    if len(values['BETTER_AUTH_SECRET']) < 32 or values.get('AUTH_PROVIDER') != 'better-auth':
        fail('A unique BETTER_AUTH_SECRET and local better-auth provider are required')
    if target != 'production':
        if values['SITE_ORIGIN'] != f'https://{target}.{cfg["PREVIEW_DOMAIN"]}':
            fail('Preview origin does not match its branch hostname')
        prod = ENV_DIR / 'production.env'
        if prod.exists() and read_env(prod).get('BETTER_AUTH_SECRET') == values['BETTER_AUTH_SECRET']:
            fail('Preview and production BETTER_AUTH_SECRET must differ')
    return user, database


def extract(archive, release, user, sha):
    gid = grp.getgrnam(user).gr_gid
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > 80000 or sum(max(0, m.size) for m in members) > 900 * 1024 * 1024:
            fail('Release archive exceeds runtime size/member limit')
        for m in members:
            name = m.name.removeprefix('./')
            if not name or name.split('/')[0] not in ALLOWED_ROOTS:
                fail('Unexpected top-level archive content')
            if any(part.startswith('.env') for part in Path(name).parts) or m.isdev() or m.isfifo():
                fail('Release archive includes a secret file or special device')
        # Python data filter rejects absolute/path traversal and escaping link targets.
        tar.extractall(release, filter='data')
    metadata = json.loads((release / 'RELEASE.json').read_text())
    if metadata.get('sha') != sha or metadata.get('nodeMajor') != 24:
        fail('Release metadata does not match requested commit/runtime')
    for required in ['scripts/server.js', 'scripts/migrate.js', 'scripts/migrate-local-auth.js',
                     'public/community.bundle.js', 'public/print-pdf.bundle.js',
                     'node_modules']:
        if not (release / required).exists():
            fail(f'Release missing {required}')
    for base, dirs, files in os.walk(release, followlinks=False):
        os.chown(base, 0, gid)
        os.chmod(base, 0o750)
        for name in dirs + files:
            file = Path(base) / name
            if file.is_symlink():
                os.lchown(file, 0, gid)
            else:
                old_mode = file.stat().st_mode
                os.chown(file, 0, gid)
                os.chmod(file, 0o750 if file.is_dir() or old_mode & 0o111 else 0o640)


def healthy(port, attempts=30, origin=None):
    for _ in range(attempts):
        try:
            request = urllib.request.Request(f'http://127.0.0.1:{port}/api/health', headers={'Host': urlparse(origin).netloc} if origin else {})
            with urllib.request.urlopen(request, timeout=3) as response:
                if response.status == 200 and json.load(response).get('status') == 'ok':
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


def nginx(target, values, cfg):
    from urllib.parse import urlparse
    origin = urlparse(values['SITE_ORIGIN'])
    host = origin.hostname
    if not host or not re.fullmatch(r'[a-zA-Z0-9.-]+', host):
        fail('Invalid site hostname')
    tls = origin.scheme == 'https'
    if origin.scheme not in ('http', 'https') or (tls and origin.port and origin.port != 443):
        fail('Nginx deployment requires standard HTTPS or a loopback HTTP rehearsal')
    if not tls and host not in ('127.0.0.1', 'localhost'):
        fail('HTTP rehearsals must be reached through an SSH tunnel to loopback')
    cert = cfg.get('TLS_CERT' if target == 'production' else 'PREVIEW_TLS_CERT')
    key = cfg.get('TLS_KEY' if target == 'production' else 'PREVIEW_TLS_KEY')
    if tls and (not cert or not key or not Path(cert).is_file() or not Path(key).is_file()):
        fail('Install TLS certificate and key before this hostname is deployed')
    tls_lines = f'listen 443 ssl;\n    ssl_certificate {cert};\n    ssl_certificate_key {key};\n    ssl_protocols TLSv1.2 TLSv1.3;' if tls else 'listen 127.0.0.1:80;'
    redirect = f'server {{ listen 80; server_name {host}; return 301 https://$host$request_uri; }}\n' if tls else ''
    text = f'''{MARKER} Nginx instance v1\n{redirect}server {{
    {tls_lines}
    server_name {host};
    client_max_body_size 32k;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    access_log /var/log/nginx/lycee-{target}.access.log;
    error_log /var/log/nginx/lycee-{target}.error.log;
    location ~ "^/images/(original/((LO-[0-9]{{4}}(-?[A-Z]+)?|card-back)\\.png)|thumb/(LO-[0-9]{{4}}(-?[A-Z]+)?)\\.webp)$" {{
        root /var/lib/lycee;
        try_files $uri @lycee_node;
        expires 1h;
        add_header X-Content-Type-Options nosniff;
        add_header Access-Control-Allow-Origin "*";
        access_log off;
    }}
    location /images/ {{ return 404; }}
    location /api/auth/ {{
        gzip off;
        proxy_pass http://127.0.0.1:{values['PORT']};
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For "";
        proxy_set_header Connection "";
        proxy_http_version 1.1;
        proxy_read_timeout 30s;
    }}
    location / {{ try_files /__lycee_no_static_file__ @lycee_node; }}
    location @lycee_node {{
        proxy_pass http://127.0.0.1:{values['PORT']};
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For "";
        proxy_set_header Connection "";
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }}
}}
'''
    conf = Path('/etc/nginx/conf.d') / f'lycee-{target}.conf'
    if conf.exists() and not conf.read_text().startswith(MARKER):
        fail('Refusing to replace unmanaged Nginx site')
    old = conf.read_text() if conf.exists() else None
    conf.write_text(text)
    try:
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    except Exception:
        if old is None:
            conf.unlink(missing_ok=True)
        else:
            conf.write_text(old)
        run(['nginx', '-t'])
        raise


def deploy(args, cfg):
    target = args.target
    if target == 'production' and cfg.get('MIGRATION_LIVE') != '1':
        if not args.rehearsal or os.environ.get('SUDO_USER') in ('lycee-deploy', 'lycee-release'):
            fail('Production deployment disabled: MIGRATION_LIVE=0 (root may explicitly --rehearsal)')
    if target != 'production' and args.rehearsal:
        fail('--rehearsal is a production-only root operation')
    archive = INCOMING / ('production' if target == 'production' else 'preview') / (args.sha + '.tar.gz')
    if archive.is_symlink() or not archive.is_file():
        fail('Expected uploaded commit archive is missing or a symlink')
    ref = bytes.fromhex(args.ref_hex).decode('utf-8') if args.ref_hex else 'master'
    if len(ref) > 300 or '\x00' in ref:
        fail('Invalid branch ref')
    if target == 'production' and ref != 'master':
        fail('Production releases must use the master ref')
    if target != 'production' and target != 'p-' + hashlib.sha256(ref.encode()).hexdigest()[:12]:
        fail('Preview ID does not match branch hash')
    file = ENV_DIR / f'{target}.env'
    newly_created = target != 'production' and not file.exists()
    values = create_preview(target, cfg, ref) if newly_created else read_env(file)
    user, _ = validate_env(target, values, cfg)
    instance = BASE / target
    instance.mkdir(mode=0o750, exist_ok=True)
    os.chown(instance, 0, grp.getgrnam(user).gr_gid)
    releases = instance / 'releases'
    releases.mkdir(mode=0o750, exist_ok=True)
    os.chown(releases, 0, grp.getgrnam(user).gr_gid)
    release = releases / (args.sha + '-' + str(int(time.time())))
    release.mkdir(mode=0o750)
    state_temp = Path('/var/lib/lycee') / target / 'temp'
    state_temp.mkdir(mode=0o750, exist_ok=True)
    os.chown(state_temp, pwd.getpwnam(user).pw_uid, grp.getgrnam(user).gr_gid)
    candidate_name = 'lycee-candidate-' + target
    candidate_env = ENV_DIR / f'{target}.candidate.env'
    current = instance / 'current'
    previous = current.resolve() if current.is_symlink() else None
    switched = False
    try:
        extract(archive, release, user, args.sha)
        if target == 'production':
            # The asset worker may read release code/catalog, but never the production .env.
            for directory in [instance, releases]:
                run(['setfacl', '-m', 'u:lycee-assets:rx', str(directory)])
            run(['setfacl', '-R', '-m', 'u:lycee-assets:rX', str(release)])
        (release / 'temp').symlink_to(state_temp)
        if target == 'production':
            run(['/usr/local/lib/lycee/backup.sh', '--before-deploy'])
        app_run(user, release, values, 'scripts/migrate.js')
        app_run(user, release, values, 'scripts/migrate-local-auth.js', '--expect-host', '127.0.0.1', '--apply')
        missing = psql('SELECT count(*) FROM toolbox_publications p LEFT JOIN toolbox_publication_compositions c ON c.publication_id=p.id WHERE p.status<>\'deleted\' AND c.publication_id IS NULL;', identity(target)[1])
        if int(missing) > 0:
            app_run(user, release, values, 'scripts/backfill-deck-compositions.js', '--expect-host', '127.0.0.1', '--apply')
        if newly_created and cfg.get('PREVIEW_SEED_SOURCE_URL'):
            seed_env = {**values, 'SOURCE_DATABASE_URL': cfg['PREVIEW_SEED_SOURCE_URL']}
            app_run(user, release, seed_env, 'scripts/seed-preview.js', '--expect-source-host', '127.0.0.1')
        candidate_port = 3900
        write_env(candidate_env, {**values, 'PORT': str(candidate_port)}, user)
        run(['systemd-run', '--unit=' + candidate_name, '--uid=' + user, '--gid=' + user,
             '--property=Type=exec', '--property=WorkingDirectory=' + str(release),
             '--property=SupplementaryGroups=lycee-assets',
             '--property=EnvironmentFile=' + str(candidate_env), '--property=MemoryMax=384M' if target != 'production' else '--property=MemoryMax=1100M',
             '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict',
             '--property=ReadWritePaths=/var/lib/lycee/' + target, '--property=PrivateTmp=yes',
             '/usr/local/bin/node', str(release / 'scripts/server.js')])
        if not healthy(candidate_port, origin=values['SITE_ORIGIN']):
            fail('Candidate readiness failed; active version was not switched')
        run(['systemctl', 'stop', candidate_name])
        # os.replace is an atomic symlink update on the same filesystem.
        staged = instance / 'current.new'
        staged.unlink(missing_ok=True)
        staged.symlink_to(release)
        staged.replace(current)
        switched = True
        run(['systemctl', 'enable', '--now', 'lycee@' + target])
        run(['systemctl', 'restart', 'lycee@' + target])
        if not healthy(values['PORT'], origin=values['SITE_ORIGIN']):
            fail('Live readiness failed')
        nginx(target, values, cfg)
        (instance / 'metadata.json').write_text(json.dumps({'target': target, 'ref': ref, 'sha': args.sha,
            'url': values['SITE_ORIGIN'], 'deployedAt': dt.datetime.now(dt.timezone.utc).isoformat()}) + '\n')
        archive.unlink(missing_ok=True)
        # Preserve current plus two rollback releases; never remove active symlink target.
        old = sorted(releases.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for directory in old[3:]:
            if directory != current.resolve():
                shutil.rmtree(directory)
        print(json.dumps({'ok': True, 'url': values['SITE_ORIGIN'], 'sha': args.sha}))
    except Exception:
        if switched:
            if previous:
                staged = instance / 'current.new'
                staged.unlink(missing_ok=True)
                staged.symlink_to(previous)
                staged.replace(current)
                run(['systemctl', 'restart', 'lycee@' + target])
                if not healthy(values['PORT'], origin=values['SITE_ORIGIN']):
                    print('WARNING: rollback readiness failed; operator action required', file=sys.stderr)
            else:
                run(['systemctl', 'stop', 'lycee@' + target], stdout=subprocess.DEVNULL)
                current.unlink(missing_ok=True)
        if release.exists() and (not current.exists() or current.resolve() != release):
            shutil.rmtree(release)
        if newly_created:
            cleanup_target(target)
        raise
    finally:
        subprocess.run(['systemctl', 'stop', candidate_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['systemctl', 'reset-failed', candidate_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        candidate_env.unlink(missing_ok=True)


def cleanup_target(target):
    if not TARGET_RE.fullmatch(target) or target == 'production':
        fail('Only preview instances can be removed')
    user, database = identity(target)
    for unit in ['lycee@' + target, 'lycee-candidate-' + target]:
        subprocess.run(['systemctl', 'disable', '--now', unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    conf = Path('/etc/nginx/conf.d') / f'lycee-{target}.conf'
    if conf.exists():
        if not conf.read_text().startswith(MARKER):
            fail('Refusing to delete an unmanaged Nginx config')
        conf.unlink()
    psql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{database}';")
    psql(f'DROP DATABASE IF EXISTS {database};\nDROP ROLE IF EXISTS {database};')
    (ENV_DIR / f'{target}.env').unlink(missing_ok=True)
    (ENV_DIR / f'{target}.candidate.env').unlink(missing_ok=True)
    for parent in [BASE, Path('/var/lib/lycee')]:
        directory = parent / target
        if directory.is_symlink():
            fail('Refusing to recursively remove a symlink instance')
        if directory.exists():
            shutil.rmtree(directory)
    subprocess.run(['userdel', user], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(['nginx', '-t'])
    run(['systemctl', 'reload', 'nginx'])
    print(json.dumps({'removed': target}))


def main():
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest='command', required=True)
    d = subs.add_parser('deploy')
    d.add_argument('--target', required=True)
    d.add_argument('--sha', required=True)
    d.add_argument('--ref-hex', default='')
    d.add_argument('--rehearsal', action='store_true')
    c = subs.add_parser('cleanup')
    c.add_argument('--target')
    c.add_argument('--expired', action='store_true')
    subs.add_parser('check')
    initial = subs.add_parser('init-production')
    initial.add_argument('--origin')
    args = parser.parse_args()
    if os.geteuid() != 0:
        fail('Run through the installed restricted sudo command')
    if getattr(args, 'target', None) and not TARGET_RE.fullmatch(args.target):
        fail('Invalid target')
    if args.command == 'deploy' and not SHA_RE.fullmatch(args.sha):
        fail('Commit SHA must be 40 lowercase hexadecimal characters')
    lock = open('/run/lycee-deployment.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    cfg = config()
    caller = os.environ.get('SUDO_USER')
    if caller == 'lycee-deploy' and (args.command == 'init-production' or getattr(args, 'target', None) == 'production' or getattr(args, 'expired', False)):
        fail('Preview SSH account cannot manage production or sweep other previews')
    if caller == 'lycee-release' and args.command != 'check' and not (args.command == 'deploy' and args.target == 'production' and not args.rehearsal):
        fail('Production SSH account may only deploy live master')
    if args.command == 'check':
        print(json.dumps({'productionEnabled': cfg.get('MIGRATION_LIVE') == '1',
                          'instances': [p.stem for p in ENV_DIR.glob('*.env') if TARGET_RE.fullmatch(p.stem)]}))
        run(['nginx', '-t'])
    elif args.command == 'deploy':
        deploy(args, cfg)
    elif args.command == 'init-production':
        init_production(args, cfg)
    elif args.target:
        cleanup_target(args.target)
    elif args.expired:
        if os.environ.get('SUDO_USER') in ('lycee-deploy', 'lycee-release'):
            fail('Only the root cleanup timer may sweep all expired previews')
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(cfg.get('PREVIEW_TTL_DAYS', '7')))
        for file in BASE.glob('p-*/metadata.json'):
            metadata = json.loads(file.read_text())
            if dt.datetime.fromisoformat(metadata['deployedAt']) < cutoff:
                cleanup_target(file.parent.name)
    else:
        fail('Specify --target or --expired')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Avoid printing subprocess args/environments or PostgreSQL passwords on CI.
        if isinstance(error, (subprocess.CalledProcessError, OSError)):
            print('Deployment failed: ' + type(error).__name__ + '; inspect host journal privately', file=sys.stderr)
        else:
            print('Deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
