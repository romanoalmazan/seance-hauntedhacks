#!/usr/bin/env bash
# One-laptop demo with REAL=1. Commands come from docs/spike-notes.md ("Core stack").
#   scripts/demo.sh        start everything and print the URLs
#   scripts/demo.sh stop   stop what it started, plus any detached bridge
#
# Don't run scripts/beat-check.ts next to this: it connects as the askers and the console, so it
# would split their messages with the live servers and wipe the demo state.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

PIDS=/tmp/liaison-demo.pids
PORTS="8787 7100 3000 3001 3002"
WAIT_SECONDS=30

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

stop_all() {
  if [ -f "$PIDS" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDS"
    rm -f "$PIDS"
  fi
  # A bridge restarted by hand in beat 2½ (or by beat-check) isn't in the PID file, and
  # `bun run actors:dev` leaves the Terse server behind when it is killed.
  pkill -f 'expert-bridge.ts' 2>/dev/null || true
  pkill -f 'terse actor dev' 2>/dev/null || true
  pkill -f 'runActorDev' 2>/dev/null || true

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    busy=""
    for port in $PORTS; do listening "$port" && busy="$busy $port"; done
    [ -z "$busy" ] && break
    sleep 0.5
  done
  if [ -n "$busy" ]; then
    echo "Stopped what it could, but still listening on:$busy" >&2
    return 1
  fi
  echo "Stopped."
}

# start <log file> <command...>: runs detached, logs to the repo root, records the PID.
start() {
  local log=$1
  shift
  nohup "$@" > "$log" 2>&1 &
  echo $! >> "$PIDS"
}

fail() {
  echo "FAILED: $1" >&2
  [ -n "${2:-}" ] && tail -n 20 "$2" >&2
  stop_all || true
  exit 1
}

# wait_for <name> <log file> <command that succeeds when it is up>
wait_for() {
  local name=$1 log=$2
  shift 2
  local tries=$((WAIT_SECONDS * 5))
  until "$@" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || fail "$name didn't come up in ${WAIT_SECONDS}s. Last lines of $log:" "$log"
    sleep 0.2
  done
  echo "  $name is up"
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  exit
fi
if [ -n "${1:-}" ]; then
  echo "Usage: scripts/demo.sh [stop]" >&2
  exit 2
fi

for port in $PORTS; do
  if listening "$port"; then
    echo "Port $port is already in use. Run scripts/demo.sh stop, or stop whatever holds it." >&2
    exit 1
  fi
done

[ -f .env ] || cp .env.example .env
[ -e actors/.env ] || ln -s ../.env actors/.env
: > "$PIDS"

echo "Starting the core stack..."
start relay-engine.log node node_modules/@relaycast/engine/dist/bin/serve.js --db ./relaycast.db --port 8787
wait_for "Relay engine" relay-engine.log curl -sf localhost:8787/health

bun scripts/setup-relay.ts || fail "Relay setup. If the db was wiped, remove .relay-tokens.json too."

start actors-dev.log bun run actors:dev
wait_for "Terse dev server" actors-dev.log curl -s -o /dev/null 127.0.0.1:7100

start bridge-battery.log bun bridge/expert-bridge.ts battery
start bridge-actuators.log bun bridge/expert-bridge.ts actuators
wait_for "battery bridge" bridge-battery.log grep -q listening bridge-battery.log
wait_for "actuators bridge" bridge-actuators.log grep -q listening bridge-actuators.log

echo "Starting the surfaces..."
export REAL=1
start asker-priya.log bun asker/server.ts asker-priya
start asker-guest.log bun asker/server.ts asker-guest
start console.log bun console/server.ts
wait_for "Priya asker" asker-priya.log curl -s -o /dev/null 127.0.0.1:3001
wait_for "Guest asker" asker-guest.log curl -s -o /dev/null 127.0.0.1:3002
wait_for "console" console.log curl -s -o /dev/null 127.0.0.1:3000

cat <<URLS

Up, on the real stack:
  Owner console  http://127.0.0.1:3000
  Priya          http://127.0.0.1:3001
  Guest          http://127.0.0.1:3002

Press Reset on the console before every run. Stop with: scripts/demo.sh stop
URLS
