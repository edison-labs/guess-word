#!/bin/sh
set -eu

if [ ! -f .env.production ]; then
  echo 'Missing server-side .env.production.' >&2
  exit 1
fi

if [ -z "${ACR_IMAGE:-}" ]; then
  echo 'Set ACR_IMAGE to the immutable image tag to deploy.' >&2
  exit 1
fi

host_port=$(sed -n 's/^APP_HOST_PORT=//p' .env.production | tail -n 1)
host_port=${host_port:-80}

case "$host_port" in
  ''|*[!0-9]*)
    echo 'APP_HOST_PORT must be a numeric TCP port.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose --env-file .env.production -f docker-compose.aliyun.release.yml "$@"
}

compose config --quiet
compose pull guess-word
compose up -d --no-build guess-word

attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent "http://127.0.0.1:${host_port}/api/health" >/dev/null; then
    echo "GuessWord deployed ${ACR_IMAGE} and is healthy on port ${host_port}."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

compose ps
compose logs --tail=100 guess-word
echo 'The release container did not pass its health check within 60 seconds.' >&2
exit 1
