#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname "$script_dir")
cd "$project_dir"

[ -f .env.production ] || { echo 'Missing .env.production.' >&2; exit 1; }
backup_dir=${SQLITE_HOST_BACKUP_DIR:-"$project_dir/backups"}
retention_days=${BACKUP_RETENTION_DAYS:-30}
case "$retention_days" in ''|*[!0-9]*) echo 'BACKUP_RETENTION_DAYS must be a non-negative integer.' >&2; exit 1;; esac
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

compose() { docker compose --env-file .env.production -f docker-compose.aliyun.yml "$@"; }
if compose exec -T guess-word test -f scripts/sqlite-backup.mjs >/dev/null 2>&1; then
  container_script=scripts/sqlite-backup.mjs
else
  docker cp scripts/sqlite-backup.mjs guess-word:/tmp/sqlite-backup.mjs
  container_script=/tmp/sqlite-backup.mjs
fi
container_path=$(compose exec -T guess-word node "$container_script" | tail -n 1)
case "$container_path" in /data/backups/guess-word-*.sqlite) ;; *) echo "Unexpected backup path: $container_path" >&2; exit 1;; esac
filename=$(basename "$container_path")
docker cp "guess-word:$container_path" "$backup_dir/$filename"
chmod 600 "$backup_dir/$filename"
find "$backup_dir" -type f -name 'guess-word-*.sqlite' -mtime "+$retention_days" -delete
echo "Backup saved: $backup_dir/$filename"
