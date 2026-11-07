"""Black-box tests: receives only an execution handle and public invariants.

The process boundary avoids passing source to this module, but it is not an
OS-enforced or information-theoretic airgap; see README before deployment.
"""
import json
import math
import subprocess
import sys
from backend.rea_archaeologist.build import ROOT

class BlackBox:
    def __init__(self, candidate):
        self.process = subprocess.Popen([sys.executable, str(ROOT / "backend/verifier_agent/worker.py"), str(candidate)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    def step(self, *args):
        self.process.stdin.write(json.dumps(args) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("Candidate process exited")
        return json.loads(line)
    def close(self):
        self.process.stdin.close()
        self.process.terminate()
        self.process.wait(timeout=3)
        self.process.stdout.close()

def verify(handle):
    failures = []
    def check(name, condition):
        if not condition: failures.append(name)
    try:
        hot = handle.step(0,0,0,88)
        check("thermal_cutoff", hot.get("estop") == 1 and hot.get("cooling") == 1 and hot.get("pwm") == 0)
        check("cooling_activation", handle.step(0,0,0,72).get("cooling") == 1)
        check("runaway_interlock", handle.step(45.01,0,0,20).get("estop") == 1 and handle.step(-45.01,0,0,20).get("estop") == 1)
        saturation = [handle.step(0,0,velocity,20).get("pwm") for velocity in (-1000,1000)]
        check("saturation", all(isinstance(x, (int,float)) and math.isfinite(x) and -100 <= x <= 100 for x in saturation))
        invalid = [handle.step(*args) for args in [(float('nan'),0,0,20),(0,0,float('inf'),20),(0,0,0,float('nan'))]]
        check("invalid_input", all(x.get("estop") == 1 and x.get("pwm") == 0 for x in invalid))
        positive, negative = handle.step(5,0,0,20), handle.step(-5,0,0,20)
        check("directionality", positive.get("pwm",0) > negative.get("pwm",0))
    except Exception as exc:
        failures.append("execution:" + type(exc).__name__)
    return {"passed":not failures, "failures":failures, "checks":6}

def verify_isolated(candidate):
    """Start a controller handle and a separate verifier with no source path or secrets."""
    import os
    worker = subprocess.Popen([sys.executable, str(ROOT / "backend/verifier_agent/worker.py"), str(candidate)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              env={"PATH":os.environ.get("PATH", ""), "LANG":"C.UTF-8"})
    try:
        write_fd, read_fd = worker.stdin.fileno(), worker.stdout.fileno()
        result=subprocess.run([sys.executable,"-m","backend.verifier_agent.isolate",str(write_fd),str(read_fd)],
                              cwd=ROOT, pass_fds=(write_fd,read_fd), capture_output=True,text=True,timeout=15,
                              env={"PATH":os.environ.get("PATH", ""), "LANG":"C.UTF-8"})
        if result.returncode:
            raise RuntimeError("Verifier isolation failed: " + result.stderr[-600:])
        return json.loads(result.stdout)
    finally:
        worker.terminate()
        try: worker.wait(timeout=3)
        except subprocess.TimeoutExpired: worker.kill(); worker.wait()
        worker.stdin.close(); worker.stdout.close()
