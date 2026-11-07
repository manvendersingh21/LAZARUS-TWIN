"""High-gain candidate: intentionally subject to held-out evaluation."""
import math
VERSION = "v2"

def step(target, angle, velocity, temp, state=None):
    if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
        return {"pwm": 0.0, "estop": 1, "cooling": 1}
    error = target - angle
    cooling = int(temp >= 72.0)
    if temp >= 88.0 or abs(error) > 45.0:
        return {"pwm": 0.0, "estop": 1, "cooling": cooling}
    return {"pwm": max(-100.0, min(100.0, 18.0 * error - 0.5 * velocity)), "estop": 0, "cooling": cooling}
