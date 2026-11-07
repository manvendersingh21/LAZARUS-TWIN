"""Exercise the OS boundary with a candidate that tries real side effects."""
import json
import subprocess
import sys

import pytest

from backend.db.store import Store
from backend.evolution_engine.engine import EvolutionEngine
from backend.evolution_engine.sandboxed_controller import SandboxedController
from backend.physics_sim.engine import DualTwin
from backend.rea_archaeologist.build import ROOT


def hostile_candidate(tmp_path):
    sentinel = tmp_path / 'private.txt'
    sentinel.write_text('private fixture')
    marker = tmp_path / 'marker'
    source = tmp_path / 'candidate.py'
    source.write_text(f'''import os, socket
VERSION = "hostile-demo"
flags = {{}}
try:
    open({str(sentinel)!r}).read()
    flags["read_denied"] = False
except PermissionError:
    flags["read_denied"] = True
try:
    open({str(marker)!r}, "w").write("bad")
    flags["write_denied"] = False
except PermissionError:
    flags["write_denied"] = True
try:
    socket.socket()
    flags["socket_denied"] = False
except PermissionError:
    flags["socket_denied"] = True
try:
    os.chmod({str(sentinel)!r}, 0)
    flags["chmod_denied"] = False
except PermissionError:
    flags["chmod_denied"] = True
try:
    pid = os.fork()
    if pid == 0: os._exit(0)
    flags["fork_denied"] = False
except PermissionError:
    flags["fork_denied"] = True
def step(target, angle, velocity, temp, state=None):
    return {{"pwm":0.0, "estop":0, "cooling":0, "sandbox":flags}}
''')
    return source, marker


def test_sandbox_applies_before_candidate_module_exec(tmp_path):
    source, marker = hostile_candidate(tmp_path)
    process = subprocess.run(
        [sys.executable, str(ROOT / 'backend/verifier_agent/worker.py'), str(source)],
        input=json.dumps([0, 0, 0, 20])+'\n', capture_output=True, text=True, timeout=10,
    )
    assert process.returncode == 0, process.stderr
    result=json.loads(process.stdout)
    assert all(result['sandbox'].values())
    assert not marker.exists()


def test_live_twin_runs_candidate_in_sandbox_and_reaps_it(tmp_path):
    source, marker = hostile_candidate(tmp_path)
    sim=DualTwin(skill_path=source)
    try:
        assert isinstance(sim.skill, SandboxedController)
        result=sim.skill.step(0,0,0,20,{})
        assert all(result['sandbox'].values())
        assert not marker.exists()
        process=sim.skill.process
        sim.step()
    finally:
        sim.close()
    assert process.poll() is not None


def test_failed_promotion_restores_previous_skill(tmp_path, monkeypatch):
    store=Store(force_offline=True,local_path=tmp_path/'db.json')
    sim=DualTwin()
    active=tmp_path/'active.py'
    active.write_bytes((ROOT/'.skills/controllers/active_skill.py').read_bytes())
    before=active.read_bytes()
    original_skill=sim.skill
    original_commit=store.commit_verdict
    def fail_certification(job_id,record,active_commit,status):
        if status=='CERTIFIED_FOR_HOT_SWAP':raise RuntimeError('injected transaction failure')
        return original_commit(job_id,record,active_commit,status)
    monkeypatch.setattr(store,'commit_verdict',fail_certification)
    try:
        with pytest.raises(RuntimeError,match='injected transaction failure'):
            EvolutionEngine(sim,store,base_dir=tmp_path/'repos',active_path=active).run()
        assert active.read_bytes()==before
        assert sim.skill is original_skill
        assert sim.skill.process.poll() is None
        assert sim.step()['active_skill_version']==original_skill.VERSION
    finally:
        sim.close()


def test_live_worker_rejects_changed_candidate_digest(tmp_path):
    source, _ = hostile_candidate(tmp_path)
    with pytest.raises(RuntimeError):
        SandboxedController(source, expected_sha256='0'*64)
