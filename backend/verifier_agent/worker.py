"""Restricted controller execution process: JSON lines in, JSON lines out."""
import json
import sys
from candidate_sandbox import load_candidate

step, _ = load_candidate(sys.argv[1])
for line in sys.stdin:
    try:
        args = json.loads(line)
        result = step(*args)
        print(json.dumps(result, allow_nan=False), flush=True)
    except Exception as exc:
        print(json.dumps({"error":type(exc).__name__}), flush=True)
