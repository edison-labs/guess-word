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

docker compose -f docker-compose.aliyun.yml config --quiet
docker compose -f docker-compose.aliyun.yml up -d --build

attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent http://127.0.0.1/api/health >/dev/null; then
    echo 'GuessWord is healthy at http://127.0.0.1/'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose -f docker-compose.aliyun.yml ps
docker compose -f docker-compose.aliyun.yml logs --tail=100 guess-word
echo 'Deployment started, but the health check did not pass within 60 seconds.' >&2
exit 1
