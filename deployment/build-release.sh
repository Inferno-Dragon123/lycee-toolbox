#!/usr/bin/env bash
# lycee-managed: Linux CI runtime artifact v1
set -Eeuo pipefail
sha=${1:?Usage: build-release.sh COMMIT_SHA OUTPUT.tar.gz}
out=${2:?Usage: build-release.sh COMMIT_SHA OUTPUT.tar.gz}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full commit SHA is required.' >&2; exit 1; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Build runtime on Linux x86_64, not Windows.' >&2; exit 1; }
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node24 required.' >&2; exit 1; }
export PUPPETEER_SKIP_DOWNLOAD=true
npm ci --no-audit --no-fund
npm run build
npm test
# Operational signatures and readback boundaries are part of the release checks.
python3 -m unittest discover -s tests -p test_tencent_dns.py
python3 -m unittest discover -s tests -p test_cos_backup.py
npm prune --omit=dev --no-audit --no-fund
export LYCEE_RELEASE_SHA="$sha"
node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync("RELEASE.json", JSON.stringify({sha:process.env.LYCEE_RELEASE_SHA,nodeMajor:24,platform:"linux",arch:"x64",builtAt:new Date().toISOString()})+"\n")'
# Include only runtime roots; local credentials and temporary files stay outside.
tar --exclude='__pycache__' --exclude='.env*' --exclude='*.log' -czf "$out" -- \
  api lib public scripts migrations data node_modules package.json package-lock.json \
  lycee-japanese-database-final.json lycee-chinese-database-final.json RELEASE.json
echo "Runtime archive created: $(basename "$out")"
