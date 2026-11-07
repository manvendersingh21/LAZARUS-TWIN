"""Deterministic, fixed-step rotational rigid-body and thermal simulation.

Units: angle degrees, angular velocity degrees/s, PWM percentage. The inertia,
friction, motor efficiency and gravity coefficient are tunable model parameters,
not measurements from real equipment.
"""
from collections import deque
from dataclasses import dataclass
import ast
import hashlib
import math
from pathlib import Path
import threading
from backend.prober.ffi import LegacyController
from backend.evolution_engine.sandboxed_controller import SandboxedController
from backend.rea_archaeologist.build import ROOT

DT = 0.01

@dataclass(frozen=True)
class World:
    name: str = "live"
    efficiency: float = 0.42
    gravity: float = 25.0
    inertia: float = 2.0
    friction: float = 1.2
    sensor_lag_s: float = 0.0
    initial_temp: float = 30.0


def skill_metadata(path):
    """Read a literal VERSION and digest without executing the candidate module."""
    source=Path(path).read_bytes()
    checksum=hashlib.sha256(source).hexdigest()
    tree=ast.parse(source,filename=str(path))
    for node in tree.body:
        if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=="VERSION" for target in node.targets):
            if isinstance(node.value,ast.Constant) and isinstance(node.value.value,str):
                return node.value.value,checksum
    return "unknown",checksum


class Arm:
    def __init__(self, controller, world=World(), target=30.0):
        self.controller=controller
        self.world=world
        self.target=target
        self.angle=0.0
        self.velocity=0.0
        self.temperature=world.initial_temp
        self.pwm=0.0
        self.estop=0
        self.cooling=0
        self.state={}
        self.delay=deque([0.0]*max(1,round(world.sensor_lag_s / DT)))
        self.sabotage=True
        self.ticks=0

    def step(self):
        measured=self.delay.popleft()
        self.delay.append(self.angle)
        out=self.controller(self.target, measured, self.velocity, self.temperature, self.state)
        pwm=float(out["pwm"])
        if not math.isfinite(pwm): raise ValueError("controller returned non-finite PWM")
        self.estop=int(bool(self.estop or out["estop"]))
        self.cooling=int(bool(out["cooling"] or self.temperature >= 88.0))
        self.pwm=0.0 if self.estop else max(-100.0,min(100.0,pwm))
        efficiency=self.world.efficiency if self.sabotage else 1.0
        gravity=self.world.gravity if self.sabotage else 8.0
        acceleration=(efficiency*self.pwm - gravity*math.cos(math.radians(self.angle)) - self.world.friction*self.velocity)/self.world.inertia
        self.velocity += acceleration*DT
        self.angle += self.velocity*DT
        # Clamp to physical stop so a tripped arm cannot fall forever.
        if self.angle < -90.0: self.angle=-90.0; self.velocity=max(0.0,self.velocity)
        if self.angle > 90.0: self.angle=90.0; self.velocity=min(0.0,self.velocity)
        self.temperature += (abs(self.pwm)*0.0005 - (0.025 if self.cooling else 0.0))*DT
        self.ticks+=1
        return self.snapshot()

    def snapshot(self):
        return {"target_angle":self.target, "angle":self.angle, "velocity":self.velocity,
                "temperature":self.temperature, "pwm":self.pwm, "estop":self.estop,
                "cooling":self.cooling, "tracking_error_deg":self.target-self.angle,
                "sabotage_active":self.sabotage}


class DualTwin:
    def __init__(self, skill_path=None):
        self.lock=threading.RLock()
        self.legacy=LegacyController()
        self.skill_path=Path(skill_path or ROOT / ".skills/controllers/active_skill.py")
        version,checksum=skill_metadata(self.skill_path)
        self.skill=SandboxedController(self.skill_path,version=version,expected_sha256=checksum)
        self._reset()

    def _reset(self):
        self.tick=0
        self.left=Arm(self.legacy.step)
        self.right=Arm(self.skill.step)
        self.left.sabotage=self.right.sabotage=False

    def reset(self):
        with self.lock:self._reset()
        return self.snapshot()

    def set_fault(self, enabled, thermal_spike=False):
        with self.lock:
            self.left.sabotage=self.right.sabotage=bool(enabled)
            if thermal_spike:self.left.temperature=self.right.temperature=89.5
        return self.snapshot()

    def adopt(self,path):
        path=Path(path)
        version,checksum=skill_metadata(path)
        candidate=SandboxedController(path,version=version,expected_sha256=checksum)
        try:
            with self.lock:
                previous=self.skill
                self.skill=candidate
                self.skill_path=path
                self.right.controller=candidate.step
                self.right.state={}
        except BaseException:
            candidate.close()
            raise
        if isinstance(previous,SandboxedController):previous.close()
        return candidate.VERSION

    def close(self):
        skill=getattr(self,"skill",None)
        if isinstance(skill,SandboxedController):skill.close()

    def __del__(self):
        try:self.close()
        except Exception:pass

    def step(self,steps=1):
        if not 0 <= steps <= 10000:raise ValueError("steps out of range")
        with self.lock:
            for _ in range(steps):
                self.left.step(); self.right.step(); self.tick+=1
            return self.snapshot()

    def snapshot(self):
        with self.lock:
            return {"tick":self.tick,"active_skill_version":getattr(self.skill,"VERSION","unknown"),
                    "left_legacy":self.left.snapshot(),"right_evolved":self.right.snapshot()}
