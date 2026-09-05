#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo 'Run this installer with sudo.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname "$script_dir")
cron_file=/etc/cron.d/guess-word-backup
printf '%s\n' \
  'SHELL=/bin/sh' \
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  "17 3 * * * root cd $project_dir && /bin/sh scripts/backup-sqlite.sh >> /var/log/guess-word-backup.log 2>&1" \
  > "$cron_file"
chmod 644 "$cron_file"
echo "Installed daily 03:17 backup job: $cron_file"
