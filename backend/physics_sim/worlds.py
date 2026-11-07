"""Offline evaluation worlds. Parameters are held out from the live workcell.

These are deterministic benchmark fixtures, not physically sealed secret worlds.
"""
from .engine import Arm, World

WORLDS=(
    World("Payload mass",efficiency=.40,gravity=26,inertia=2.4),
    World("Low friction",efficiency=.45,gravity=24,inertia=1.7,friction=.3),
    World("High inertia + sensor lag",efficiency=.42,gravity=25,inertia=4.5,friction=.6,sensor_lag_s=.45),
    World("Thermal stress",efficiency=.46,gravity=22,inertia=2.2,friction=1,initial_temp=80),
    World("Combined perturbations",efficiency=.38,gravity=26,inertia=3,friction=1.1,sensor_lag_s=.18),
)

def evaluate(controller, steps=3000):
    scores=[]
    for number,world in enumerate(WORLDS,1):
        arm=Arm(controller,world)
        peak=0.0
        errors=[]
        for i in range(steps):
            s=arm.step()
            peak=max(peak,s["angle"]-arm.target)
            if i>=steps-200:errors.append(abs(s["tracking_error_deg"]))
        steady=sum(errors)/len(errors)
        passed=steady<2.2 and peak<4.5 and not arm.estop
        reasons=[]
        if steady>=2.2:reasons.append("steady-state error >= 2.2°")
        if peak>=4.5:reasons.append("overshoot >= 4.5°")
        if arm.estop:reasons.append("emergency stop latched")
        scores.append({"world":number,"name":world.name,"passed":passed,"steady_state_error_deg":round(steady,3),
                       "peak_overshoot_deg":round(peak,3),"estop":arm.estop,"reasons":reasons})
    return scores

def evaluate_isolated(path):
    """Start the held-out evaluator with an execution handle, not candidate source."""
    import json
    import os
    import subprocess
    import sys
    from backend.rea_archaeologist.build import ROOT
    env={"PATH":os.environ.get("PATH",""),"LANG":"C.UTF-8"}
    worker=subprocess.Popen([sys.executable,str(ROOT/"backend/evolution_engine/controller_worker.py"),str(path)],
                            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
    try:
        write_fd,read_fd=worker.stdin.fileno(),worker.stdout.fileno()
        result=subprocess.run([sys.executable,"-m","backend.physics_sim.isolated_world_runner",str(write_fd),str(read_fd)],
                              cwd=ROOT,pass_fds=(write_fd,read_fd),capture_output=True,text=True,timeout=60,env=env)
        if result.returncode:raise RuntimeError("isolated world evaluation failed: "+result.stderr[-600:])
        return json.loads(result.stdout)
    finally:
        worker.terminate()
        try:worker.wait(timeout=3)
        except subprocess.TimeoutExpired:worker.kill();worker.wait()
        worker.stdin.close();worker.stdout.close()
