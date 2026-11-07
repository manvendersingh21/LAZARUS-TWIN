"""Sandbox candidate Python before compiling or executing any candidate code.

Landlock denies filesystem access and seccomp denies networking, process spawning,
introspection and filesystem metadata changes. The worker preloads math/json and
socket; future candidate imports must use modules already loaded into Python.
This Linux sandbox is a demo boundary, not a secure multi-tenant runtime.
"""
import ctypes
import ctypes.util
import errno
import hashlib
import json
import math
import os
import resource
from pathlib import Path
import socket
import sys

# Import the shared isolation code before the filesystem is denied.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.verifier_agent.isolate import restrict


def load_candidate(path, expected_sha256=None):
    # The candidate is read as inert bytes; no module code runs until after the
    # filesystem and syscall restrictions have been installed.
    source = Path(path).read_bytes()
    if expected_sha256 is not None and hashlib.sha256(source).hexdigest() != expected_sha256:
        raise RuntimeError('candidate does not match expected digest')
    # Bound candidate memory, CPU time and core files before running its code.
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    secname = ctypes.util.find_library('seccomp')
    if not secname:
        raise RuntimeError('libseccomp is required')
    ctypes.CDLL(secname)
    ctypes.util.find_library = lambda name: 'libseccomp.so.2' if name == 'seccomp' else None
    abi = restrict()
    sec = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    sec.seccomp_init.argtypes = [ctypes.c_uint32]
    sec.seccomp_init.restype = ctypes.c_void_p
    sec.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    sec.seccomp_syscall_resolve_name.restype = ctypes.c_int
    sec.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    sec.seccomp_load.argtypes = [ctypes.c_void_p]
    sec.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = sec.seccomp_init(0x7fff0000)
    if not ctx:
        raise RuntimeError('seccomp_init failed')
    try:
        for name in ('fork', 'vfork', 'clone', 'clone3', 'kill', 'tkill', 'tgkill',
                     'chmod', 'fchmod', 'fchmodat', 'fchmodat2', 'chown', 'fchown',
                     'fchownat', 'lchown', 'utime', 'utimes', 'utimensat', 'futimesat',
                     'pidfd_open', 'pidfd_send_signal', 'kcmp', 'setrlimit', 'prlimit64', 'shmget', 'shmat',
                     'shmctl', 'semget', 'semop', 'semctl', 'msgget', 'msgsnd', 'msgrcv',
                     'msgctl'):
            number = sec.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and sec.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError('seccomp rule failed: ' + name)
        if sec.seccomp_load(ctx) != 0:
            raise RuntimeError('seccomp_load failed')
    finally:
        sec.seccomp_release(ctx)
    namespace = {'__name__': 'candidate', '__file__': str(path)}
    exec(compile(source, str(path), 'exec'), namespace)
    step = namespace.get('step')
    if not callable(step):
        raise ValueError('candidate has no callable step')
    return step, abi
