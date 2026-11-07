"""Evidence-first archaeology. Static findings are never presented as pin facts."""
import json
import os
import tempfile
import re
import subprocess
from pathlib import Path
from .build import ROOT, build


def atomic_json(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".evidence-", dir=path.parent)
    try:
        with os.fdopen(fd,"w") as stream:json.dump(data,stream,indent=2)
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def inspect_plc_targets(artifacts: dict, use_cache: bool = False) -> dict:
    cache_path = ROOT / "build/rea_plc_targets.json"
    if use_cache and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text())
            if (cached.get("openplc_runtime", {}).get("sha256") == artifacts.get("openplc_sha256")
                    and cached.get("fulmatic_cortex_m4", {}).get("sha256") == artifacts.get("fulmatic_motion_sha256")):
                return cached
        except Exception:
            pass
    node = ROOT / "node_modules/node/bin/node"
    rea = ROOT / "node_modules/rea-agents/scripts/rea.mjs"
    openplc_bin = artifacts["openplc_binary"]
    openplc_run = subprocess.run(
        [str(node), str(rea), "inspect-with-objdump", openplc_bin, "disassemble", "--format", "json"],
        text=True, capture_output=True, timeout=60, check=True,
    )
    openplc_ev = json.loads(openplc_run.stdout)
    openplc_stdout = openplc_ev.get("raw_result", {}).get("stdout", "")
    insn_re = re.compile(r"^\s*([0-9a-f]+):\s+(?:[0-9a-f]{2}\s+)+\s*(\S+)(?:\s+(.*))?")
    fn_re = re.compile(r"^[0-9a-f]+\s+<([^>]+)>:")
    target_fns = {
        "image_tables_bind_located_vars",
        "image_tables_zero_outputs",
        "image_tables_alloc",
        "located_globals_join_ex",
        "_Z16plc_cycle_threadPv",
        "plc_state_manager",
    }
    discovered_fns = []
    sample_insns = []
    current_fn = None
    insn_count = 0
    for line in openplc_stdout.splitlines():
        fm = fn_re.match(line.strip())
        if fm:
            fn_name = fm.group(1)
            current_fn = fn_name
            for tf in target_fns:
                if tf in fn_name and tf not in discovered_fns:
                    discovered_fns.append(tf)
            continue
        im = insn_re.match(line)
        if im:
            insn_count += 1
            if current_fn in ("image_tables_bind_located_vars", "image_tables_zero_outputs") and len(sample_insns) < 12:
                sample_insns.append({
                    "function": current_fn,
                    "address": "0x" + im.group(1),
                    "mnemonic": im.group(2),
                    "operands": (im.group(3) or "").strip(),
                })

    motion_elf = artifacts["fulmatic_motion_elf"]
    core_elf = artifacts["fulmatic_core_elf"]
    sym_run = subprocess.run(
        [str(node), str(rea), "inspect-with-objdump", motion_elf, "symbols", "--format", "json"],
        text=True, capture_output=True, timeout=30, check=True,
    )
    sec_run = subprocess.run(
        [str(node), str(rea), "inspect-with-objdump", motion_elf, "section_headers", "--format", "json"],
        text=True, capture_output=True, timeout=30, check=True,
    )
    core_sec_run = subprocess.run(
        [str(node), str(rea), "inspect-with-objdump", core_elf, "section_headers", "--format", "json"],
        text=True, capture_output=True, timeout=30, check=True,
    )
    sym_ev = json.loads(sym_run.stdout)
    sec_ev = json.loads(sec_run.stdout)
    core_sec_ev = json.loads(core_sec_run.stdout)

    sec_stdout = sec_ev.get("raw_result", {}).get("stdout", "") + "\n" + core_sec_ev.get("raw_result", {}).get("stdout", "")
    text_sections = []
    for line in sec_stdout.splitlines():
        for tok in line.split():
            if tok.startswith(".text.") and tok not in text_sections:
                text_sections.append(tok)

    sym_stdout = sym_ev.get("raw_result", {}).get("stdout", "")
    wanted_abi = ["_MotionSetPTO", "_GetMsTimerCount", "BitVariableResolve", "GetFloat", "SetBit", "_WatchDog"]
    hw_symbols = [s for s in wanted_abi if s in sym_stdout or f".text.{s}" in text_sections]
    sym_lines = [ln for ln in sym_stdout.splitlines() if re.match(r"^[0-9a-f]{8}\s", ln.strip())]

    from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_MCLASS
    from elftools.elf.elffile import ELFFile
    md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_MCLASS)
    thumb2_count = 0
    arm_samples = []
    with open(motion_elf, "rb") as stream:
        elf = ELFFile(stream)
        for sec in elf.iter_sections():
            if sec.name.startswith(".text."):
                code = sec.data()
                for insn in md.disasm(code, 0x08000000):
                    thumb2_count += 1
                    if sec.name in (".text.CheckVelocity", ".text.MotionControl") and len(arm_samples) < 14:
                        arm_samples.append({
                            "section": sec.name,
                            "address": f"0x{insn.address:08x}",
                            "mnemonic": insn.mnemonic,
                            "operands": insn.op_str,
                        })

    result = {
        "openplc_runtime": {
            "evidence_id": openplc_ev["evidence_id"],
            "sha256": artifacts.get("openplc_sha256"),
            "arch": "elf64-x86-64",
            "instruction_count": insn_count,
            "functions_discovered": discovered_fns,
            "sample_instructions": sample_insns,
        },
        "fulmatic_cortex_m4": {
            "evidence_id": sym_ev["evidence_id"],
            "section_evidence_id": sec_ev["evidence_id"],
            "core_evidence_id": core_sec_ev["evidence_id"],
            "sha256": artifacts.get("fulmatic_motion_sha256"),
            "core_sha256": artifacts.get("fulmatic_core_sha256"),
            "arch": "elf32-littlearm (STM32F407 Cortex-M4 EABI5)",
            "text_sections": text_sections,
            "hardware_abi_symbols": hw_symbols,
            "symbol_count": len(sym_lines),
            "thumb2_instruction_count": thumb2_count,
            "sample_instructions": arm_samples,
        },
    }
    atomic_json(cache_path, result)
    return result


def inspect(use_cache: bool = False):
    artifact = build()
    artifact["plant_provenance"] = "authored_demo_plant"
    rea_cache = ROOT / "build/rea_evidence.json"
    evm_cache = ROOT / "build/rea_evm_evidence.json"
    rea_evidence = None
    evm_evidence = None
    if use_cache and rea_cache.exists() and evm_cache.exists():
        try:
            cached_rea = json.loads(rea_cache.read_text())
            cached_evm = json.loads(evm_cache.read_text())
            if cached_rea.get("subject", {}).get("digest", {}).get("sha256") == artifact["sha256"]:
                rea_evidence = cached_rea
                evm_evidence = cached_evm
        except Exception:
            rea_evidence = None
            evm_evidence = None
    if rea_evidence is None or evm_evidence is None:
        node = ROOT / "node_modules/node/bin/node"
        rea = ROOT / "node_modules/rea-agents/scripts/rea.mjs"
        if not node.exists() or not rea.exists():
            raise RuntimeError("External REA is not installed; run npm install")
        command = [str(node), str(rea), "inspect-with-objdump", artifact["binary"], "disassemble", "--format", "json"]
        completed = subprocess.run(command, text=True, capture_output=True, timeout=30, check=True)
        rea_evidence = json.loads(completed.stdout)
        if rea_evidence.get("subject", {}).get("digest", {}).get("sha256") != artifact["sha256"]:
            raise RuntimeError("REA evidence does not match target binary")
        evm_path = ROOT / "contracts/legacy_governor.hex"
        if not evm_path.exists():
            raise RuntimeError("EVM bytecode artifact missing; run node scripts/evm_probe.cjs")
        evm_run = subprocess.run([str(node), str(rea), "inspect-evm-interface", str(evm_path), "hex", "--format", "json"],
                                 text=True, capture_output=True, timeout=40, check=True)
        evm_evidence = json.loads(evm_run.stdout)
        atomic_json(evm_cache, evm_evidence)
        atomic_json(rea_cache, rea_evidence)
    dump = rea_evidence["raw_result"]["stdout"]
    instructions = []
    for line in dump.splitlines():
        match = re.match(r"\s*([0-9a-f]+):\s+(?:[0-9a-f]{2}\s+)+\s*(\S+)(?:\s+(.*))?", line)
        if match:
            instructions.append({"address": "0x" + match.group(1), "address_kind": "ELF virtual address", "mnemonic": match.group(2), "operands": match.group(3) or "", "raw_line": line.strip()})
    floating = [x for x in instructions if any(s in x["mnemonic"] for s in ("sd", "ss", "xmm"))]
    jumps = [x for x in instructions if x["mnemonic"].startswith("j") and x["mnemonic"] != "jmp"]
    if not floating or not jumps:
        raise RuntimeError("Expected floating-point and conditional instructions in target")
    evidence = [
        {"node_id": "ASM_" + item["address"], "state": "SEEN", "confidence": 1.0, "payload": item, "source": rea_evidence["evidence_id"]}
        for item in (floating[:3] + jumps[:3])
    ]
    evidence += [
        {"node_id":"CONTROL_LAW", "state":"INFERRED", "confidence":0.35, "payload":"Floating-point feedback control is a candidate; gains and channels remain unproven."},
        *[{"node_id": node, "state":"UNKNOWN", "confidence":0.0, "payload":description} for node, description in [
            ("THERMAL_BOUNDARY", "Thermal shutdown threshold and relay behavior are unmeasured."),
            ("COOLING_BOUNDARY", "Cooling activation threshold is unmeasured."),
            ("RUNAWAY_BOUNDARY", "Tracking error interlock threshold is unmeasured.")]]
    ]
    signals = [
        ("%IW0", "Target angle", 1, "INFERRED", floating[0]["address"], "step(int256,int256,int256,int256)", "CONTROL_LAW"),
        ("%IW1", "Joint angle", 1, "INFERRED", floating[min(1, len(floating) - 1)]["address"], "step(int256,int256,int256,int256)", "CONTROL_LAW"),
        ("%IW2", "Angular velocity", 1, "INFERRED", floating[min(2, len(floating) - 1)]["address"], "step(int256,int256,int256,int256)", "CONTROL_LAW"),
        ("%IW3", "Core temperature", 1, "UNKNOWN", jumps[0]["address"], "step(int256,int256,int256,int256)", "THERMAL_BOUNDARY"),
        ("%QW0", "Motor PWM", 2, "INFERRED", floating[-1]["address"], "step(int256,int256,int256,int256)", "CONTROL_LAW"),
        ("%QX0.0", "Emergency relay", 3, "UNKNOWN", jumps[min(1, len(jumps) - 1)]["address"], "step(int256,int256,int256,int256)", "RUNAWAY_BOUNDARY"),
        ("%QX0.1", "Cooling relay", 3, "UNKNOWN", jumps[min(2, len(jumps) - 1)]["address"], "step(int256,int256,int256,int256)", "COOLING_BOUNDARY"),
    ]
    topology = {"id":"plc-demo-v1", "slots":[
        {"slot":0,"name":"24V DC power"}, {"slot":1,"name":"16-bit analog input"},
        {"slot":2,"name":"PWM servo drive"}, {"slot":3,"name":"Dual safety relay"},
        {"slot":4,"name":"EVM / DePIN bridge"}],
        "terminals":[{"id": pin, "label": name, "slot": slot, "state": state, "offset": offset,
                      "confidence": 0.65 if state == "INFERRED" else 0.0,
                      "provenance": "heuristic_demo_topology",
                      "signal_probed": False,
                      "governor_function": gov_fn, "parent_node_id": parent,
                      "note":"Heuristic demo topology mapping to C controller channel; static objdump provides instruction evidence without a CFG."}
                     for pin, name, slot, state, offset, gov_fn, parent in signals],
        "terminal_groups": 6, "provenance":"proposed_demo_topology",
        "plant_provenance": "authored_demo_plant",
        "physical_wiring_verified":False,
        "wiring_note":"Software I/O channels are sampled via FFI/CLI; physical PLC screw-terminal wiring is unverified in simulation."}
    counts = {state:sum(e["state"] == state for e in evidence) for state in ("SEEN", "INFERRED", "UNKNOWN")}
    plc_targets = inspect_plc_targets(artifact, use_cache=use_cache)
    return {"artifact":artifact, "plant_provenance":"authored_demo_plant",
            "rea":{"evidence_id":rea_evidence["evidence_id"], "provider":rea_evidence["provider"], "instruction_count":len(instructions)},
            "evm":{"evidence_id":evm_evidence["evidence_id"],"provider":evm_evidence["provider"],
                   "interface_candidates":evm_evidence.get("raw_result",{}).get("functions",[]),
                   "note":"Interface candidates are inferred; argument signedness is not proven by selector recovery."},
            "plc_targets":plc_targets,
            "counts":counts, "evidence":evidence, "topology":topology}

if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
