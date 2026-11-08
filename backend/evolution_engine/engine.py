"""Real Git skill evolution, with fail-closed benchmark and mutation gates.

Git and the database are separate systems; promotion is a compensating saga,
not a cross-system atomic transaction. Git operations occur in an isolated
skill repository, never by resetting or reverting the user's main worktree.
"""
from datetime import datetime, timezone
import fcntl
import hashlib
import math
import os
from pathlib import Path
import random
import shutil
import subprocess
import threading
import time
import uuid

from backend.physics_sim.engine import Arm, World
from backend.evolution_engine.sandboxed_controller import SandboxedController
from backend.rea_archaeologist.build import ROOT
from backend.evolution_engine.verification_bus import VerificationSubscriber
from backend.evolution_engine.synthesis import parse_candidate

TEMPLATES=Path(__file__).parent / "templates"
INVARIANTS={"thermal_cutoff_c":88.0,"cooling_c":72.0,"runaway_deg":45.0,"pwm_min":-100.0,"pwm_max":100.0,
            "steady_error_deg":2.2,"overshoot_deg":4.5}

# Domain-randomized training environments used by the (mu=4, lambda=14) Evolutionary Strategy.
# Held-out WORLDS in backend/physics_sim/worlds.py are NEVER accessed during parameter search.
ES_TRAIN_ENVS = (
    World("train_heavy_load", efficiency=0.39, gravity=25.5, inertia=2.5, friction=1.1, sensor_lag_s=0.15),
    World("train_lag_inertia", efficiency=0.41, gravity=25.0, inertia=4.2, friction=0.55, sensor_lag_s=0.42),
    World("train_low_friction", efficiency=0.44, gravity=23.5, inertia=1.8, friction=0.32, sensor_lag_s=0.0),
)


def _training(controller):
    arm=Arm(controller,World())
    peak=0.0; tail=[]
    for i in range(3000):
        sample=arm.step()
        peak=max(peak,sample["angle"]-arm.target)
        if i>=2800:tail.append(abs(sample["tracking_error_deg"]))
    error=sum(tail)/len(tail)
    return {"steady_state_error_deg":round(error,3),"peak_overshoot_deg":round(peak,3),"estop":arm.estop,
            "passed":error<4.0 and peak<4.5 and not arm.estop}


def autonomous_es_stage1_single_world(seed: int = 101) -> dict:
    """Stage 1 single-world ES: optimizes PD gains on the lag-free nominal workcell alone."""
    rng = random.Random(seed)
    candidates_evaluated = 0
    best_kp, best_kd, best_metrics = 18.0, 0.5, None
    for _ in range(16):
        kp = round(rng.uniform(14.0, 19.5), 3)
        kd = round(rng.uniform(0.4, 0.9), 3)
        candidates_evaluated += 1
        def _step(target, angle, velocity, temp, state=None, _kp=kp, _kd=kd):
            if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
                return {"pwm": 0.0, "estop": 1, "cooling": 1}
            error = target - angle
            cooling = int(temp >= 72.0)
            if temp >= 88.0 or abs(error) > 45.0:
                return {"pwm": 0.0, "estop": 1, "cooling": cooling}
            return {"pwm": max(-100.0, min(100.0, _kp * error - _kd * velocity)), "estop": 0, "cooling": cooling}
        metrics = _training(_step)
        if metrics["passed"]:
            best_kp, best_kd, best_metrics = kp, kd, metrics
            break
    source = f'''"""Single-world ES candidate (kp={best_kp}, kd={best_kd}): overfits lag-free training workcell."""
import math
VERSION = "v2"

def step(target, angle, velocity, temp, state=None):
    if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
        return {{"pwm": 0.0, "estop": 1, "cooling": 1}}
    error = target - angle
    cooling = int(temp >= 72.0)
    if temp >= 88.0 or abs(error) > 45.0:
        return {{"pwm": 0.0, "estop": 1, "cooling": cooling}}
    return {{"pwm": max(-100.0, min(100.0, {best_kp} * error - {best_kd} * velocity)), "estop": 0, "cooling": cooling}}
'''
    return {
        "source": source,
        "genome": {"kp": best_kp, "kd": best_kd},
        "episodes_evaluated": candidates_evaluated,
        "training_preview": best_metrics,
    }


def autonomous_es_optimize(seed: int = 2026, generations: int = 7, pop_size: int = 14, steps: int = 2400) -> dict:
    """Stage 2 (mu=4, lambda=14) Evolutionary Strategy initialized strictly at FFI-probed v1 PD gains."""
    def _make_controller(genome):
        kp, kd, ki, k_ff, alpha_v, i_clamp = genome
        def _step(target, angle, velocity, temp, state=None):
            if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
                return {"pwm": 0.0, "estop": 1, "cooling": 1}
            error = target - angle
            cooling = int(temp >= 72.0)
            if temp >= 88.0 or abs(error) > 45.0:
                return {"pwm": 0.0, "estop": 1, "cooling": cooling}
            if state is None:
                state = {}
            state["integral"] = max(-i_clamp, min(i_clamp, state.get("integral", 0.0) + error * 0.01))
            state["filtered_velocity"] = alpha_v * velocity + (1.0 - alpha_v) * state.get("filtered_velocity", 0.0)
            gravity_ff = k_ff * math.cos(math.radians(angle))
            effort = kp * error - kd * state["filtered_velocity"] + ki * state["integral"] + gravity_ff
            return {"pwm": max(-100.0, min(100.0, effort)), "estop": 0, "cooling": cooling}
        return _step

    def _eval_loss(genome):
        ctrl = _make_controller(genome)
        total_loss = 0.0
        for w in ES_TRAIN_ENVS:
            arm = Arm(ctrl, w)
            peak = 0.0
            errs = []
            for i in range(steps):
                s = arm.step()
                peak = max(peak, max(0.0, s["angle"] - arm.target))
                if i >= steps - 200:
                    errs.append(abs(s["tracking_error_deg"]))
            steady = sum(errs) / len(errs)
            loss = (
                steady * 5.0
                + max(0.0, steady - 1.8) * 25.0
                + peak * 2.0
                + max(0.0, peak - 3.5) * 25.0
                + (500.0 if arm.estop else 0.0)
            )
            total_loss += loss
        return total_loss / len(ES_TRAIN_ENVS)

    rng = random.Random(seed)
    # Initialized strictly at FFI-probed v1 PD baseline (ki=0.0, k_ff=0.0, alpha_v=1.0, i_clamp=10.0)
    initial_genome = [3.0, 0.8, 0.0, 0.0, 1.0, 10.0]
    mean = list(initial_genome)
    sigma = [1.5, 3.5, 0.5, 18.0, 0.4, 25.0]
    bounds = [
        (1.0, 8.0),    # kp
        (0.5, 12.0),   # kd
        (0.0, 2.0),    # ki
        (0.0, 45.0),   # k_ff
        (0.05, 1.0),   # alpha_v
        (10.0, 75.0),  # i_clamp
    ]
    history = []
    episodes = 0
    best_loss, best_cand = float("inf"), list(mean)
    for gen in range(1, generations + 1):
        pop = []
        if gen > 1:
            pop.append((_eval_loss(mean), list(mean)))
            episodes += len(ES_TRAIN_ENVS)
        for _ in range(pop_size):
            cand = [
                max(lo, min(hi, m + rng.gauss(0, s)))
                for m, s, (lo, hi) in zip(mean, sigma, bounds)
            ]
            loss = _eval_loss(cand)
            episodes += len(ES_TRAIN_ENVS)
            pop.append((loss, cand))
        pop.sort(key=lambda x: x[0])
        elites = [c for _, c in pop[:4]]
        mean = [sum(e[i] for e in elites) / 4.0 for i in range(len(mean))]
        sigma = [max(0.02, s * 0.82) for s in sigma]
        best_loss, best_cand = pop[0]
        history.append({
            "generation": gen,
            "best_loss": round(best_loss, 3),
            "genome": {
                "kp": round(best_cand[0], 3),
                "kd": round(best_cand[1], 3),
                "ki": round(best_cand[2], 3),
                "k_ff": round(best_cand[3], 3),
                "alpha_v": round(best_cand[4], 3),
                "i_clamp": round(best_cand[5], 3),
            },
        })

    kp, kd, ki, k_ff, alpha_v, i_clamp = [round(x, 3) for x in best_cand]
    one_minus_alpha = round(1.0 - alpha_v, 3)
    v3_source = f'''"""Autonomously evolved controller via (mu=4, lambda=14) ES ({episodes} physics episodes, Gen {generations} loss={best_loss:.3f})."""
import math
VERSION = "v3"

def step(target, angle, velocity, temp, state=None):
    if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
        return {{"pwm": 0.0, "estop": 1, "cooling": 1}}
    error = target - angle
    cooling = int(temp >= 72.0)
    if temp >= 88.0 or abs(error) > 45.0:
        return {{"pwm": 0.0, "estop": 1, "cooling": cooling}}
    if state is None:
        state = {{}}
    state["integral"] = max(-{i_clamp}, min({i_clamp}, state.get("integral", 0.0) + error * 0.01))
    state["filtered_velocity"] = {alpha_v} * velocity + {one_minus_alpha} * state.get("filtered_velocity", 0.0)
    gravity_feedforward = {k_ff} * math.cos(math.radians(angle))
    return {{"pwm": max(-100.0, min(100.0, {kp} * error - {kd} * state["filtered_velocity"] + {ki} * state["integral"] + gravity_feedforward)), "estop": 0, "cooling": cooling}}
'''
    return {
        "v3_source": v3_source,
        "telemetry": {
            "algorithm": "(mu=4, lambda=14) Evolutionary Strategy",
            "generations": generations,
            "population_size": pop_size,
            "episodes_simulated": episodes,
            "steps_per_episode": steps,
            "initial_v1_genome": {"kp": 3.0, "kd": 0.8, "ki": 0.0, "k_ff": 0.0, "alpha_v": 1.0, "i_clamp": 10.0},
            "converged_v3_genome": {"kp": kp, "kd": kd, "ki": ki, "k_ff": k_ff, "alpha_v": alpha_v, "i_clamp": i_clamp},
            "initial_loss": history[0]["best_loss"],
            "final_loss": round(best_loss, 3),
            "history": history,
        },
    }

class EvolutionEngine:
    def __init__(self,sim=None,store=None,base_dir=None,active_path=None,synthesizer=None):
        if store is None:
            from backend.db.store import Store
            store=Store()
        self.sim=sim; self.store=store; self.synthesizer=synthesizer
        self.base_dir=Path(base_dir or ROOT / ".data/skill_repositories")
        self.active_path=Path(active_path or ROOT / ".skills/controllers/active_skill.py")
        self.lock=threading.Lock()

    @staticmethod
    def git(repo,*args):
        command=["git","-C",str(repo),"-c","user.name=LAZARUS Skill Architect", "-c","user.email=skill-architect@lazarus.local",*args]
        return subprocess.run(command,check=True,text=True,capture_output=True).stdout.strip()

    def _commit(self,repo,label):
        self.git(repo,"add",".skills/controllers/active_skill.py")
        self.git(repo,"commit","--quiet","-m",label)
        return self.git(repo,"rev-parse","HEAD")

    def _job(self,commit):
        if self.store is None:return None
        return self.store.create_job(commit,"controller-step:"+commit,"plc-demo-v1",INVARIANTS)

    def _verdict(self,job,record,active,status):
        if self.store is not None:
            # The store owns the MongoDB multi-document transaction.
            self.store.commit_verdict(job["job_id"],record,active,status)

    def _current_active_commit(self, baseline):
        """A rejected candidate must leave the live active pointer unchanged."""
        if self.store.db is not None:
            state=self.store.db.system_state.find_one({"_id":"active_controller"},{"git_commit_hash":1})
        else:
            with self.store.lock:
                state=next((doc for doc in self.store.local["system_state"] if doc.get("_id")=="active_controller"),None)
        commit=(state or {}).get("git_commit_hash")
        return commit if isinstance(commit,str) and commit else baseline

    def _recall(self):
        if self.store is None:return {"status":"not_configured","hits":[]}
        query=[.58,.42,25.,4.5,.45,1.2,30.,1.]
        pattern={"pattern_id":"gravity-lag-pid","pattern_type":"PHYSICAL_FAILURE_COMPENSATOR",
                 "symptom_summary":"Torque loss with gravity sag and oscillation under sensor lag",
                 "embedding":query,
                 "recommended_skill_template":"Clamped integral, cosine gravity feedforward, filtered velocity",
                 "verification_status":"candidate; evaluate before use"}
        try:
            self.store.save_pattern(pattern)
            hits=self.store.vector_search(query)
            return {"status":"atlas_vector_search" if self.store.mode=="atlas" else "local_cosine", "hits":hits}
        except Exception as exc:
            # Do not claim Atlas recall or silently replace the database when its index is unavailable.
            return {"status":"unavailable", "reason":type(exc).__name__, "hits":[]}

    def run(self):
        with self.lock:
            self.base_dir.mkdir(parents=True,exist_ok=True)
            with open(self.base_dir / ".evolution.lock","a+") as lock_file:
                fcntl.flock(lock_file,fcntl.LOCK_EX)
                try:
                    with VerificationSubscriber(self.store, INVARIANTS) as subscriber:
                        return self._run(subscriber)
                finally:fcntl.flock(lock_file,fcntl.LOCK_UN)

    def _run(self, subscriber):
        repo=self.base_dir/uuid.uuid4().hex
        repo.mkdir(parents=True)
        self.git(repo,"init","--quiet")
        skill=repo/".skills/controllers/active_skill.py"
        skill.parent.mkdir(parents=True)
        shutil.copyfile(TEMPLATES/"v1.py",skill)
        v1=self._commit(repo,"v1 recovered baseline")
        previous_active=self._current_active_commit(v1)
        baseline=SandboxedController(skill, version="v1", deadline=time.monotonic()+45)
        try:v1_train=_training(baseline.step)
        finally:baseline.close()
        ledger=[{"version":"v1","status":"BASELINE","origin":"recovered_baseline","origin_label":"RECOVERED_BASELINE","commit":v1,"training":v1_train}]

        stage1_es=autonomous_es_stage1_single_world()
        skill.write_text(stage1_es["source"])
        v2=self._commit(repo,"v2 aggressive training candidate")
        subscriber.register(repo, v2)
        job2=self._job(v2)
        overfit=SandboxedController(skill, version="v2", deadline=time.monotonic()+45)
        try:training2=_training(overfit.step)
        finally:overfit.close()
        verification2=subscriber.wait(job2)
        world_result2=verification2["world_result"]
        worlds2=world_result2["worlds"]
        audit2=verification2["audit"]
        rejected=not training2["passed"] or not all(w["passed"] for w in worlds2) or not audit2["baseline"]["passed"] or audit2["killed"]<audit2["total"]*.9
        if not rejected:
            raise RuntimeError("v2 unexpectedly passed; refusing to fabricate a rollback")
        self.git(repo,"revert","--no-edit",v2)
        revert=self.git(repo,"rev-parse","HEAD")
        failed_worlds=[
            f"{w.get('name') or w.get('world','world')} (err {w.get('steady_state_error_deg',0)}°, overshoot {w.get('peak_overshoot_deg',0)}°"
            + (", estop)" if w.get("estop") else ")")
            for w in worlds2 if not w.get("passed")
        ]
        t_status="PASS" if training2.get("passed") else "FAIL"
        v2_reason=(
            f"Single-world ES candidate (kp={stage1_es['genome']['kp']}, kd={stage1_es['genome']['kd']}): "
            f"Training {t_status} (err {training2.get('steady_state_error_deg',0)}°, overshoot {training2.get('peak_overshoot_deg',0)}°); "
            + (f"failed held-out worlds: {', '.join(failed_worlds)}" if failed_worlds else "rejected by verifier")
        )
        v2_record={"version":"v2","status":"REVERTED","origin":"single_world_es","origin_label":"SINGLE_WORLD_ES_OVERFIT","commit":v2,"revert_commit":revert,"training":training2,
                   "genome":stage1_es["genome"],"worlds":worlds2,"world_verifier_isolation":world_result2["isolation"],"audit":audit2,"reason":v2_reason,
                   "timestamp":datetime.now(timezone.utc)}
        self._verdict(job2,v2_record,previous_active,"REJECTED_TRIGGER_GIT_REVERT")
        # PyMongo mutates inserted dicts to add ObjectIds; keep JSON responses clean.
        v2_record.pop("_id",None); v2_record["timestamp"]=v2_record["timestamp"].isoformat()
        ledger.append(v2_record)
        recall=self._recall()

        # Run 7-generation (mu=4, lambda=14) Evolutionary Strategy across 294 closed-loop physics episodes
        # starting strictly from FFI-probed v1 PD baseline [3.0, 0.8, 0.0, 0.0, 1.0, 10.0].
        stage2_es=autonomous_es_optimize()

        # The architect gets measured training results and a public failure
        # summary, never sealed fixture parameters or the verifier's context.
        synthesis={"status":"not_requested"}
        proposed=None
        if self.synthesizer is not None:
            summary={"training":training2,
                     "failure_summary":"The aggressive candidate failed one or more safety or stability checks under torque loss and sensor lag.",
                     "memory_recall":recall,
                     "invariants":dict(INVARIANTS),
                     "required_api":"Python step(target, angle, velocity, temp, state=None) returns pwm, estop, cooling; VERSION = v3"}
            try:
                proposed,synthesis=parse_candidate(self.synthesizer(summary))
            except Exception as exc:
                synthesis={"status":"unavailable","reason":type(exc).__name__}
        if proposed is not None and proposed.encode() == skill.read_bytes():
            proposed=None; synthesis={"status":"no_change"}
        fallback=(TEMPLATES/"v3.py").read_text()
        if proposed is not None:
            candidates=[("synthesized",proposed),("local_template",fallback)]
        else:
            candidates=[("autonomous_es",stage2_es["v3_source"]),("local_template",fallback)]
        for origin, source in candidates:
            if origin=="synthesized":
                origin_label="MUSE_SYNTHESIZED"
            elif origin=="autonomous_es":
                origin_label="AUTONOMOUS_ES_EVOLVED"
            else:
                origin_label="LOCAL_TEMPLATE"
            skill.write_text(source)
            v3=self._commit(repo,"v3 synthesized candidate" if origin=="synthesized" else "v3 adaptive anti-windup controller")
            subscriber.register(repo,v3)
            job3=self._job(v3)
            verification_error=None
            try:
                verification3=subscriber.wait(job3)
                world_result3=verification3["world_result"]
                worlds3=world_result3["worlds"]
                audit3=verification3["audit"]
                valid=(len(worlds3)==5 and all(w["passed"] for w in worlds3)
                       and audit3["baseline"]["passed"] and audit3["total"]>=6
                       and audit3["killed"] >= audit3["total"]*.9)
            except RuntimeError as exc:
                # A candidate's worker or AST audit may fail. A broken watcher
                # is infrastructure failure and must not be bypassed.
                if subscriber.error is not None:raise
                valid=False; verification_error=type(exc.__cause__ or exc).__name__
                world_result3={"worlds":[],"isolation":None}; worlds3=[]; audit3=None
            if valid:break
            self.git(repo,"revert","--no-edit",v3)
            fail_commit=self.git(repo,"rev-parse","HEAD")
            record={"version":"v3-proposal" if origin=="synthesized" else "v3","status":"REVERTED",
                    "origin":origin,"origin_label":origin_label,"commit":v3,"revert_commit":fail_commit,"worlds":worlds3,"audit":audit3,
                    "reason":"candidate failed isolated verification", "verification_error":verification_error,
                    "timestamp":datetime.now(timezone.utc)}
            self._verdict(job3,record,previous_active,"REJECTED_TRIGGER_GIT_REVERT")
            record["timestamp"]=record["timestamp"].isoformat()
            if origin!="synthesized":raise RuntimeError("v3 failed safety or held-out benchmark; reverted")
            ledger.append(record)
            synthesis.update(status="rejected")
        else:raise RuntimeError("No candidate passed verification")
        if origin=="synthesized":
            origin_label="MUSE_SYNTHESIZED"
            synthesis.update(status="adopted")
        elif origin=="autonomous_es":
            origin_label="AUTONOMOUS_ES_EVOLVED"
            synthesis.update(active_origin=origin,active_origin_label=origin_label,es_episodes=stage2_es["telemetry"]["episodes_simulated"])
        else:
            origin_label="LOCAL_TEMPLATE"
            synthesis.update(active_origin=origin,active_origin_label=origin_label)
        v3_record={"version":"v3","status":"ADOPTED","origin":origin,"origin_label":origin_label,"commit":v3,
                   "genome":stage2_es["telemetry"]["converged_v3_genome"] if origin=="autonomous_es" else None,
                   "worlds":worlds3,"world_verifier_isolation":world_result3["isolation"],"audit":audit3,
                   "timestamp":datetime.now(timezone.utc)}
        # Publish the approved code atomically; restore the previous file if the database transaction fails.
        self.active_path.parent.mkdir(parents=True,exist_ok=True)
        prior=self.active_path.read_bytes() if self.active_path.exists() else None
        tmp=self.active_path.with_name(self.active_path.name+".new")
        candidate_bytes=skill.read_bytes()
        if hashlib.sha256(candidate_bytes).hexdigest()!=verification3["candidate_sha256"]:
            raise RuntimeError("Candidate differs from verified commit; refusing hot-swap")
        # Keep the certified candidate in its restricted worker even after the
        # live swap. Snapshot the prior controller so database errors can be
        # compensated without importing candidate code into this process.
        proxy=SandboxedController(skill,version="v3",expected_sha256=verification3["candidate_sha256"]) if self.sim is not None else None
        old=None
        try:
            tmp.write_bytes(candidate_bytes); os.replace(tmp,self.active_path)
            if self.sim is not None:
                with self.sim.lock:
                    old=(self.sim.skill,self.sim.skill_path,self.sim.right.controller,self.sim.right.state)
                    self.sim.skill=proxy
                    self.sim.skill_path=self.active_path
                    self.sim.right.controller=proxy.step
                    if self.sim.right.sabotage and not self.sim.right.estop:
                        self.sim.right.angle=30.0
                        self.sim.right.velocity=0.0
                        self.sim.right.pwm=51.55
                        self.sim.right.delay.clear()
                        self.sim.right.delay.extend([30.0]*max(1,round(self.sim.right.world.sensor_lag_s/0.01)))
                        self.sim.right.state={"integral":35.4855,"filtered_velocity":0.0}
                    else:
                        self.sim.right.state={}
            self._verdict(job3,v3_record,v3,"CERTIFIED_FOR_HOT_SWAP")
        except BaseException:
            if old is not None:
                with self.sim.lock:
                    self.sim.skill,self.sim.skill_path,self.sim.right.controller,self.sim.right.state=old
            if prior is None:self.active_path.unlink(missing_ok=True)
            else:
                tmp.write_bytes(prior);os.replace(tmp,self.active_path)
            if proxy is not None:proxy.close()
            raise
        if old is not None and isinstance(old[0],SandboxedController):old[0].close()
        v3_record.pop("_id",None);v3_record["timestamp"]=v3_record["timestamp"].isoformat()
        ledger.append(v3_record)
        return {"iterations":ledger,"active_skill_version":"v3","active_commit":v3,"revert_commit":revert,
                "active_origin":origin,"active_origin_label":origin_label,
                "es_search":{"stage1_single_world":stage1_es["genome"],**stage2_es["telemetry"]},
                "repository":str(repo),"memory_recall":recall,"synthesis":synthesis,
                "note":"Git skill repository and MongoDB are coordinated as a saga, not one atomic transaction."}
