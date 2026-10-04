#!/usr/bin/env bash
# lycee-managed: image mirror entrypoint v1
set -Eeuo pipefail
[[ ${IMAGE_MIRROR_ENABLED:-0} == 1 ]] || { echo 'Scheduled image mirror disabled; initial mirror is manual.'; exit 0; }
# The mirror lock still enforces exclusivity; skip scheduled work during bootstrap.
if /usr/bin/systemctl is-active --quiet lycee-initial-images.service; then
  echo 'Initial image mirror is active; incremental pass deferred.'
  exit 0
fi
exec /usr/local/bin/node scripts/mirror-card-images.js --limit 100
