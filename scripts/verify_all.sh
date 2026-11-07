#!/usr/bin/env bash
# Verify actual artifacts, REA, black-box isolation, Git evolution, Anvil, API, and frontend.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/setup.sh
printf '\n[1/5] Compile, REA inspect, probes, isolated mutation audit, API and Git evolution\n'
.venv/bin/python -m pytest -q tests backend/llm_router/test_router.py
printf '\n[2/5] Verify symbols were stripped from target executable\n'
if nm build/legacy_controller 2>&1 | grep -q 'no symbols'; then
  printf 'Target executable has no static symbol table.\n'
else
  printf 'Expected a stripped target executable.\n' >&2
  exit 1
fi
printf '\n[3/5] Differential EVM calls on a local Anvil instance\n'
./node_modules/node/bin/node scripts/evm_probe.cjs
printf '\n[4/5] Build frontend for production\n'
PATH="$PWD/node_modules/node/bin:$PATH" npm --prefix frontend run build
printf '\n[5/5] Verification complete. These are sampled tests, not a formal proof.\n'
