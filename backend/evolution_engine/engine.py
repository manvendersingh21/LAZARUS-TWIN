"""Real Git skill evolution, with fail-closed benchmark and mutation gates.

Git and the database are separate systems; promotion is a compensating saga,
not a cross-system atomic transaction. Git operations occur in an isolated
skill repository, never by resetting or reverting the user's main worktree.
"""
from datetime import datetime, timezone
import fcntl
import hashlib
import os
from pathlib import Path
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
        ledger=[{"version":"v1","status":"BASELINE","commit":v1,"training":v1_train}]

        shutil.copyfile(TEMPLATES/"v2.py",skill)
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
        v2_record={"version":"v2","status":"REVERTED","commit":v2,"revert_commit":revert,"training":training2,
                   "worlds":worlds2,"world_verifier_isolation":world_result2["isolation"],"audit":audit2,"reason":"held-out benchmark or verifier rejected candidate",
                   "timestamp":datetime.now(timezone.utc)}
        self._verdict(job2,v2_record,previous_active,"REJECTED_TRIGGER_GIT_REVERT")
        # PyMongo mutates inserted dicts to add ObjectIds; keep JSON responses clean.
        v2_record.pop("_id",None); v2_record["timestamp"]=v2_record["timestamp"].isoformat()
        ledger.append(v2_record)
        recall=self._recall()

        # The architect gets measured training results and a public failure
        # summary, never sealed fixture parameters or the verifier's context.
        synthesis={"status":"not_requested"}
        proposed=None
        if self.synthesizer is not None:
            summary={"training":training2,
                     "failure_summary":"The aggressive candidate failed one or more safety or stability checks under torque loss and sensor lag.",
                     "invariants":dict(INVARIANTS),
                     "required_api":"Python step(target, angle, velocity, temp, state=None) returns pwm, estop, cooling; VERSION = v3"}
            try:
                proposed,synthesis=parse_candidate(self.synthesizer(summary))
            except Exception as exc:
                synthesis={"status":"unavailable","reason":type(exc).__name__}
        if proposed is not None and proposed.encode() == skill.read_bytes():
            proposed=None; synthesis={"status":"no_change"}
        fallback=(TEMPLATES/"v3.py").read_text()
        candidates=[("synthesized",proposed),("local_template",fallback)] if proposed is not None else [("local_template",fallback)]
        for origin, source in candidates:
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
                    "origin":origin,"commit":v3,"revert_commit":fail_commit,"worlds":worlds3,"audit":audit3,
                    "reason":"candidate failed isolated verification", "verification_error":verification_error,
                    "timestamp":datetime.now(timezone.utc)}
            self._verdict(job3,record,previous_active,"REJECTED_TRIGGER_GIT_REVERT")
            record["timestamp"]=record["timestamp"].isoformat()
            if origin!="synthesized":raise RuntimeError("v3 failed safety or held-out benchmark; reverted")
            ledger.append(record)
            synthesis.update(status="rejected")
        else:raise RuntimeError("No candidate passed verification")
        if origin=="synthesized":synthesis.update(status="adopted")
        v3_record={"version":"v3","status":"ADOPTED","origin":origin,"commit":v3,"worlds":worlds3,"world_verifier_isolation":world_result3["isolation"],"audit":audit3,
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
                "repository":str(repo),"memory_recall":recall,"synthesis":synthesis,
                "note":"Git skill repository and MongoDB are coordinated as a saga, not one atomic transaction."}
