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

"${COMPOSE[@]}" up -d --build --remove-orphans

if [[ ! -f deploy/dozzle/users.yml ]]; then
  echo "==> WARNING: deploy/dozzle/users.yml is missing."
  echo "    https://logs.labcd.ai will not accept logins until you run:"
  echo "    bash deploy/setup-dozzle.sh"
  echo "    docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate dozzle"
fi

echo "==> Service status"
"${COMPOSE[@]}" ps

echo "Deploy finished."
