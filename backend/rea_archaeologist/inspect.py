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


def inspect():
    artifact = build()
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
    atomic_json(ROOT / "build/rea_evm_evidence.json", evm_evidence)
    dump = rea_evidence["raw_result"]["stdout"]
    atomic_json(ROOT / "build/rea_evidence.json", rea_evidence)
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
        ("%IW0", "Target angle", 1), ("%IW1", "Joint angle", 1), ("%IW2", "Angular velocity", 1),
        ("%IW3", "Core temperature", 1), ("%QW0", "Motor PWM", 2),
        ("%QX0.0", "Emergency relay", 3), ("%QX0.1", "Cooling relay", 3)]
    topology = {"id":"plc-demo-v1", "slots":[
        {"slot":0,"name":"24V DC power"}, {"slot":1,"name":"16-bit analog input"},
        {"slot":2,"name":"PWM servo drive"}, {"slot":3,"name":"Dual safety relay"},
        {"slot":4,"name":"EVM / DePIN bridge"}],
        "terminals":[{"id": pin, "label": name, "slot": slot, "state":"UNKNOWN", "offset":None,
                      "note":"Physical pin mapping is a proposed demo topology, not a recovered wiring fact."}
                     for pin, name, slot in signals],
        "terminal_groups": 6, "provenance":"proposed_demo_topology", "physical_wiring_verified":False}
    counts = {state:sum(e["state"] == state for e in evidence) for state in ("SEEN", "INFERRED", "UNKNOWN")}
    return {"artifact":artifact, "rea":{"evidence_id":rea_evidence["evidence_id"], "provider":rea_evidence["provider"], "instruction_count":len(instructions)},
            "evm":{"evidence_id":evm_evidence["evidence_id"],"provider":evm_evidence["provider"],
                   "interface_candidates":evm_evidence.get("raw_result",{}).get("functions",[]),
                   "note":"Interface candidates are inferred; argument signedness is not proven by selector recovery."},
            "counts":counts, "evidence":evidence, "topology":topology}

if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
