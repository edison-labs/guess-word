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

auth_secret=$(sed -n 's/^AUTH_SECRET=//p' .env.production | tail -n 1)
if [ "${#auth_secret}" -lt 32 ] || [ "$auth_secret" = 'replace-with-at-least-32-random-characters' ]; then
  echo 'Set AUTH_SECRET to at least 32 random characters before deployment (for example: openssl rand -hex 32).' >&2
  exit 1
fi

sms_access_key=$(sed -n 's/^ALIBABA_CLOUD_ACCESS_KEY_ID=//p' .env.production | tail -n 1)
sms_access_secret=$(sed -n 's/^ALIBABA_CLOUD_ACCESS_KEY_SECRET=//p' .env.production | tail -n 1)
sms_sign=$(sed -n 's/^ALIYUN_SMS_SIGN_NAME=//p' .env.production | tail -n 1)
sms_template=$(sed -n 's/^ALIYUN_SMS_TEMPLATE_CODE=//p' .env.production | tail -n 1)
if [ -n "${sms_access_key}${sms_access_secret}${sms_sign}${sms_template}" ] && \
  { [ -z "$sms_access_key" ] || [ -z "$sms_access_secret" ] || [ -z "$sms_sign" ] || [ -z "$sms_template" ]; }; then
  echo 'Fill all four Alibaba Cloud SMS settings, or leave all four empty to disable login.' >&2
  exit 1
fi
if [ -z "${sms_access_key}${sms_access_secret}${sms_sign}${sms_template}" ]; then
  echo '[!] Alibaba Cloud SMS is not configured; guest play works, but SMS login will show a configuration message.' >&2
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
if docker inspect guess-word >/dev/null 2>&1 && docker inspect -f '{{.State.Running}}' guess-word 2>/dev/null | grep -q true; then
  echo '[+] Backing up SQLite before deployment...'
  sh scripts/backup-sqlite.sh
fi
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
