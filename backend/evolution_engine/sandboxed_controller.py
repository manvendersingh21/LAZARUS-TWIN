"""A stateful black-box controller running in a restricted worker process."""
import json
import os
import select
import subprocess
import sys
import threading
import time
from backend.rea_archaeologist.build import ROOT


class SandboxedController:
    def __init__(self, path, version='candidate', timeout=3.0, deadline=None, expected_sha256=None):
        self.VERSION = version
        self.timeout = timeout
        self.deadline = deadline
        self.lock = threading.RLock()
        self.last_state = None
        self.buffer = bytearray()
        self.process = subprocess.Popen(
            [sys.executable, str(ROOT / 'backend/evolution_engine/controller_worker.py'), str(path)] + ([expected_sha256] if expected_sha256 else []),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0,
            env={'PATH': os.environ.get('PATH', ''), 'LANG': 'C.UTF-8'}, close_fds=True,
        )
        try:
            if self._request({'op': 'reset'}) != {'ok': True}:
                raise RuntimeError('candidate worker failed its startup handshake')
        except BaseException:
            self.close()
            raise

    def _request(self, data):
        expires = time.monotonic() + self.timeout
        if self.deadline is not None:
            expires = min(expires, self.deadline)
        payload = (json.dumps(data, allow_nan=True) + '\n').encode()
        try:
            os.write(self.process.stdin.fileno(), payload)
        except BrokenPipeError as exc:
            raise RuntimeError('candidate worker exited') from exc
        while b'\n' not in self.buffer:
            remaining = expires - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('candidate worker response timed out')
            readable, _, _ = select.select([self.process.stdout], [], [], remaining)
            if not readable:
                raise TimeoutError('candidate worker response timed out')
            chunk = os.read(self.process.stdout.fileno(), 8192)
            if not chunk:
                raise RuntimeError('candidate worker exited')
            self.buffer.extend(chunk)
            if len(self.buffer) > 1_048_576:
                raise RuntimeError('candidate worker response exceeded limit')
        line, _, rest = self.buffer.partition(b'\n')
        self.buffer = bytearray(rest)
        result = json.loads(line)
        if not isinstance(result, dict) or 'error' in result:
            raise RuntimeError('candidate worker rejected request')
        return result

    def step(self, target, angle, velocity, temp, state=None):
        with self.lock:
            if self.last_state is not state:
                self._request({'op': 'reset'})
                self.last_state = state
            return self._request({'op':'step', 'inputs':[target, angle, velocity, temp]})

    def close(self):
        with self.lock:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()
