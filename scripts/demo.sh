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
# The AI is Claude Code on this computer. A path into an editor's extension
# folder disappears when the editor updates it, so the claude on PATH stands
# in for one that is gone.
claude_code=$(grep '^CLAUDE_CODE_PATH=' .env.local | cut -d= -f2- || true)
if [ -z "$claude_code" ] || [ ! -x "$claude_code" ]; then
  claude_code=$(command -v claude || true)
fi
if [ -z "$claude_code" ]; then
  echo "pnpm demo: no claude program (CLAUDE_CODE_PATH in .env.local, or claude on PATH): ansa can't answer with the AI, only with holding replies." >&2
elif ! "$claude_code" --version >/dev/null 2>&1; then
  echo "pnpm demo: the claude program ($claude_code) doesn't run: ansa can't answer with the AI, only with holding replies." >&2
fi
for port in 3000 8080 8090; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "something already runs on port $port: stop it first (another pnpm dev, make run or brain)."
  fi
done

# The simulate tools sign calls and emails as Vapi and Resend do, and core
# checks them with the same secret from .env.core: the first time, a
# development one is made for this laptop (docs/backend/try-it.md).
add_development_secret() {
  if ! grep -q "^$1=." .env.core; then
    printf '\n# Made by pnpm demo for this laptop (development only).\n%s=%s\n' "$1" "$2" >> .env.core
  fi
}
add_development_secret VAPI_WEBHOOK_SECRET "$(openssl rand -hex 32)"
add_development_secret RESEND_WEBHOOK_SECRET "whsec_$(openssl rand -base64 32)"

# The database: Docker Desktop first, then ansa's Postgres and its migrations.
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  for _ in $(seq 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || fail "Docker Desktop didn't start: open it, accept its screen if it shows one, then pnpm demo again."
fi
pnpm --silent db:up
for _ in $(seq 60); do
  docker compose --env-file .env.local exec -T postgres pg_isready -q 2>/dev/null && break
  sleep 1
done
pnpm --silent db:migrate >/dev/null

# Each part runs in its own process group (set -m), so stopping it stops
# every program it started; its lines carry its name.
set -m
groups=()
# stop_all stops every part; Ctrl+C is a normal stop (0), a failure keeps
# its code.
stop_all() {
  local code=$1
  trap - EXIT INT TERM
  for group in "${groups[@]}"; do
    kill -TERM -- "-$group" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "ansa stopped."
  exit "$code"
}
trap 'stop_all $?' EXIT
trap 'stop_all 0' INT TERM
start() {
  local name=$1
  shift
  # The name filter ignores Ctrl+C's stop and ends when the program closes
  # its output, so a program still logging while it stops (core's 20-second
  # drain) never writes into a closed pipe.
  ("$@" 2>&1 | (trap '' TERM INT; exec sed -u "s/^/[$name] /")) &
  groups+=("$!")
}

# wait_for waits (up to 3 minutes) until a part answers at its address,
# and stops everything when that part's programs ended instead.
wait_for() {
  local name=$1 group=$2 address=$3
  for _ in $(seq 180); do
    curl -fs -o /dev/null "$address" && return 0
    kill -0 -- "-$group" 2>/dev/null || fail "the $name stopped while starting: read its [$name] lines above."
    sleep 1
  done
  fail "the $name didn't start within 3 minutes: read its [$name] lines above."
}
start brain bash -c "cd brain && set -a && . ../.env.core && set +a && export ANSA_ENV=development CLAUDE_CODE_PATH='$claude_code' && exec .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090"
start core bash -c "cd core && set -a && . ../.env.core && set +a && export ANSA_ENV=development && exec go run ./cmd/core"
start screens pnpm dev

echo "Building and starting core (the first time takes a minute or two)..."
wait_for brain "${groups[0]}" http://127.0.0.1:8090/health
wait_for core "${groups[1]}" http://127.0.0.1:8080/health
wait_for screens "${groups[2]}" http://localhost:3000/login
if ! (cd core && ANSA_ENV=development go run ./cmd/simulate demo if-missing); then
  echo "pnpm demo: the demo accounts couldn't be made (see above). ansa runs: try pnpm demo:reset in a second terminal." >&2
fi
echo
echo "ansa is running: open http://localhost:3000 (Ctrl+C here stops everything)."
wait
