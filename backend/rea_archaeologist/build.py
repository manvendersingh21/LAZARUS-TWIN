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

OPENPLC_C_FILES = [
    "plc_app/plc_main.c",
    "plc_app/utils/log.c",
    "plc_app/utils/utils.c",
    "plc_app/utils/watchdog.c",
    "plc_app/located_globals.c",
    "plc_app/journal_buffer.c",
    "plc_app/plc_switch.c",
    "plc_app/plc_boot.c",
    "plc_app/plcapp_manager.c",
    "plc_app/scan_cycle_manager.c",
    "plc_app/task_policy.c",
    "drivers/plugin_driver.c",
    "drivers/plugin_config.c",
    "drivers/plugin_plc_requests.c",
    "drivers/vpp_plugin_seal.c",
    "plc_app/unix_socket.c",
    "plc_app/debug_handler.c",
    "plc_app/client_tcp_udp.c",
]

OPENPLC_CPP_FILES = [
    "plc_app/image_tables.cpp",
    "plc_app/debug_write_journal.cpp",
    "plc_app/plc_retain.cpp",
    "plc_app/plc_retain_file_store.cpp",
    "plc_app/plc_state_manager.cpp",
]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _build_openplc(openplc_dir: Path, tmp_dir: Path):
    includes = [
        f"-I{openplc_dir / 'plc_app'}",
        f"-I{openplc_dir / 'lib'}",
        f"-I{openplc_dir / 'drivers'}",
    ]
    py_inc = subprocess.run(["python3-config", "--includes"], text=True, capture_output=True, check=True).stdout.split()
    py_ld = subprocess.run(["python3-config", "--ldflags", "--embed"], text=True, capture_output=True, check=True).stdout.split()
    objs = []
    for idx, rel in enumerate(OPENPLC_C_FILES):
        src = openplc_dir / rel
        obj = tmp_dir / f"c_{idx}_{src.stem}.o"
        subprocess.run(["gcc", "-O2", "-fPIC", "-c", *includes, *py_inc, str(src), "-o", str(obj)], check=True, timeout=60)
        objs.append(str(obj))
    for idx, rel in enumerate(OPENPLC_CPP_FILES):
        src = openplc_dir / rel
        obj = tmp_dir / f"cpp_{idx}_{src.stem}.o"
        subprocess.run(["g++", "-O2", "-std=c++17", "-fPIC", "-c", *includes, *py_inc, str(src), "-o", str(obj)], check=True, timeout=60)
        objs.append(str(obj))
    tmp_bin = tmp_dir / "openplc_runtime"
    tmp_so = tmp_dir / "libopenplc_runtime.so"
    subprocess.run(["g++", "-O2", "-rdynamic", *objs, "-o", str(tmp_bin), *py_ld, "-lpthread", "-ldl", "-lrt"], check=True, timeout=60)
    subprocess.run(["g++", "-O2", "-shared", *objs, "-o", str(tmp_so), *py_ld, "-lpthread", "-ldl", "-lrt"], check=True, timeout=60)
    return tmp_bin, tmp_so

def build():
    """Build atomically; never truncate a shared library mapped by a running twin."""
    with _LOCK:
        BUILD.mkdir(exist_ok=True)
        with (BUILD / '.build.lock').open('a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            source = ROOT / "targets/legacy_controller.c"
            binary, library = BUILD / "legacy_controller", BUILD / "legacy_controller.so"
            openplc_dir = ROOT / "targets/openplc_runtime"
            openplc_bin = BUILD / "openplc_runtime"
            openplc_lib = BUILD / "libopenplc_runtime.so"
            fulmatic_dir = ROOT / "targets/fulmatic_cortex_m4"
            fulmatic_motion_src = fulmatic_dir / "fulmatic_motion_cortex_m4.elf"
            fulmatic_core_src = fulmatic_dir / "fulmatic_core_cortex_m4.elf"
            fulmatic_motion_dst = BUILD / "fulmatic_motion_cortex_m4.elf"
            fulmatic_core_dst = BUILD / "fulmatic_core_cortex_m4.elf"
            manifest=BUILD / 'artifact_manifest.json'
            source_sha=digest(source)
            try: cached=json.loads(manifest.read_text())
            except (OSError,ValueError):cached={}
            valid=(binary.exists() and library.exists() and cached.get('source_sha256')==source_sha
                   and cached.get('binary_sha256')==digest(binary) and cached.get('library_sha256')==digest(library)
                   and openplc_bin.exists() and openplc_lib.exists()
                   and cached.get('openplc_sha256')==digest(openplc_bin)
                   and cached.get('openplc_lib_sha256')==digest(openplc_lib))
            if not valid:
                with tempfile.TemporaryDirectory(prefix="build-",dir=BUILD) as tmp:
                    tmp_path = Path(tmp)
                    tmp_binary=tmp_path/"controller"; tmp_library=tmp_path/"controller.so"
                    subprocess.run(["gcc", "-O2", "-fno-ident", "-o", str(tmp_binary), str(source), "-lm"], check=True, timeout=60)
                    subprocess.run(["strip", "--strip-all", str(tmp_binary)], check=True, timeout=30)
                    subprocess.run(["gcc", "-O2", "-fPIC", "-shared", "-o", str(tmp_library), str(source), "-lm"], check=True, timeout=60)
                    subprocess.run(["strip", "--strip-unneeded", str(tmp_library)], check=True, timeout=30)
                    tmp_openplc_bin, tmp_openplc_so = _build_openplc(openplc_dir, tmp_path)
                    cached={
                        'source_sha256':source_sha,
                        'binary_sha256':digest(tmp_binary),
                        'library_sha256':digest(tmp_library),
                        'openplc_sha256':digest(tmp_openplc_bin),
                        'openplc_lib_sha256':digest(tmp_openplc_so),
                    }
                    os.replace(tmp_binary,binary);os.replace(tmp_library,library)
                    os.replace(tmp_openplc_bin,openplc_bin);os.replace(tmp_openplc_so,openplc_lib)
                    tmp_manifest=tmp_path/'manifest.json';tmp_manifest.write_text(json.dumps(cached))
                    os.replace(tmp_manifest,manifest)
            if fulmatic_motion_src.exists() and (not fulmatic_motion_dst.exists() or digest(fulmatic_motion_dst)!=digest(fulmatic_motion_src)):
                shutil.copy2(fulmatic_motion_src, fulmatic_motion_dst)
            if fulmatic_core_src.exists() and (not fulmatic_core_dst.exists() or digest(fulmatic_core_dst)!=digest(fulmatic_core_src)):
                shutil.copy2(fulmatic_core_src, fulmatic_core_dst)
            vault = ROOT / ".vault"
            vault.mkdir(exist_ok=True)
            sealed=vault / "legacy_controller.c"
            if not sealed.exists() or digest(sealed)!=source_sha:shutil.copy2(source,sealed)
            return {
                "binary":str(binary),
                "library":str(library),
                "sha256":cached['binary_sha256'],
                "library_sha256":cached['library_sha256'],
                "source_sha256":source_sha,
                "openplc_binary":str(openplc_bin),
                "openplc_library":str(openplc_lib),
                "openplc_sha256":cached['openplc_sha256'],
                "fulmatic_motion_elf":str(fulmatic_motion_dst),
                "fulmatic_motion_sha256":digest(fulmatic_motion_dst) if fulmatic_motion_dst.exists() else None,
                "fulmatic_core_elf":str(fulmatic_core_dst),
                "fulmatic_core_sha256":digest(fulmatic_core_dst) if fulmatic_core_dst.exists() else None,
            }

if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
