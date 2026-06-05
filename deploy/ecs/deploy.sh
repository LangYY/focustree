#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "Missing deploy/ecs/.env. Copy .env.example to .env and fill real values first." >&2
  exit 1
fi

cd "$ROOT_DIR"
npm run db:bundle
set -a
# shellcheck disable=SC1091
. "$SCRIPT_DIR/.env"
set +a
npm run cloud:check

cd "$SCRIPT_DIR"
docker compose up -d --build
docker compose ps

DOMAIN="$(grep -E '^FOCUSTREE_DOMAIN=' .env | cut -d '=' -f 2- | tr -d '[:space:]')"
if [ -n "$DOMAIN" ]; then
  echo "FocusTree should be available at: https://$DOMAIN"
  echo "Run from your workstation after DNS is ready:"
  echo "  npm run cloud:smoke -- https://$DOMAIN --require-readiness"
fi
