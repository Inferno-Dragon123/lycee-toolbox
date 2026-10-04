#!/usr/bin/python3
# lycee-managed: verified backup v1
"""Private PostgreSQL backup, real restore test, checksums, optional verified offsite copy."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def pg(sql):
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'postgres'],
               input=sql.encode(), capture_output=True).stdout.decode().strip()


def settings():
    values = {}
    for line in Path('/etc/lycee/host.conf').read_text().splitlines():
        if re.match(r'^[A-Z][A-Z0-9_]*=', line):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"').strip("'")
    return values


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Backup must run as root; output contains database and auth secrets')
    os.umask(0o077)
    lock = open('/run/lycee-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    cfg = settings()
    if not pg("SELECT 1 FROM pg_database WHERE datname='lycee_production';"):
        raise RuntimeError('Production database not initialized')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid())
    directory = Path('/var/backups/lycee') / stamp
    directory.mkdir(mode=0o700)
    dump = directory / 'database.dump'
    with dump.open('wb') as out:
        run(['runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-d', 'lycee_production'], stdout=out)
    verify_db = 'lycee_backup_verify_' + str(os.getpid())
    pg(f'CREATE DATABASE {verify_db};')
    try:
        with dump.open('rb') as stream:
            run(['runuser', '-u', 'postgres', '--', 'pg_restore', '--exit-on-error', '--single-transaction',
                 '--no-owner', '--no-acl', '-d', verify_db], stdin=stream, stdout=subprocess.DEVNULL)
        # SQL is checked against the restored database, not the concurrently changing source.
        result = run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', verify_db],
                     input=b"SELECT count(*) FROM toolbox_publications; SELECT count(*) FROM toolbox_decks;", capture_output=True).stdout.decode().splitlines()
    finally:
        pg(f'DROP DATABASE IF EXISTS {verify_db};')
    with tarfile.open(directory / 'private-config.tar.gz', 'w:gz') as tar:
        tar.add('/etc/lycee', arcname='etc/lycee')
    (directory / 'verification.json').write_text(json.dumps({'utc': stamp, 'restored': True,
        'publications': int(result[0]), 'snapshots': int(result[1]), 'postgresMajor': 18}) + '\n')
    files = ['database.dump', 'private-config.tar.gz', 'verification.json']
    checksum = ''.join(hashlib.file_digest((directory / name).open('rb'), 'sha256').hexdigest() + '  ' + name + '\n' for name in files)
    (directory / 'SHA256SUMS').write_text(checksum)
    offsite = cfg.get('BACKUP_OFFSITE', '')
    if offsite:
        match = re.fullmatch(r'([a-zA-Z0-9_.@-]+):(/[a-zA-Z0-9_./-]+)', offsite)
        if not match or '..' in Path(match[2]).parts:
            raise RuntimeError('BACKUP_OFFSITE must be user@host:/absolute/simple/path')
        host, root = match.groups()
        remote = root.rstrip('/') + '/' + stamp
        ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', host]
        run(ssh + [f"umask 077; mkdir -p -- '{remote}'; chmod 700 -- '{remote}'"])
        run(['rsync', '-a', '--checksum', '-e', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes', str(directory) + '/', host + ':' + remote + '/'])
        run(ssh + [f"cd '{remote}' && sha256sum --check --strict SHA256SUMS"])
        (directory / 'offsite-verified').write_text('verified\n')
    retention = max(3, int(cfg.get('BACKUP_RETENTION_DAYS', '14')))
    cutoff = time.time() - retention * 86400
    for old in directory.parent.iterdir():
        if old.is_dir() and not old.is_symlink() and re.fullmatch(r'\d{8}T\d{6}Z-\d+', old.name) and old.stat().st_mtime < cutoff:
            shutil.rmtree(old)
    print(json.dumps({'backup': stamp, 'restored': True, 'offsiteVerified': bool(offsite)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Backup failed: ' + (type(error).__name__ if isinstance(error, (OSError, subprocess.CalledProcessError)) else str(error)), file=sys.stderr)
        sys.exit(1)
