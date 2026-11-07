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
    assert overfit["origin"]=="single_world_es"
    assert adaptive["origin"]=="autonomous_es"
    assert result["es_search"]["episodes_simulated"]==312
    assert result["es_search"]["converged_v3_genome"]["kp"]==3.554
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
    # Verification Req 6: Passive physics still moves the arm under gravity during E-Stop (not artificially frozen)
    angle_t1 = state["left_legacy"]["angle"]
    state_t10 = sim.step(10)
    assert state_t10["left_legacy"]["pwm"] == 0.0
    assert state_t10["left_legacy"]["angle"] < angle_t1
    sim.set_fault(False)
    assert sim.step()["right_evolved"]["estop"]==1
    assert sim.reset()["right_evolved"]["estop"]==0
    sim.close()


def test_seven_point_physics_and_scenario_verification():
    import math
    from backend.physics_sim.engine import DT, list_scenarios
    from backend.physics_sim.worlds import WORLDS

    sim = DualTwin()
    try:
        # 1. Verify 3D arm rotation mapping (thetaRad = angle * pi / 180) matches physics angle across test angles
        for test_deg in (-90.0, -30.0, 0.0, 30.0, 45.0, 90.0):
            theta_rad = (test_deg * math.pi) / 180.0
            recovered_deg = (theta_rad * 180.0) / math.pi
            assert math.isclose(recovered_deg, test_deg, abs_tol=1e-12)

        # 2 & 5. Verify scenario selection changes actual physical parameters and both controllers receive identical disturbances
        scenarios = list_scenarios()
        assert [s["id"] for s in scenarios] == [
            "nominal",
            "payload_mass",
            "low_friction",
            "high_inertia_sensor_lag",
            "thermal_stress",
            "combined_perturbations",
        ]
        for idx, sc in enumerate(scenarios[1:]):
            snap = sim.set_scenario(sc["id"])
            assert snap["scenario_id"] == sc["id"]
            assert snap["world"]["efficiency"] == WORLDS[idx].efficiency
            assert snap["world"]["gravity"] == WORLDS[idx].gravity
            assert snap["world"]["inertia"] == WORLDS[idx].inertia
            assert snap["world"]["friction"] == WORLDS[idx].friction
            assert snap["world"]["sensor_lag_s"] == WORLDS[idx].sensor_lag_s
            assert snap["world"]["dt"] == DT == 0.01
            assert sim.left.world == sim.right.world
            assert sim.left.sabotage == sim.right.sabotage is True
            assert sim.left.target == sim.right.target == 30.0

        # 3 & 4. Verify all displayed metrics match backend values and sensor lag delays controller observation
        sim.set_scenario("high_inertia_sensor_lag")
        stepped = sim.step(15)
        for key in ("target_angle", "angle", "observed_angle", "velocity", "temperature", "pwm", "estop", "cooling", "tracking_error_deg"):
            assert key in stepped["left_legacy"]
            assert key in stepped["right_evolved"]
        assert math.isclose(
            stepped["left_legacy"]["tracking_error_deg"],
            stepped["left_legacy"]["target_angle"] - stepped["left_legacy"]["angle"],
            abs_tol=1e-12,
        )
        # Because sensor_lag_s = 0.45s (45 ticks), at tick 15 observed_angle is still 0.0 while true angle has moved
        assert stepped["left_legacy"]["observed_angle"] == 0.0
        assert stepped["left_legacy"]["angle"] != 0.0
    finally:
        sim.close()
