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

# Reset active controller skill cleanly to v1 baseline on every demo boot.
mkdir -p .skills/controllers
cp backend/evolution_engine/templates/v1.py .skills/controllers/active_skill.py

# Pre-warm all 3 industrial targets (OpenPLC IEC 61131-3 Runtime, Fulmatic STM32F407
# ARM Cortex-M4 PLC firmware, and Stripped Servo Plant), REA static inspection,
# FFI probes + 1,000-vector equivalence, and Anvil EVM differential trace.
.venv/bin/python - <<'PY'
import json
import os
import subprocess
import tempfile
from backend.rea_archaeologist.build import ROOT, BUILD, build, digest
from backend.rea_archaeologist.inspect import inspect
from backend.prober.probe import probe, equivalence

art = build()
cache_path = BUILD / "prewarmed_probe.json"
rea_bin_path = BUILD / "rea_evidence.json"
rea_evm_path = BUILD / "rea_evm_evidence.json"
evm_trace_path = BUILD / "evm_trace.json"
probe_sha = digest(ROOT / "backend/prober/probe.py")
inspect_sha = digest(ROOT / "backend/rea_archaeologist/inspect.py")

cached = {}
if cache_path.exists():
    try:
        cached = json.loads(cache_path.read_text())
    except (OSError, ValueError):
        cached = {}

fresh = (
    cached.get("binary_sha256") == art["sha256"]
    and cached.get("library_sha256") == art["library_sha256"]
    and cached.get("openplc_sha256") == art.get("openplc_sha256")
    and cached.get("fulmatic_motion_sha256") == art.get("fulmatic_motion_sha256")
    and cached.get("probe_source_sha256") == probe_sha
    and cached.get("inspect_source_sha256") == inspect_sha
    and isinstance(cached.get("probes"), dict)
    and isinstance(cached.get("equivalence"), dict)
    and isinstance(cached.get("evm_probe"), dict)
    and rea_bin_path.exists()
    and rea_evm_path.exists()
    and evm_trace_path.exists()
)

if fresh:
    print(
        "[pre-warm] Judge Fast-Probe cache ready for all 3 targets:\n"
        f"  1. openplc_runtime (elf64-x86-64 + libopenplc_runtime.so): {str(art.get('openplc_sha256', ''))[:12]}...\n"
        f"  2. fulmatic_motion_cortex_m4.elf (STM32F407 ARM Cortex-M4): {str(art.get('fulmatic_motion_sha256', ''))[:12]}...\n"
        f"  3. legacy_controller (stripped servo plant + .so):          {art['sha256'][:12]}..."
    )
else:
    print(
        "[pre-warm] Compiling, REA-inspecting (objdump), and FFI-probing all 3 targets:\n"
        "  - build/openplc_runtime & build/libopenplc_runtime.so (OpenPLC IEC 61131-3 Runtime)\n"
        "  - build/fulmatic_motion_cortex_m4.elf (Fulmatic STM32F407 ARM Cortex-M4 PLC Firmware)\n"
        "  - build/legacy_controller & build/legacy_controller.so (Stripped Closed-Loop Servo Plant)"
    )
    insp = inspect()
    prb = probe()
    eq = equivalence()
    evm_run = subprocess.run(
        [str(ROOT / "node_modules/node/bin/node"), str(ROOT / "scripts/evm_probe.cjs")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=45,
    )
    evm_probe = json.loads(evm_run.stdout.strip().splitlines()[-1])
    payload = {
        "binary_sha256": art["sha256"],
        "library_sha256": art["library_sha256"],
        "openplc_sha256": art.get("openplc_sha256"),
        "fulmatic_motion_sha256": art.get("fulmatic_motion_sha256"),
        "source_sha256": art["source_sha256"],
        "probe_source_sha256": probe_sha,
        "inspect_source_sha256": inspect_sha,
        "artifact": art,
        "inspection": insp,
        "probes": prb,
        "equivalence": eq,
        "evm_probe": evm_probe,
    }
    fd, tmp_path = tempfile.mkstemp(prefix=".prewarm-", dir=BUILD)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp_path, cache_path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    print(f"[pre-warm] Wrote {cache_path.relative_to(ROOT)} (all 3 industrial targets pre-warmed)")
PY

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
printf '\n================================================================================\n'
printf 'LAZARUS-TWIN Workbench: http://localhost:%s (API: http://localhost:%s)\n' "$FRONTEND_PORT" "$BACKEND_PORT"
printf 'Active Skill Reset:     v1 (.skills/controllers/active_skill.py)\n'
printf 'Industrial Targets:     1) build/openplc_runtime + libopenplc_runtime.so (OpenPLC IEC 61131-3)\n'
printf '                        2) build/fulmatic_motion_cortex_m4.elf (STM32F407 ARM Cortex-M4 PLC)\n'
printf '                        3) build/legacy_controller + .so (Stripped Closed-Loop Servo Plant)\n'
printf 'Pre-Warmed Evidence:    build/prewarmed_probe.json (<150ms Judge Fast-Probe)\n'
printf '--------------------------------------------------------------------------------\n'
printf '3-MINUTE JUDGE DEMO RUNBOOK:\n'
printf '  0:00-0:40  Living factory + dual-arm baseline vs 30.0 deg target reticle\n'
printf '             (Point out honest SIM TWIN / WS TELEMETRY / physical_wiring_verified: false)\n'
printf '  0:40-1:10  Inject Load Fault (-58%% torque) OR Thermal Spike (89.5 C) ONLY\n'
printf '             (Watch mechanical sag to ~16.6 deg or E-stop latch in 3D; no forced evolve)\n'
printf '  1:10-2:10  Probe Unknown Branches (OpenPLC + Fulmatic ARM Cortex-M4 + Servo Bisection)\n'
printf '             (Show OpenPLC ~4,700+ insns & FFI 7/7 channel bind + E-stop zeroing,\n'
printf '              Fulmatic STM32F407 ARM .text.MotionControl sections, %%IW1 INFERRED, and\n'
printf '              servo blind bisection recovery 88.0 C +- 1.86e-8 C)\n'
printf '  2:10-2:50  Evolve Skill (v1 -> v2 Training-PASS / Held-Out-FAIL -> git revert -> v3)\n'
printf '             (Show World 3 failure, real git revert, v3 LOCAL_TEMPLATE/MUSE_SYNTHESIZED\n'
printf '              passing 5 held-out worlds + 6 AST mutants in Landlock/seccomp sandbox)\n'
printf '  2:50-3:00  State aloud the Built-vs-REA boundary (REA = objdump/4-byte wrapper only\n'
printf '             for OpenPLC, Fulmatic ARM, & Servo ELF; OpenPLC/Servo FFI probers, Anvil\n'
printf '             harness, Landlock/seccomp verifier, Git saga, & 3D workcell built here)\n'
printf '================================================================================\n\n'
wait -n "$backend_pid" "$frontend_pid"
