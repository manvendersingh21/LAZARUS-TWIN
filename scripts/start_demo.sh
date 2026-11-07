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
printf -- '--------------------------------------------------------------------------------\n'
printf '6 BACKEND SCENARIO CONTROLS (/api/scenarios & /api/sim/control):\n'
printf '  1) Nominal                      (eff=1.00, grav=8.0,  inertia=2.0, fric=1.2, lag=0.00s, temp=30C)\n'
printf '  2) Heavy payload (payload_mass) (eff=0.40, grav=26.0, inertia=2.4, fric=1.2, lag=0.00s, temp=30C)\n'
printf '  3) Low friction                 (eff=0.45, grav=24.0, inertia=1.7, fric=0.3, lag=0.00s, temp=30C)\n'
printf '  4) High inertia and sensor lag  (eff=0.42, grav=25.0, inertia=4.5, fric=0.6, lag=0.45s, temp=30C)\n'
printf '  5) Thermal stress               (eff=0.46, grav=22.0, inertia=2.2, fric=1.0, lag=0.00s, temp=80C)\n'
printf '  6) Combined perturbations       (eff=0.38, grav=26.0, inertia=3.0, fric=1.1, lag=0.18s, temp=30C)\n'
printf 'TRANSPORT BAR CONTROLS:\n'
printf '  [ Play ] Resume 100Hz sim  |  [ Pause ] Freeze tick  |  [ Reset ] Nominal 0 deg  |  [ Replay ] Re-run scenario\n'
printf -- '--------------------------------------------------------------------------------\n'
printf '5-BEAT 3-MINUTE JUDGE DEMO TALK TRACK (0:00-3:00):\n'
printf '  0:00-0:25  Beat 1: Dual Synchronized 3D Viewports & MIT 2.017J Planar Physics\n'
printf '             (LEFT: Legacy PLC orange arm vs RIGHT: Evolved cyan arm, +30.0 deg\n'
printf '              translucent green ghost target, dynamic angular error arc, & 6 charts)\n'
printf '  0:25-1:10  Beat 2: 6 Scenarios, Transport Bar (Play/Pause/Reset/Replay), & Sag\n'
printf '             (Select Heavy payload -> watch ~16.6 deg sag / 13.4 deg error arc &\n'
printf '              endpoint payload mass; demo Pause/Play/Replay & Thermal Spike 89.5 C)\n'
printf '  1:10-1:55  Beat 3: Probe I/O Branches (OpenPLC + Fulmatic ARM + Servo Bisection)\n'
printf '             (OpenPLC ~4,700+ insns & FFI 7/7 channel bind + E-stop zeroing, Fulmatic\n'
printf '              1,102 Thumb-2 insns, servo 30-step bisection 88.0 C +- 1.86e-8 C, %%IW1 INFERRED)\n'
printf '  1:55-2:40  Beat 4: Autonomous (mu=4, lambda=14) ES Evolution (312 Episodes)\n'
printf '             (v1 [3.0, 0.8] -> v2 kp=17.196 fails Held-Out World 3 & git reverts ->\n'
printf '              v3 [kp=3.554, kd=10.608, ki=0.649, k_ff=32.931, alpha_v=0.817, i_clamp=41.68]\n'
printf '              cuts loss 355.15 -> 2.77 (-99.2%%), passes 5/5 held-out worlds + 6/6 AST mutants)\n'
printf '  2:40-3:00  Beat 5: Replay Step Response Across Perturbations & Built-vs-REA Boundary\n'
printf '             (Click Replay to compare transient response on all 6 engineering graphs;\n'
printf '              state aloud that rea-agents is only the objdump/4-byte wrapper)\n'
printf '================================================================================\n\n'
wait -n "$backend_pid" "$frontend_pid"
