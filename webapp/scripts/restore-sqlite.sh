#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { echo 'Usage: sh scripts/restore-sqlite.sh <backup.sqlite>' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname "$script_dir")
cd "$project_dir"
[ -f .env.production ] || { echo 'Missing .env.production.' >&2; exit 1; }
backup_file=$(realpath "$1")
[ -f "$backup_file" ] || { echo "Backup not found: $backup_file" >&2; exit 1; }

compose() { docker compose --env-file .env.production -f docker-compose.aliyun.yml "$@"; }
sh scripts/backup-sqlite.sh
compose stop guess-word
restart_required=1
trap 'if [ "${restart_required:-0}" = 1 ]; then compose up -d guess-word; fi' EXIT INT TERM
compose run --rm --no-deps --user 0:0 -v "$backup_file:/restore/backup.sqlite:ro" \
  -e RESTORE_SOURCE=/restore/backup.sqlite guess-word node scripts/sqlite-restore.mjs
compose up -d guess-word
restart_required=0

host_port=$(sed -n 's/^APP_HOST_PORT=//p' .env.production | tail -n 1)
host_port=${host_port:-3100}
attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent "http://127.0.0.1:${host_port}/api/health" >/dev/null; then
    echo "Restore completed and GuessWord is healthy at http://127.0.0.1:${host_port}/"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done
compose logs --tail=100 guess-word
echo 'Restore finished, but the health check did not pass within 60 seconds.' >&2
exit 1
