#!/usr/bin/env bash
# lycee-managed: image mirror entrypoint v1
set -Eeuo pipefail
[[ ${IMAGE_MIRROR_ENABLED:-0} == 1 ]] || { echo 'Scheduled image mirror disabled; initial mirror is manual.'; exit 0; }
exec /usr/local/bin/node scripts/mirror-card-images.js --limit 100
