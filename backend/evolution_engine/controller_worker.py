"""Stateful controller handle, sandboxed before candidate import."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend/verifier_agent'))
from candidate_sandbox import load_candidate

step, _ = load_candidate(sys.argv[1], sys.argv[2] if len(sys.argv)>2 else None)
state={}
for line in sys.stdin:
    try:
        request=json.loads(line)
        if request.get("op")=="reset":
            state={}
            result={"ok":True}
        else:
            result=step(*request["inputs"],state)
        print(json.dumps(result,allow_nan=False),flush=True)
    except Exception as exc:
        print(json.dumps({"error":type(exc).__name__}),flush=True)
