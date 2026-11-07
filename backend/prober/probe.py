"""Black-box boundary probes and sampled differential tests, not a formal proof."""
import math
import random
import subprocess
from .ffi import LegacyController
from backend.evolution_engine.sandboxed_controller import SandboxedController
from backend.rea_archaeologist.build import ROOT, build


def probe(controller=None):
    legacy = controller or LegacyController()
    def search(node_id,channel,make_input,low,high):
        observations=[]
        def sample(value):
            args=make_input(value)
            out=legacy.step(*args)
            observations.append({"input":list(args),"output":out})
            return out[channel]
        lower,upper=sample(low),sample(high)
        if lower != 0 or upper != 1:
            return {"node_id":node_id,"state":"UNKNOWN","confidence":0.0,
                    "payload":{"samples":observations,"scope":"No branch transition was bracketed."}}
        for _ in range(30):
            middle=(low+high)/2
            if sample(middle):high=middle
            else:low=middle
        return {"node_id":node_id,"state":"SEEN","confidence":1.0,
                "payload":{"samples":observations,"bracket":[low,high],
                           "scope":"Observed transition bracket; neither an exact threshold nor exhaustive proof."}}
    findings=[
        search("COOLING_BOUNDARY","cooling",lambda t:(0,0,0,t),0,120),
        search("THERMAL_BOUNDARY","estop",lambda t:(0,0,0,t),0,120),
        search("RUNAWAY_BOUNDARY","estop",lambda e:(e,0,0,20),0,90),
    ]
    negative=search("RUNAWAY_NEGATIVE_BOUNDARY","estop",lambda e:(-e,0,0,20),0,90)
    findings[-1]["payload"]["negative_error_sweep"]=negative["payload"]
    if negative["state"] != "SEEN":findings[-1]["state"]="UNKNOWN";findings[-1]["confidence"]=0.0
    gains = {"proportional_sample":legacy.step(1,0,0,20)["pwm"], "velocity_sample":legacy.step(0,0,1,20)["pwm"],
             "scope":"single unsaturated input-output samples, not a proof of linearity"}
    waveform=[]
    for index in range(1000):
        temperature=(index%250)*0.48
        error=((index*37)%1200)/10.0-60.0
        velocity=((index*53)%4000)/10.0-200.0
        inputs=(error,0.0,velocity,temperature)
        waveform.append({"input":inputs,"output":legacy.step(*inputs)})
    return {"findings":findings, "gains":gains, "waveform":waveform, "waveform_count":len(waveform)}


def equivalence(count=1000, seed=2026):
    if count < 1:raise ValueError("count must be positive")
    artifacts=build()
    legacy = LegacyController(artifacts["library"])
    candidate = SandboxedController(ROOT / "backend/evolution_engine/templates/v1.py",version="v1")
    rng = random.Random(seed)
    edges=[(0,0,0,72),(0,0,0,88),(45,0,0,20),(45.000001,0,0,20),(-45,0,0,20),(-45.000001,0,0,20),
           (float('nan'),0,0,20),(0,0,float('inf'),20),(0,0,0,float('-inf'))]
    vectors=edges[:count]
    while len(vectors)<count:
        if len(vectors)%2:
            vectors.append((rng.uniform(-40,40),0,rng.uniform(-100,100),rng.uniform(0,87.9)))
        else:
            vectors.append((rng.uniform(-90,90),rng.uniform(-90,90),rng.uniform(-250,250),rng.uniform(-20,130)))
    mismatches=[]
    try:
        for i, vector in enumerate(vectors):
            ffi, recovered = legacy.step(*vector), candidate.step(*vector)
            completed=subprocess.run([artifacts['binary'],*[repr(v) for v in vector]],capture_output=True,text=True,check=True,timeout=3)
            p,e,c=completed.stdout.split()
            executable={'pwm':float(p),'estop':int(e),'cooling':int(c)}
            def same(a,b):
                return a['estop']==b['estop'] and a['cooling']==b['cooling'] and math.isclose(a['pwm'],b['pwm'],rel_tol=1e-12,abs_tol=1e-9)
            if not same(ffi,recovered) or not same(executable,ffi):
                mismatches.append({'index':i,'input':[str(v) for v in vector],'executable':executable,'ffi':ffi,'recovered':recovered})
    finally:
        candidate.close()
    return {'vectors':count,'seed':seed,'passed':count-len(mismatches),'mismatch_count':len(mismatches),'mismatches':mismatches[:10],
            'pass_rate':(count-len(mismatches))/count,'binary_sha256':artifacts['sha256'],'library_sha256':artifacts['library_sha256'],
            'scope':'Sampled comparison of the stripped executable, shared library and baseline Python; not a proof for all inputs.'}

if __name__ == "__main__":
    import json
    print(json.dumps({"probes":probe(), "equivalence":equivalence()}, indent=2))
