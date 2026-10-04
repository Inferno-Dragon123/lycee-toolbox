#!/usr/bin/python3
# lycee-managed: verified backup v1
"""Private PostgreSQL backup, restore test, age encryption and verified offsite copy."""
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
import tempfile
import time


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def pg(sql):
    return run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'postgres'],
               input=sql.encode(), capture_output=True).stdout.decode().strip()


def settings():
    values = {}
    for line in Path('/etc/lycee/host.conf').read_text().splitlines():
        if re.match(r'^[A-Z][A-Z0-9_]*=', line):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"').strip("'")
    return values


def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def encrypt_archive(directory, recipient_file):
    """Only the age public recipient lives on the server; no recovery private key."""
    recipient_path = Path(recipient_file)
    if not recipient_path.is_absolute() or recipient_path.is_symlink():
        raise RuntimeError('Backup recipient must be an absolute regular file')
    recipient = recipient_path.read_text().strip()
    if not re.fullmatch(r'age1[0-9a-z]{50,100}', recipient):
        raise RuntimeError('Backup recipient must contain one age public key')
    archive = directory.with_suffix('.tar.age')
    temporary = archive.with_suffix('.age.tmp')
    try:
        # Anonymous 0600 temporary storage avoids a second named plaintext archive.
        with tempfile.TemporaryFile() as plain:
            with tarfile.open(fileobj=plain, mode='w') as tar:
                for name in ('database.dump', 'private-config.tar.gz', 'verification.json', 'SHA256SUMS'):
                    tar.add(directory / name, arcname=name, recursive=False)
            plain.seek(0)
            run(['/usr/bin/age', '--encrypt', '--recipient', recipient, '--output', str(temporary)],
                stdin=plain, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    digest = sha256(archive)
    checksum_file = archive.with_suffix(archive.suffix + '.sha256')
    checksum_file.write_text(digest + '  ' + archive.name + '\n')
    return archive, checksum_file, digest


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Backup must run as root; output contains database and auth secrets')
    os.umask(0o077)
    lock = open('/run/lycee-backup.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    cfg = settings()
    offsite = cfg.get('BACKUP_OFFSITE', '')
    cos_config = cfg.get('BACKUP_COS_CONFIG', '')
    recipient_file = cfg.get('BACKUP_RECIPIENT_FILE', '/etc/lycee/backup-recipient.txt')
    encryption_required = cfg.get('BACKUP_REQUIRE_ENCRYPTION', '0') == '1' or bool(offsite or cos_config)
    encrypt = Path(recipient_file).is_file()
    if encryption_required and not encrypt:
        raise RuntimeError('Configure the offline recovery recipient before enabling encrypted backups')
    if not pg("SELECT 1 FROM pg_database WHERE datname='lycee_production';"):
        raise RuntimeError('Production database not initialized')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid())
    directory = Path('/var/backups/lycee') / stamp
    directory.mkdir(mode=0o700)
    dump = directory / 'database.dump'
    with dump.open('wb') as out:
        run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-d', 'lycee_production'], stdout=out)
    verify_db = 'lycee_backup_verify_' + str(os.getpid())
    pg(f'CREATE DATABASE {verify_db};')
    try:
        with dump.open('rb') as stream:
            run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'pg_restore', '--exit-on-error', '--single-transaction',
                 '--no-owner', '--no-acl', '-d', verify_db], stdin=stream, stdout=subprocess.DEVNULL)
        # SQL is checked against the restored database, not the concurrently changing source.
        result = run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', verify_db],
                     input=b"SELECT count(*) FROM toolbox_publications; SELECT count(*) FROM toolbox_decks;", capture_output=True).stdout.decode().splitlines()
    finally:
        pg(f'DROP DATABASE IF EXISTS {verify_db};')
    with tarfile.open(directory / 'private-config.tar.gz', 'w:gz') as tar:
        tar.add('/etc/lycee', arcname='etc/lycee')
    (directory / 'verification.json').write_text(json.dumps({'utc': stamp, 'restored': True,
        'publications': int(result[0]), 'snapshots': int(result[1]), 'postgresMajor': 18}) + '\n')
    files = ['database.dump', 'private-config.tar.gz', 'verification.json']
    checksum = ''.join(sha256(directory / name) + '  ' + name + '\n' for name in files)
    (directory / 'SHA256SUMS').write_text(checksum)
    archive, checksum_file, digest = encrypt_archive(directory, recipient_file) if encrypt else (None, None, None)
    offsite_verified = False
    if offsite:
        match = re.fullmatch(r'([a-zA-Z0-9_.@-]+):(/[a-zA-Z0-9_./-]+)', offsite)
        if not match or '..' in Path(match[2]).parts:
            raise RuntimeError('BACKUP_OFFSITE must be user@host:/absolute/simple/path')
        host, root = match.groups()
        remote = root.rstrip('/') + '/' + stamp
        ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', host]
        run(ssh + [f"umask 077; mkdir -p -- '{remote}'; chmod 700 -- '{remote}'"])
        run(['rsync', '-a', '--checksum', '-e', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
             str(archive), str(checksum_file), host + ':' + remote + '/'])
        run(ssh + [f"cd '{remote}' && sha256sum --check --strict '{checksum_file.name}'"])
        (directory / 'offsite-verified').write_text('verified\n')
        offsite_verified = True
    if cos_config:
        run(['/usr/bin/python3', '/usr/local/lib/lycee/cos-backup.py', '--archive', str(archive),
             '--stamp', stamp, '--checksum', digest, '--credentials', cos_config])
        (directory / 'cos-verified').write_text('verified\n')
        offsite_verified = True
    retention = max(3, int(cfg.get('BACKUP_RETENTION_DAYS', '14')))
    cutoff = time.time() - retention * 86400
    for old in directory.parent.iterdir():
        if old.is_dir() and not old.is_symlink() and re.fullmatch(r'\d{8}T\d{6}Z-\d+', old.name) and old.stat().st_mtime < cutoff:
            shutil.rmtree(old)
            for portable in (old.with_suffix('.tar.age'), old.with_suffix('.tar.age.sha256')):
                if portable.is_file() and not portable.is_symlink():
                    portable.unlink()
    print(json.dumps({'backup': stamp, 'restored': True, 'encrypted': bool(archive),
        'encryptedSha256': digest, 'offsiteVerified': offsite_verified}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Backup failed: ' + (type(error).__name__ if isinstance(error, (OSError, subprocess.CalledProcessError)) else str(error)), file=sys.stderr)
        sys.exit(1)
