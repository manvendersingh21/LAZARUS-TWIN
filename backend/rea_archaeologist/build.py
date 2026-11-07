from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build"
_LOCK=threading.RLock()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def build():
    """Build atomically; never truncate a shared library mapped by a running twin."""
    with _LOCK:
        BUILD.mkdir(exist_ok=True)
        with (BUILD / '.build.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            source = ROOT / "targets/legacy_controller.c"
            binary, library = BUILD / "legacy_controller", BUILD / "legacy_controller.so"
            manifest=BUILD / 'artifact_manifest.json'
            source_sha=digest(source)
            try: cached=json.loads(manifest.read_text())
            except (OSError,ValueError):cached={}
            valid=(binary.exists() and library.exists() and cached.get('source_sha256')==source_sha
                   and cached.get('binary_sha256')==digest(binary) and cached.get('library_sha256')==digest(library))
            if not valid:
                with tempfile.TemporaryDirectory(prefix="build-",dir=BUILD) as tmp:
                    tmp_binary=Path(tmp)/"controller"; tmp_library=Path(tmp)/"controller.so"
                    subprocess.run(["gcc", "-O2", "-fno-ident", "-o", str(tmp_binary), str(source), "-lm"], check=True, timeout=60)
                    subprocess.run(["strip", "--strip-all", str(tmp_binary)], check=True, timeout=30)
                    subprocess.run(["gcc", "-O2", "-fPIC", "-shared", "-o", str(tmp_library), str(source), "-lm"], check=True, timeout=60)
                    subprocess.run(["strip", "--strip-unneeded", str(tmp_library)], check=True, timeout=30)
                    cached={'source_sha256':source_sha,'binary_sha256':digest(tmp_binary),'library_sha256':digest(tmp_library)}
                    os.replace(tmp_binary,binary);os.replace(tmp_library,library)
                    tmp_manifest=Path(tmp)/'manifest.json';tmp_manifest.write_text(json.dumps(cached))
                    os.replace(tmp_manifest,manifest)
            vault = ROOT / ".vault"
            vault.mkdir(exist_ok=True)
            sealed=vault / "legacy_controller.c"
            if not sealed.exists() or digest(sealed)!=source_sha:shutil.copy2(source,sealed)
            return {"binary":str(binary),"library":str(library),"sha256":cached['binary_sha256'],
                    "library_sha256":cached['library_sha256'],"source_sha256":source_sha}

if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
