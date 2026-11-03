#!/usr/bin/env bash
# pnpm demo: starts everything ansa needs on this laptop, in one terminal,
# for a demo or to try it (docs/demo.md): the database in Docker, the brain,
# core and the screens, each line named by its part. The first time it also
# makes the two demo accounts (pnpm demo:reset makes them again). Ctrl+C
# stops everything. Free: the AI is Claude Code on this computer (your own
# login), and every outside service is a local stand-in. Development only.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "pnpm demo: $1" >&2
  exit 1
}
[ -f .env.local ] || fail "there is no .env.local: copy .env.example first (docs/backend/try-it.md)."
[ -f .env.core ] || fail "there is no .env.core: copy core/.env.core.example first (docs/backend/try-it.md)."
[ -d node_modules ] || fail "run pnpm install first."
[ -x brain/.venv/bin/uvicorn ] || fail "the brain's packages are missing: cd brain && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt"
command -v go >/dev/null || fail "Go is missing (brew install go)."
command -v docker >/dev/null || fail "Docker Desktop is missing (docker.com)."
claude_code=$(grep '^CLAUDE_CODE_PATH=' .env.local | cut -d= -f2- || true)
if [ -z "$claude_code" ] || [ ! -x "$claude_code" ]; then
  echo "pnpm demo: CLAUDE_CODE_PATH in .env.local doesn't name the claude program: without it ansa can't answer with the AI (only holding replies)." >&2
fi
for port in 3000 8080 8090; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "something already runs on port $port: stop it first (another pnpm dev, make run or brain)."
  fi
done

# The database: Docker Desktop first, then ansa's Postgres and its migrations.
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  until docker info >/dev/null 2>&1; do sleep 2; done
fi
pnpm --silent db:up
until docker compose --env-file .env.local exec -T postgres pg_isready -q 2>/dev/null; do sleep 1; done
pnpm --silent db:migrate >/dev/null

# Each part runs in its own process group (set -m), so stopping it stops
# every program it started; its lines carry its name.
set -m
groups=()
stop_all() {
  trap - EXIT INT TERM
  for group in "${groups[@]}"; do
    kill -TERM -- "-$group" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "ansa stopped."
  exit 0
}
trap stop_all EXIT INT TERM
start() {
  local name=$1
  shift
  ("$@" 2>&1 | sed -u "s/^/[$name] /") &
  groups+=("$!")
}
start brain bash -c "cd brain && set -a && . ../.env.core && set +a && export ANSA_ENV=development CLAUDE_CODE_PATH='$claude_code' && exec .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090"
start core bash -c "cd core && set -a && . ../.env.core && set +a && export ANSA_ENV=development && exec go run ./cmd/core"
start screens pnpm dev

until curl -fs -o /dev/null http://127.0.0.1:8080/health; do sleep 1; done
(cd core && ANSA_ENV=development go run ./cmd/simulate demo if-missing)
echo
echo "ansa is running: open http://localhost:3000 (Ctrl+C here stops everything)."
wait
