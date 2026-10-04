#!/usr/bin/env bash
# lycee-managed: resumable verified runtime upload v1
set -Eeuo pipefail
ssh_config=${1:?Usage: upload-release.sh SSH_CONFIG TARGET SHA ARCHIVE}
target=${2:?Target required}
sha=${3:?Full commit SHA required}
archive=${4:?Archive required}
[[ "$target" =~ ^(production|p-[0-9a-f]{12})$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
[[ -f "$ssh_config" && -f "$archive" && ! -L "$archive" ]]
incoming=preview
if [[ "$target" == production ]]; then incoming=production; fi
cache="/var/lib/lycee/incoming/$incoming/runtime-cache.tar.gz"
digest=$(sha256sum -- "$archive")
digest=${digest%% *}
# No --inplace: a completed cache remains usable until the next upload succeeds.
# Interrupted transfers retain a partial basis, including between workflow runs.
for attempt in 1 2 3; do
  echo "Uploading verified runtime (attempt $attempt/3; unchanged blocks are reused)."
  if timeout --signal=TERM --kill-after=30s 15m rsync --checksum --partial \
      --partial-dir=.rsync-partial --timeout=90 --perms --chmod=F600 \
      --stats -e "ssh -F \"$ssh_config\"" -- "$archive" "lycee-host:$cache"; then
    break
  fi
  if [[ "$attempt" == 3 ]]; then
    echo 'Runtime upload failed; active release is unchanged and partial data is retained.' >&2
    exit 1
  fi
  sleep 5
done
# Only a complete archive matching the runner's SHA-256 becomes deployable.
# All remote arguments are validated fixed-shape identifiers, never branch names.
ssh -F "$ssh_config" lycee-host bash -s -- "$incoming" "$target" "$sha" "$digest" <<'REMOTE'
set -Eeuo pipefail
incoming=$1 target=$2 sha=$3 digest=$4
[[ "$incoming" == preview || "$incoming" == production ]]
[[ "$target" =~ ^(production|p-[0-9a-f]{12})$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$digest" =~ ^[0-9a-f]{64}$ ]]
cache="/var/lib/lycee/incoming/$incoming/runtime-cache.tar.gz"
archive="/var/lib/lycee/incoming/$incoming/$sha.tar.gz"
[[ -f "$cache" && ! -L "$cache" && ! -L "$archive" ]]
actual=$(sha256sum -- "$cache")
[[ "${actual%% *}" == "$digest" ]] || { echo 'Runtime checksum mismatch; refusing deployment.' >&2; exit 1; }
umask 077
staged="$archive.upload-$$"
[[ ! -e "$staged" && ! -L "$staged" ]]
trap 'rm -f -- "$staged"' EXIT
cp --reflink=auto -- "$cache" "$staged"
mv -Tf -- "$staged" "$archive"
echo "Runtime upload SHA-256 verified: $digest"
REMOTE
