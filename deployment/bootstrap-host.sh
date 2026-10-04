#!/usr/bin/env bash
# lycee-managed: bootstrap v1; run this reviewed file as root, never a branch artifact.
set -Eeuo pipefail
mode=${1:---check}
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Usage: bootstrap-host.sh [--check|--apply]' >&2; exit 2; }
[[ $(id -u) == 0 ]] || { echo 'Run with sudo; --check also inspects protected directories.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && ( "$VERSION_ID" == 24.04 || "$VERSION_ID" == 26.04 ) && $(uname -m) == x86_64 ]] || {
  echo 'Supported: Ubuntu 24.04/26.04 LTS x86_64 with systemd. No changes made.' >&2; exit 1;
}
[[ -d /run/systemd/system ]] || { echo 'systemd must be PID 1.' >&2; exit 1; }
if [[ "$mode" == --check ]]; then
  printf 'OS: %s; architecture: %s\n' "$PRETTY_NAME" "$(uname -m)"
  for command in nginx psql node npm curl openssl rsync; do
    if command -v "$command" >/dev/null; then printf '%s: %s\n' "$command" "$(command -v "$command")"; else printf '%s: missing\n' "$command"; fi
  done
  printf 'Managed config present: '; [[ -f /etc/lycee/host.conf ]] && echo yes || echo no
  printf 'Managed users: '; getent passwd lycee-deploy lycee-production lycee-assets | cut -d: -f1 || true
  echo 'Check only. --apply installs packages/users/directories; existing Nginx sites are preserved.'
  exit 0
fi
# Do not upgrade an existing PostgreSQL cluster or replace a different major version.
if command -v pg_lsclusters >/dev/null && pg_lsclusters -h | awk '{print $1}' | grep -qv '^18$'; then
  echo 'Existing non-PG18 cluster found. Review a separate database upgrade before bootstrap.' >&2; exit 1
fi
if command -v node >/dev/null && [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  echo 'Existing non-Node24 runtime found; bootstrap will not replace it.' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-cache show postgresql-18 >/dev/null || { echo 'postgresql-18 unavailable. Configure an approved PG18 apt source, then retry.' >&2; exit 1; }
apt-get install --no-install-recommends -y nginx postgresql-18 postgresql-client-18 curl ca-certificates openssl rsync python3 unzip xz-utils acl
if ! command -v node >/dev/null; then
  work=$(mktemp -d /var/tmp/lycee-node.XXXXXXXX)
  trap 'rm -rf -- "$work"' EXIT
  # Node24 version is resolved on the official server and validated before use.
  version=$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | sed -nE 's/^[0-9a-f]+  node-(v24\.[0-9]+\.[0-9]+)-linux-x64\.tar\.xz$/\1/p')
  [[ "$version" =~ ^v24\.[0-9]+\.[0-9]+$ ]] || { echo 'Could not resolve official Node24 version.' >&2; exit 1; }
  filename="node-${version}-linux-x64.tar.xz"
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/${version}/${filename}" -o "$work/$filename"
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  (cd "$work"; grep "  ${filename}$" SHASUMS256.txt | sha256sum --check --strict)
  [[ ! -e /opt/lycee-node ]] || { echo '/opt/lycee-node exists unexpectedly; refusing overwrite.' >&2; exit 1; }
  mkdir /opt/lycee-node
  tar -xJf "$work/$filename" --strip-components=1 -C /opt/lycee-node
  for binary in node npm npx; do
    [[ ! -e "/usr/local/bin/$binary" ]] || { echo "Refusing to replace /usr/local/bin/$binary" >&2; exit 1; }
    ln -s "/opt/lycee-node/bin/$binary" "/usr/local/bin/$binary"
  done
  rm -rf -- "$work"; trap - EXIT
fi
for user in lycee-production lycee-assets; do
  getent passwd "$user" >/dev/null || useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
done
for user in lycee-deploy lycee-release; do
  getent passwd "$user" >/dev/null || useradd --create-home --user-group --shell /bin/bash "$user"
done
install -d -m 0755 /opt/lycee /opt/lycee/instances /var/lib/lycee
install -d -m 0755 -o root -g root /var/lib/lycee/incoming
install -d -m 0700 -o lycee-release -g lycee-release /var/lib/lycee/incoming/production
install -d -m 0700 -o lycee-deploy -g lycee-deploy /var/lib/lycee/incoming/preview
install -d -m 0750 -o lycee-production -g lycee-production /var/lib/lycee/production
install -d -m 0755 -o lycee-assets -g lycee-assets /var/lib/lycee/images
install -d -m 0700 /var/backups/lycee /etc/lycee /etc/lycee/instances
install -d -m 0755 /usr/local/lib/lycee
systemctl enable --now postgresql nginx
printf '\nBootstrap complete. Node %s; PostgreSQL %s.\n' "$(node --version)" "$(psql --version)"
echo 'No app/database/HTTPS/DNS/SSH sudo rules configured yet. Install reviewed deployment templates next.'
