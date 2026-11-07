"""Verification subscriber consuming the MongoDB job bus.

The subscriber gets references and public invariants from the bus; only the
trusted execution layer maps a registered commit to a controller handle.
Individual black-box verifiers execute with separate OS restrictions.  This
module is a coordinator, not itself an information-theoretic airgap.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

from backend.physics_sim.worlds import evaluate_isolated
from backend.verifier_agent.mutation import audit


class VerificationSubscriber:
    """Watch insertions and evaluate only explicitly registered commit handles."""

    def __init__(self, store, invariants):
        self.store = store
        self.invariants = dict(invariants)
        self.stop_event = threading.Event()
        self.ready = threading.Event()
        self.condition = threading.Condition()
        self.handles = {}
        self.results = {}
        self.error = None
        self.tmpdir = None
        self.thread = None

    def __enter__(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="lazarus-verify-handles-")
        self.thread = threading.Thread(target=self._watch, name="verification-bus", daemon=True)
        self.thread.start()
        if not self.ready.wait(15):
            self.close()
            raise RuntimeError("Verification bus did not become ready")
        if self.error:
            error = self.error
            self.close()
            raise RuntimeError("Verification bus could not start") from error
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=65)
            if self.thread.is_alive():
                # Do not remove an executable handle while its worker is using it.
                raise RuntimeError("Verification bus did not stop")
        if self.tmpdir:
            self.tmpdir.cleanup()
            self.tmpdir = None

    def register(self, repo, commit):
        """Resolve a known commit to an immutable private local worker artifact."""
        if not self.tmpdir or self.stop_event.is_set():
            raise RuntimeError("Verification bus is not running")
        # Never accept a source path from the job itself. Read the object from
        # the skill repository at registration, before exposing its identifier.
        result = subprocess.run(
            ["git", "-C", str(repo), "show", f"{commit}:.skills/controllers/active_skill.py"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        content = result.stdout
        if not content:
            raise ValueError("Empty committed controller")
        digest = hashlib.sha256(content).hexdigest()
        artifact = Path(self.tmpdir.name) / f"{digest}.py"
        artifact.write_bytes(content)
        entrypoint = "controller-step:" + commit
        with self.condition:
            self.handles[entrypoint] = (commit, artifact, digest)
        return entrypoint

    def wait(self, job, timeout=120):
        """Wait only for the exact inserted job's verdict; do not poll MongoDB."""
        deadline = time.monotonic() + timeout
        with self.condition:
            while job["job_id"] not in self.results:
                if self.error:
                    raise RuntimeError("Verification subscriber failed") from self.error
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Verification job was not delivered")
                self.condition.wait(remaining)
            result = self.results.pop(job["job_id"])
        if isinstance(result, Exception):
            raise RuntimeError("Verification failed; candidate not certified") from result
        return result

    def _dispatch(self, job):
        entrypoint = job.get("blackbox_entrypoint_id")
        with self.condition:
            handle = self.handles.get(entrypoint)
        if handle is None:
            # Other deployments may share the same collection. They are not
            # allowed to make this process execute arbitrary filesystem paths.
            return
        commit, artifact, digest = handle
        job_id = job.get("job_id")
        try:
            if not isinstance(job_id, str) or not job_id:
                raise ValueError("Missing job ID")
            if job.get("git_commit_hash") != commit or job.get("plc_topology_id") != "plc-demo-v1":
                raise ValueError("Verification job does not match registered handle")
            if job.get("status") != "PENDING" or job.get("safety_invariants_spec") != self.invariants:
                raise ValueError("Verification job has invalid invariants or status")
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != digest:
                raise RuntimeError("Committed controller artifact changed")
            worlds = evaluate_isolated(artifact)
            mutation = audit(artifact)
            if mutation.get("candidate_sha256") != digest or hashlib.sha256(artifact.read_bytes()).hexdigest() != digest:
                raise RuntimeError("Verified controller artifact changed")
            result = {"world_result": worlds, "audit": mutation, "candidate_sha256": digest}
        except Exception as exc:
            result = exc
        with self.condition:
            self.results[job_id] = result
            self.condition.notify_all()

    def _watch(self):
        events = None
        try:
            if self.store.db is None:
                events = queue.Queue()
                with self.store.lock:
                    self.store._subscribers.append(events)
                self.ready.set()
                while not self.stop_event.is_set():
                    try:
                        job = events.get(timeout=0.5)
                    except queue.Empty:
                        continue
                    with self.store.lock:
                        self.store.counters["change_events"] += 1
                    self._dispatch(job)
            else:
                collection = self.store.db.airgapped_verification_bus
                with collection.watch([{"$match": {"operationType": "insert"}}],
                                      full_document="updateLookup", max_await_time_ms=1000) as stream:
                    # collection.watch establishes the stream before returning,
                    # closing the otherwise easy-to-miss insert/subscribe race.
                    self.ready.set()
                    while not self.stop_event.is_set():
                        change = stream.try_next()
                        if change:
                            with self.store.lock:
                                self.store.counters["change_events"] += 1
                            self._dispatch(change["fullDocument"])
        except Exception as exc:
            with self.condition:
                self.error = exc
                self.condition.notify_all()
            self.ready.set()
        finally:
            if events is not None:
                with self.store.lock:
                    if events in self.store._subscribers:
                        self.store._subscribers.remove(events)
