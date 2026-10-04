#!/usr/bin/env bash
# lycee-managed: deck sync entrypoint v1
set -Eeuo pipefail
[[ ${MAINTENANCE_ENABLED:-0} == 1 ]] || { echo 'Deck maintenance disabled until final cutover.'; exit 0; }
[[ ${DEPLOYMENT_KIND:-} == production ]] || { echo 'Maintenance requires production.' >&2; exit 1; }
exec /usr/local/bin/node scripts/sync-official-decks.js --limit 100 --days 365 --pages 3
