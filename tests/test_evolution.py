"""Behavioral tests exercise real physics, isolation, and Git, not canned results."""
from pathlib import Path

from backend.evolution_engine.engine import EvolutionEngine
from backend.physics_sim.engine import DualTwin
from backend.db.store import Store


def test_evolution_reverts_overfit_and_adopts_verified_skill(tmp_path):
    # Use a temporary skill repository and active file; never touch the user's worktree.
    store=Store(force_offline=True)
    store.path=tmp_path / "fallback.json"
    store.local.clear()
    sim=DualTwin()
    sim.set_fault(True)
    result=EvolutionEngine(sim,store,base_dir=tmp_path / "repos",active_path=tmp_path / "active.py").run()
    baseline,overfit,adaptive=result["iterations"]
    assert [baseline["status"],overfit["status"],adaptive["status"]]==["BASELINE","REVERTED","ADOPTED"]
    assert overfit["training"]["passed"] and not overfit["worlds"][2]["passed"]
    assert overfit["worlds"][2]["peak_overshoot_deg"] > 4.5
    assert all(world["passed"] for world in adaptive["worlds"])
    assert adaptive["audit"]["baseline"]["passed"] and adaptive["audit"]["killed"]==6
    assert adaptive["world_verifier_isolation"]["filesystem"]=="denied"
    assert [job["status"] for job in store.local["airgapped_verification_bus"]]==["REJECTED_TRIGGER_GIT_REVERT","CERTIFIED_FOR_HOT_SWAP"]
    history=EvolutionEngine.git(Path(result["repository"]),"log","--format=%s")
    assert 'Revert "v2 aggressive training candidate"' in history
    sim.step(3000)
    live=sim.snapshot()
    assert live["left_legacy"]["tracking_error_deg"]>12
    assert abs(live["right_evolved"]["tracking_error_deg"])<1.5


def test_emergency_stop_remains_latched_until_reset():
    sim=DualTwin()
    sim.set_fault(True,thermal_spike=True)
    state=sim.step()
    assert all(state[name]["estop"]==1 and state[name]["cooling"]==1 and state[name]["pwm"]==0 for name in ("left_legacy","right_evolved"))
    sim.set_fault(False)
    assert sim.step()["right_evolved"]["estop"]==1
    assert sim.reset()["right_evolved"]["estop"]==0
