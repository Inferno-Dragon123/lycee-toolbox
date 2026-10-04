#!/usr/bin/env bash
# lycee-managed: certificate deploy hook v1
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ $(id -u) == 0 ]] || { echo 'Certificate deploy hook must run as root.' >&2; exit 1; }
lineage=${RENEWED_LINEAGE:-}
[[ -n "$lineage" ]] || { echo 'Certificate deploy hook requires RENEWED_LINEAGE.' >&2; exit 1; }
# Directory hooks can be invoked for other certificates on this host.
[[ ${lineage%/} == /etc/letsencrypt/live/lycee-toolbox.top ]] || exit 0
[[ -r "$lineage/fullchain.pem" && -r "$lineage/privkey.pem" ]] || {
    echo 'Renewed certificate or private key is unavailable; Nginx was not reloaded.' >&2; exit 1;
}
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 86400 >/dev/null || {
    echo 'Certificate expires within one day; Nginx was not reloaded.' >&2; exit 1;
}
for hostname in lycee-toolbox.top www.lycee-toolbox.top certificate-check.preview.lycee-toolbox.top; do
    openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$hostname" >/dev/null || {
        echo 'Certificate does not cover the project hostnames; Nginx was not reloaded.' >&2; exit 1;
    }
done
# Includes certificate/key matching validation; retain the active workers on failure.
nginx -t
systemctl reload nginx
