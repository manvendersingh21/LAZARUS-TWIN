#!/usr/bin/env bash
# Install development dependencies only when missing; never alter .env.
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in python3 gcc strip objdump nm git node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing required tool: %s\n' "$tool" >&2
    exit 1
  fi
done
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import fastapi,uvicorn,pymongo,dns,dotenv,httpx,pytest,uagents,websockets' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi
if [[ ! -x node_modules/node/bin/node || ! -f node_modules/rea-agents/scripts/rea.mjs || ! -f node_modules/@foundry-rs/anvil/bin.mjs || ! -f node_modules/solc/index.js || ! -f node_modules/ethers/package.json ]]; then
  # The system Node may be v20; REA requires v22.23.4+.
  npm exec --yes --package=node@22.23.4 -- node "$(command -v npm)" ci --no-audit --no-fund
fi
if [[ ! -x frontend/node_modules/.bin/vite || ! -x frontend/node_modules/.bin/tsc ]]; then
  PATH="$PWD/node_modules/node/bin:$PATH" npm --prefix frontend ci --no-audit --no-fund
fi
