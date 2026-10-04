#!/usr/bin/env bash
# lycee-managed: backup entrypoint v1
set -Eeuo pipefail
exec /usr/bin/python3 /usr/local/lib/lycee/backup.py "$@"
