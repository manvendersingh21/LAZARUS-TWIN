import ctypes
from backend.rea_archaeologist.build import build

class Output(ctypes.Structure):
    _fields_ = [("pwm", ctypes.c_double), ("estop", ctypes.c_int), ("cooling", ctypes.c_int)]

class LegacyController:
    def __init__(self, library=None):
        path = library or build()["library"]
        self.lib = ctypes.CDLL(str(path))
        self.fn = self.lib.controller_step
        self.fn.argtypes = [ctypes.c_double] * 4
        self.fn.restype = Output

    def step(self, target, angle, velocity, temp, state=None):
        result = self.fn(target, angle, velocity, temp)
        return {"pwm": result.pwm, "estop": result.estop, "cooling": result.cooling}
