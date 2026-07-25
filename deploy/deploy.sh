#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${DEPLOY_BRANCH:-master}"

echo "==> Fetching ${BRANCH}"
git fetch origin
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> Building and starting production stack"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)

"${COMPOSE[@]}" pull || true

# Free host :80/:443 before recreate (avoids bind failures)
free_host_port() {
  local port="$1"
  local ids
  ids="$(docker ps -q --filter "publish=${port}" 2>/dev/null || true)"
  if [[ -n "${ids}" ]]; then
    echo "==> Stopping containers publishing :${port}"
    # shellcheck disable=SC2086
    docker stop ${ids} || true
    # shellcheck disable=SC2086
    docker rm -f ${ids} || true
  fi
}

"${COMPOSE[@]}" stop caddy || true
"${COMPOSE[@]}" rm -f caddy || true
free_host_port 80
free_host_port 443

# Brief pause so the kernel releases the sockets
sleep 2

if ss -tlnH 2>/dev/null | grep -qE ':80\s' || ss -tlnH 2>/dev/null | grep -qE ':443\s'; then
  echo "==> WARNING: host still listening on :80 and/or :443 (non-Docker?)"
  ss -tlnp 2>/dev/null | grep -E ':80\s|:443\s' || true
  echo "    Stop nginx/apache/other reverse proxies, then re-run deploy."
fi

"${COMPOSE[@]}" up -d --build --remove-orphans

echo "==> Service status"
"${COMPOSE[@]}" ps

echo "Deploy finished."
