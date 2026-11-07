"""Score test worlds using only inherited controller pipes after OS isolation."""
import ctypes
import ctypes.util
import json
import os
import sys
from backend.physics_sim.worlds import evaluate
from backend.verifier_agent.isolate import restrict

class Handle:
    def __init__(self, input_fd, output_fd):
        self.output=os.fdopen(input_fd,"w",buffering=1)
        self.input=os.fdopen(output_fd,"r")
        self.last_state=None
    def exchange(self,request):
        self.output.write(json.dumps(request)+"\n")
        line=self.input.readline()
        if not line:raise RuntimeError("controller worker exited")
        result=json.loads(line)
        if "error" in result:raise RuntimeError("controller worker: "+result["error"])
        return result
    def step(self,target,angle,velocity,temp,state):
        if self.last_state is not state:
            self.exchange({"op":"reset"})
            self.last_state=state
        return self.exchange({"op":"step","inputs":[target,angle,velocity,temp]})

if __name__ == "__main__":
    name=ctypes.util.find_library("seccomp")
    if not name:raise RuntimeError("libseccomp is required")
    ctypes.CDLL(name)
    ctypes.util.find_library=lambda name:"libseccomp.so.2" if name=="seccomp" else None
    abi=restrict()
    handle=Handle(int(sys.argv[1]),int(sys.argv[2]))
    print(json.dumps({"worlds":evaluate(handle.step),"isolation":{"landlock_abi":abi,"filesystem":"denied","network":"seccomp-denied"}}),flush=True)
