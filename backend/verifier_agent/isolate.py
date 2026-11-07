"""Run black-box verification without filesystem or network access (Linux only)."""
import ctypes
import ctypes.util
import errno
import json
import os
import sys
from backend.verifier_agent.verifier import verify


def restrict():
    libc = ctypes.CDLL(None, use_errno=True)
    # Landlock ABI 3+ supports all rights through TRUNCATE (bit 14).
    abi = libc.syscall(444, 0, 0, 1)
    if abi < 3: raise RuntimeError("Landlock ABI 3 or later required")
    class Ruleset(ctypes.Structure):
        _fields_ = [("handled_access_fs", ctypes.c_uint64)]
    rules = Ruleset((1 << 15) - 1)
    fd = libc.syscall(444, ctypes.byref(rules), ctypes.sizeof(rules), 0)
    if fd < 0: raise OSError(ctypes.get_errno(), "landlock_create_ruleset")
    if libc.prctl(38, 1, 0, 0, 0) != 0: raise OSError(ctypes.get_errno(), "PR_SET_NO_NEW_PRIVS")
    if libc.syscall(446, fd, 0) != 0: raise OSError(ctypes.get_errno(), "landlock_restrict_self")
    os.close(fd)
    # Block network and process-introspection syscalls. All rules fail closed.
    secname=ctypes.util.find_library("seccomp")
    if not secname: raise RuntimeError("libseccomp is required")
    sec=ctypes.CDLL(secname, use_errno=True)
    sec.seccomp_init.argtypes=[ctypes.c_uint32]; sec.seccomp_init.restype=ctypes.c_void_p
    sec.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]; sec.seccomp_syscall_resolve_name.restype=ctypes.c_int
    sec.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint]
    sec.seccomp_load.argtypes=[ctypes.c_void_p]; sec.seccomp_release.argtypes=[ctypes.c_void_p]
    ctx=sec.seccomp_init(0x7fff0000)
    if not ctx: raise RuntimeError("seccomp_init failed")
    try:
        for name in ("socket", "socketpair", "connect", "accept", "accept4", "bind", "listen", "ptrace", "process_vm_readv", "process_vm_writev", "pidfd_getfd", "bpf", "perf_event_open", "io_uring_setup", "open_by_handle_at", "mount", "unshare", "execve", "execveat"):
            nr=sec.seccomp_syscall_resolve_name(name.encode())
            if nr >= 0 and sec.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, nr, 0) != 0:
                raise RuntimeError("seccomp rule failed: " + name)
        if sec.seccomp_load(ctx) != 0: raise RuntimeError("seccomp_load failed")
    finally: sec.seccomp_release(ctx)
    try:
        with open("/etc/passwd", "rb"): pass
    except PermissionError: pass
    else: raise RuntimeError("filesystem isolation self-test failed")
    return abi

class Handle:
    def __init__(self, input_fd, output_fd):
        self.infile=os.fdopen(input_fd,"w",buffering=1)
        self.outfile=os.fdopen(output_fd,"r")
    def step(self,*args):
        self.infile.write(json.dumps(args)+"\n")
        response=self.outfile.readline()
        if not response: raise RuntimeError("controller worker exited")
        return json.loads(response)

if __name__ == "__main__":
    # Load libseccomp before restricting filesystem access; no candidate path is passed.
    name=ctypes.util.find_library("seccomp")
    if not name: raise RuntimeError("libseccomp is required")
    ctypes.CDLL(name)
    # ctypes.util.find_library invokes external tools on some systems, so cache it.
    ctypes.util.find_library=lambda name: "libseccomp.so.2" if name=="seccomp" else None
    abi=restrict()
    result=verify(Handle(int(sys.argv[1]),int(sys.argv[2])))
    result["isolation"]={"landlock_abi":abi,"filesystem":"denied","network":"seccomp-denied"}
    print(json.dumps(result),flush=True)
