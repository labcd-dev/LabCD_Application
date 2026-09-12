#!/usr/bin/env bash
# Generate deploy/dozzle/users.yml for Dozzle simple auth.
# Run once on the VPS (or again with --force to rotate the password).
set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="deploy/dozzle"
OUT_FILE="${OUT_DIR}/users.yml"
IMAGE="${DOZZLE_IMAGE:-amir20/dozzle:v10.10.0}"
USERNAME="${DOZZLE_USERNAME:-admin}"
EMAIL="${DOZZLE_EMAIL:-admin@labcd.ai}"
NAME="${DOZZLE_NAME:-Admin}"

mkdir -p "${OUT_DIR}"

if [[ -f "${OUT_FILE}" && "${1:-}" != "--force" ]]; then
  echo "Already exists: ${OUT_FILE}"
  echo "Re-run with --force to replace it."
  exit 0
fi

if [[ -z "${DOZZLE_PASSWORD:-}" ]]; then
  read -r -s -p "Dozzle password for ${USERNAME}: " DOZZLE_PASSWORD
  echo
fi

if [[ -z "${DOZZLE_PASSWORD}" ]]; then
  echo "Password cannot be empty. Set DOZZLE_PASSWORD or type it when prompted."
  exit 1
fi

docker run --rm "${IMAGE}" generate "${USERNAME}" \
  --password "${DOZZLE_PASSWORD}" \
  --email "${EMAIL}" \
  --name "${NAME}" \
  --user-roles none \
  > "${OUT_FILE}"

chmod 600 "${OUT_FILE}"
echo "Wrote ${OUT_FILE}"
echo "Recreate Dozzle:"
echo "  docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate dozzle"
