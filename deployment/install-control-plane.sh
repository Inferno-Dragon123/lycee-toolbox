#!/usr/bin/env bash
# lycee-managed: install trusted control plane v1; never invoke from a branch release.
set -Eeuo pipefail
mode=${1:---check}
[[ "$mode" == --check || "$mode" == --apply ]] || { echo 'Usage: install-control-plane.sh [--check|--apply]' >&2; exit 2; }
[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for command in node nginx psql setfacl; do command -v "$command" >/dev/null || { echo "$command missing; finish bootstrap first." >&2; exit 1; }; done
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node24 required.' >&2; exit 1; }
[[ $(psql --version) == *' 18.'* ]] || { echo 'PostgreSQL18 client required.' >&2; exit 1; }
# Windows git archive may export CRLF without the project's explicit .py attributes.
for source in "$source_dir"/*.py; do
  if head -n 1 "$source" | grep -q $'\r'; then
    echo 'Control Python shebangs require LF; re-export with the project attributes.' >&2
    exit 1
  fi
done
check_target() {
  local target=$1 marker=$2
  [[ ! -L "$target" ]] || { echo "Refusing existing symlink: $target" >&2; exit 1; }
  # Do not use grep -q in a pipefail pipeline: its early exit can SIGPIPE head,
  # intermittently rejecting a correctly marked managed file.
  if [[ -e "$target" ]] && [[ $(head -c 200 -- "$target") != *"$marker"* ]]; then
    echo "Refusing unmanaged file: $target" >&2; exit 1
  fi
}
for file in lycee-admin.py backup.py backup.sh maintenance.sh images.sh cos-backup.py; do
  check_target "/usr/local/lib/lycee/$file" 'lycee-managed:'
done
for source in "$source_dir"/systemd/*.service "$source_dir"/systemd/*.timer; do
  check_target "/etc/systemd/system/$(basename "$source")" '# lycee-managed:'
done
check_target /etc/sudoers.d/lycee-deploy '# lycee-managed:'
check_target /etc/systemd/system/lycee@production.service.d/resources.conf '# lycee-managed:'
check_target /etc/systemd/journald.conf.d/lycee.conf '# lycee-managed:'
check_target /etc/nginx/conf.d/00-lycee-default.conf '# lycee-managed:'
check_target /etc/letsencrypt/renewal-hooks/deploy/lycee-nginx '# lycee-managed:'
if [[ -e /usr/local/sbin/lycee-admin ]] && [[ $(readlink /usr/local/sbin/lycee-admin) != /usr/local/lib/lycee/lycee-admin.py ]]; then
  echo 'Refusing unmanaged /usr/local/sbin/lycee-admin' >&2; exit 1
fi
if [[ "$mode" == --check ]]; then
  echo 'Control-plane destinations are absent or managed; no files changed.'
  echo 'App/maintenance/image services will remain stopped. No Nginx config overwritten.'
  exit 0
fi
install -d -m 0755 /usr/local/lib/lycee /etc/systemd/system/lycee@production.service.d
for user in lycee-deploy lycee-release; do
  getent passwd "$user" >/dev/null || useradd --create-home --user-group --shell /bin/bash "$user"
done
install -d -m 0755 -o root -g root /var/lib/lycee/incoming
install -d -m 0700 -o lycee-release -g lycee-release /var/lib/lycee/incoming/production
install -d -m 0700 -o lycee-deploy -g lycee-deploy /var/lib/lycee/incoming/preview
usermod -aG lycee-assets www-data
usermod -aG lycee-assets lycee-production
for file in lycee-admin.py backup.py backup.sh maintenance.sh images.sh cos-backup.py; do
  install -m 0755 "$source_dir/$file" "/usr/local/lib/lycee/$file"
done
ln -sfn /usr/local/lib/lycee/lycee-admin.py /usr/local/sbin/lycee-admin
for source in "$source_dir"/systemd/*.service "$source_dir"/systemd/*.timer; do
  install -m 0644 "$source" "/etc/systemd/system/$(basename "$source")"
done
install -m 0644 "$source_dir/systemd/production-resource.conf" /etc/systemd/system/lycee@production.service.d/resources.conf
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$source_dir/journald.conf" /etc/systemd/journald.conf.d/lycee.conf
install -m 0644 "$source_dir/nginx-default.conf" /etc/nginx/conf.d/00-lycee-default.conf
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$source_dir/renew-certificates.sh" /etc/letsencrypt/renewal-hooks/deploy/lycee-nginx
# sudo grants only the root-owned validated management command, no shell/editor/systemctl.
printf '%s\n' '# lycee-managed: deployment sudo v1' 'lycee-deploy ALL=(root) NOPASSWD: /usr/local/sbin/lycee-admin' 'lycee-release ALL=(root) NOPASSWD: /usr/local/sbin/lycee-admin' > /etc/sudoers.d/lycee-deploy
chmod 0440 /etc/sudoers.d/lycee-deploy
visudo -cf /etc/sudoers.d/lycee-deploy
systemctl daemon-reload
systemctl restart systemd-journald
systemd-analyze verify /etc/systemd/system/lycee@.service /etc/systemd/system/lycee-backup.service /etc/systemd/system/lycee-maintenance.service /etc/systemd/system/lycee-images.service /etc/systemd/system/lycee-initial-images.service
nginx -t
systemctl reload nginx
systemctl enable --now lycee-cleanup.timer
echo 'Control plane installed. Backup/maintenance/images timers require explicit enable after configuration.'
