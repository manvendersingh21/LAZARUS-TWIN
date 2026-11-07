#!/usr/bin/env bash
# Run both workbench services in the foreground; Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/setup.sh
BACKEND_PORT="${LAZARUS_BACKEND_PORT:-8010}"
FRONTEND_PORT="${LAZARUS_FRONTEND_PORT:-5173}"
# Vite's proxy is configured for backend port 8010.
if [[ "$BACKEND_PORT" != 8010 ]]; then
  printf 'The workbench proxy currently requires LAZARUS_BACKEND_PORT=8010.\n' >&2
  exit 1
fi
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if ! .venv/bin/python - "$port" <<'PY'
import socket, sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try:s.bind(('0.0.0.0',int(sys.argv[1])))
except OSError:sys.exit(1)
finally:s.close()
PY
  then
    printf 'Port %s is already in use. Stop the existing service before starting the demo.\n' "$port" >&2
    exit 1
  fi
done
cleanup() {
  trap - EXIT INT TERM
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "$BACKEND_PORT" &
backend_pid=$!
( cd frontend; exec ../node_modules/node/bin/node node_modules/vite/bin/vite.js --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort ) &
frontend_pid=$!
trap cleanup EXIT INT TERM
printf 'Workbench: http://localhost:%s (API: http://localhost:%s)\n' "$FRONTEND_PORT" "$BACKEND_PORT"
wait -n "$backend_pid" "$frontend_pid"
