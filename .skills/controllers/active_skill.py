"""Adaptive skill: anti-windup integral, velocity filter and gravity feedforward."""
import math
VERSION = "v3"

def step(target, angle, velocity, temp, state=None):
    if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
        return {"pwm": 0.0, "estop": 1, "cooling": 1}
    error = target - angle
    cooling = int(temp >= 72.0)
    if temp >= 88.0 or abs(error) > 45.0:
        return {"pwm": 0.0, "estop": 1, "cooling": cooling}
    if state is None:
        state = {}
    state["integral"] = max(-50.0, min(50.0, state.get("integral", 0.0) + error * 0.01))
    state["filtered_velocity"] = 0.15 * velocity + 0.85 * state.get("filtered_velocity", 0.0)
    gravity_feedforward = 30.0 * math.cos(math.radians(angle))
    return {"pwm": max(-100.0, min(100.0, 3.0 * error - 8.0 * state["filtered_velocity"] + 0.6 * state["integral"] + gravity_feedforward)), "estop": 0, "cooling": cooling}
