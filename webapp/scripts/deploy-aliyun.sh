#!/bin/sh
set -eu

if [ ! -f .env.production ]; then
  echo 'Missing .env.production. Copy .env.production.example and set a new DeepSeek key.' >&2
  exit 1
fi

if grep -q 'replace-with-a-new-server-side-key' .env.production; then
  echo 'Replace the placeholder DeepSeek key before deployment.' >&2
  exit 1
fi

host_port=$(sed -n 's/^APP_HOST_PORT=//p' .env.production | tail -n 1)
host_port=${host_port:-3100}

case "$host_port" in
  ''|*[!0-9]*)
    echo 'APP_HOST_PORT must be a numeric TCP port.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose --env-file .env.production -f docker-compose.aliyun.yml "$@"
}

compose config --quiet
compose up -d --build

attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent "http://127.0.0.1:${host_port}/api/health" >/dev/null; then
    echo "GuessWord is healthy at http://127.0.0.1:${host_port}/"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

compose ps
compose logs --tail=100 guess-word
echo 'Deployment started, but the health check did not pass within 60 seconds.' >&2
exit 1
