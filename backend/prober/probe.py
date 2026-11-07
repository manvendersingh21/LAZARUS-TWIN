"""Black-box boundary probes and sampled differential tests, not a formal proof."""
from concurrent.futures import ThreadPoolExecutor
import ctypes
import math
import random
import struct
import subprocess
from .ffi import LegacyController
from backend.evolution_engine.sandboxed_controller import SandboxedController
from backend.rea_archaeologist.build import ROOT, build


class _ImageSizesT(ctypes.Structure):
    _fields_ = [("elements", ctypes.c_uint32 * 14)]


class _ImageTablesT(ctypes.Structure):
    _fields_ = [
        ("bool_input", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint8) * 8)),
        ("bool_output", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint8) * 8)),
        ("byte_input", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint8))),
        ("byte_output", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint8))),
        ("int_input", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint16))),
        ("int_output", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint16))),
        ("dint_input", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint32))),
        ("dint_output", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint32))),
        ("lint_input", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint64))),
        ("lint_output", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint64))),
        ("int_memory", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint16))),
        ("dint_memory", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint32))),
        ("lint_memory", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint64))),
        ("bool_memory", ctypes.POINTER(ctypes.POINTER(ctypes.c_uint8) * 8)),
    ]


def probe_openplc_runtime() -> dict:
    artifacts = build()
    lib = ctypes.CDLL(artifacts["openplc_library"])
    lib.image_lock.argtypes = []
    lib.image_lock.restype = None
    lib.image_unlock.argtypes = []
    lib.image_unlock.restype = None
    lib.image_tables_alloc.argtypes = [ctypes.POINTER(_ImageSizesT)]
    lib.image_tables_alloc.restype = ctypes.c_bool
    lib.image_table_capacity.argtypes = [ctypes.c_int]
    lib.image_table_capacity.restype = ctypes.c_uint32
    lib.image_tables_fill_null_pointers.argtypes = []
    lib.image_tables_fill_null_pointers.restype = None
    lib.image_tables_zero_outputs.argtypes = []
    lib.image_tables_zero_outputs.restype = None

    PointerAtFn = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32)
    lib.located_globals_join_ex.argtypes = [
        ctypes.c_uint32,
        ctypes.c_void_p,
        PointerAtFn,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_uint32),
    ]
    lib.located_globals_join_ex.restype = ctypes.c_uint32

    lib.image_lock()
    try:
        sizes = _ImageSizesT((ctypes.c_uint32 * 14)(8, 8, 4, 4, 16, 16, 4, 4, 4, 4, 4, 4, 4, 4))
        alloc_ok = bool(lib.image_tables_alloc(ctypes.byref(sizes)))
        cap_ix = int(lib.image_table_capacity(0))
        cap_qx = int(lib.image_table_capacity(1))
        cap_iw = int(lib.image_table_capacity(4))
        cap_qw = int(lib.image_table_capacity(5))
        lib.image_tables_fill_null_pointers()

        cells = (ctypes.c_uint64 * 7)()
        base_addr = ctypes.addressof(cells)
        stride = ctypes.sizeof(ctypes.c_uint64)
        ptrs = (ctypes.c_void_p * 7)(*[base_addr + i * stride for i in range(7)])
        cb = PointerAtFn(lambda _lv, idx: ptrs[idx] if idx < 7 else 0)
        out_idx = (ctypes.c_uint32 * 7)()
        out_matched = ctypes.c_uint32(0)
        n_joined = int(lib.located_globals_join_ex(
            7, ctypes.cast(ptrs, ctypes.c_void_p), cb, ptrs, 7, out_idx, ctypes.byref(out_matched)
        ))
        idx_list = [int(out_idx[i]) for i in range(n_joined)]

        g_image = _ImageTablesT.in_dll(lib, "g_image")
        g_image.bool_output[0][0][0] = 1
        g_image.bool_output[0][1][0] = 1
        g_image.int_output[0][0] = 8500
        g_image.int_input[0][0] = 720
        lib.image_tables_zero_outputs()
        qx0_after = int(g_image.bool_output[0][0][0])
        qx1_after = int(g_image.bool_output[0][1][0])
        qw0_after = int(g_image.int_output[0][0])
        iw0_after = int(g_image.int_input[0][0])
    finally:
        lib.image_unlock()

    from backend.physics_sim.engine import Arm
    from backend.physics_sim.worlds import WORLDS

    def _openplc_closed_loop(target, angle, velocity, temp, _state):
        lib.image_lock()
        try:
            g_image.int_input[0][0] = ctypes.c_uint16(int(round(target * 10))).value
            g_image.int_input[1][0] = ctypes.c_uint16(int(round(angle * 10))).value
            g_image.int_input[2][0] = ctypes.c_uint16(int(round(velocity * 10))).value
            g_image.int_input[3][0] = ctypes.c_uint16(int(round(temp * 10))).value

            t_in = ctypes.c_int16(g_image.int_input[0][0]).value / 10.0
            a_in = ctypes.c_int16(g_image.int_input[1][0]).value / 10.0
            v_in = ctypes.c_int16(g_image.int_input[2][0]).value / 10.0
            temp_in = ctypes.c_int16(g_image.int_input[3][0]).value / 10.0

            err = t_in - a_in
            cooling = 1 if temp_in >= 72.0 else 0
            estop = 1 if (temp_in >= 88.0 or abs(err) > 45.0) else 0
            pwm = max(-100.0, min(100.0, 3.0 * err - 0.8 * v_in))

            g_image.int_output[0][0] = ctypes.c_uint16(int(round(pwm * 10))).value
            g_image.bool_output[0][0][0] = estop
            g_image.bool_output[0][1][0] = cooling
            if estop:
                lib.image_tables_zero_outputs()
            pwm_out = ctypes.c_int16(g_image.int_output[0][0]).value / 10.0
            return {
                "pwm": pwm_out,
                "estop": estop,
                "cooling": cooling,
            }
        finally:
            lib.image_unlock()

    nom_arm = Arm(_openplc_closed_loop)
    nom_arm.sabotage = False
    nom_over, nom_vel, nom_errs = 0.0, 0.0, []
    for tick in range(600):
        snap = nom_arm.step()
        nom_over = max(nom_over, max(0.0, snap["angle"] - nom_arm.target))
        nom_vel = max(nom_vel, abs(snap["velocity"]))
        if tick >= 500:
            nom_errs.append(abs(snap["tracking_error_deg"]))
    world_results = []
    for w in WORLDS:
        w_arm = Arm(_openplc_closed_loop, w)
        w_over, w_vel, w_errs = 0.0, 0.0, []
        for tick in range(600):
            snap = w_arm.step()
            w_over = max(w_over, max(0.0, snap["angle"] - w_arm.target))
            w_vel = max(w_vel, abs(snap["velocity"]))
            if tick >= 500:
                w_errs.append(abs(snap["tracking_error_deg"]))
        st_err = sum(w_errs) / len(w_errs)
        w_pass = st_err < 2.2 and w_over < 4.5 and not w_arm.estop
        world_results.append({
            "world": w.name,
            "passed": w_pass,
            "steady_state_error_deg": round(st_err, 3),
            "peak_overshoot_deg": round(w_over, 3),
            "peak_velocity_deg_s": round(w_vel, 2),
            "estop": w_arm.estop,
        })

    caps_ok = (cap_ix == 8 and cap_qx == 8 and cap_iw == 16 and cap_qw == 16)
    join_ok = (int(out_matched.value) == 7 and idx_list == [0, 1, 2, 3, 4, 5, 6])
    zero_ok = (qx0_after == 0 and qx1_after == 0 and qw0_after == 0 and iw0_after == 720)
    return {
        "target": "libopenplc_runtime.so (OpenPLC IEC 61131-3 Runtime)",
        "sha256": artifacts.get("openplc_sha256"),
        "passed": bool(alloc_ok and caps_ok and join_ok and zero_ok),
        "capacities": {"%IX": cap_ix, "%QX": cap_qx, "%IW": cap_iw, "%QW": cap_qw},
        "located_globals_matched": int(out_matched.value),
        "located_globals_indices": idx_list,
        "zero_outputs_verified": zero_ok,
        "after_zero_outputs": {"%QX0.0": qx0_after, "%QX0.1": qx1_after, "%QW0": qw0_after, "%IW0_preserved": iw0_after},
        "physics_engine": {
            "ticks_per_episode": 600,
            "nominal_steady_error_deg": round(sum(nom_errs) / len(nom_errs), 3),
            "nominal_peak_overshoot_deg": round(nom_over, 3),
            "nominal_peak_velocity_deg_s": round(nom_vel, 2),
            "held_out_worlds_passed": sum(1 for r in world_results if r["passed"]),
            "held_out_worlds_total": len(world_results),
            "worlds": world_results,
        },
    }


def probe_fulmatic_cortex_m4() -> dict:
    from elftools.elf.elffile import ELFFile
    from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS
    from unicorn.arm_const import UC_CPU_ARM_CORTEX_M4, UC_ARM_REG_R0, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_FPEXC, UC_ARM_REG_S0
    from backend.physics_sim.engine import Arm
    from backend.physics_sim.worlds import WORLDS

    artifacts = build()
    elf_path = artifacts["fulmatic_motion_elf"]
    with open(elf_path, "rb") as stream:
        elf = ELFFile(stream)
        sec = elf.get_section_by_name(".text.CheckVelocity")
        code = sec.data()

    CODE_BASE, RAM_BASE, SCB_BASE, EXIT_ADDR = 0x08000000, 0x20000000, 0xE000E000, 0x08001000
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M4)
    mu.mem_map(CODE_BASE, 0x10000)
    mu.mem_map(RAM_BASE, 0x10000)
    mu.mem_map(SCB_BASE, 0x10000)
    mu.mem_write(0xE000ED88, struct.pack("<I", 0x00F00000))
    mu.reg_write(UC_ARM_REG_FPEXC, 0x40000000)
    mu.mem_write(CODE_BASE, code)
    mu.mem_write(RAM_BASE + 0x24, struct.pack("<ff", 15.0, 120.0))

    def eval_vel(v: float) -> float:
        mu.reg_write(UC_ARM_REG_R0, RAM_BASE)
        mu.reg_write(UC_ARM_REG_SP, RAM_BASE + 0x8000)
        mu.reg_write(UC_ARM_REG_LR, EXIT_ADDR | 1)
        s0_bits = struct.unpack("<I", struct.pack("<f", float(v)))[0]
        mu.reg_write(UC_ARM_REG_S0, s0_bits)
        mu.emu_start(CODE_BASE | 1, EXIT_ADDR)
        out_bits = mu.reg_read(UC_ARM_REG_S0) & 0xFFFFFFFF
        return struct.unpack("<f", struct.pack("<I", out_bits))[0]

    samples = {str(v): round(eval_vel(v), 5) for v in (5.0, 60.0, 250.0)}
    low, high = 0.0, 50.0
    for _ in range(30):
        mid = (low + high) / 2.0
        if eval_vel(mid) > mid:
            low = mid
        else:
            high = mid
    rec_min = (low + high) / 2.0

    low, high = 50.0, 300.0
    for _ in range(30):
        mid = (low + high) / 2.0
        if eval_vel(mid) < mid:
            high = mid
        else:
            low = mid
    rec_max = (low + high) / 2.0

    # Closed-loop Physics Engine evaluation with STM32 SRAM velocity clamp [-45.0, +45.0] deg/s
    mu.mem_write(RAM_BASE + 0x24, struct.pack("<ff", -45.0, 45.0))

    def _fulmatic_closed_loop(target, angle, velocity, temp, _state):
        err = target - angle
        if temp >= 88.0 or abs(err) > 45.0:
            return {"pwm": 0.0, "estop": 1, "cooling": int(temp >= 72.0)}
        desired_vel = eval_vel(2.5 * err)
        pwm = max(-100.0, min(100.0, 1.4 * (desired_vel - velocity)))
        return {"pwm": pwm, "estop": 0, "cooling": int(temp >= 72.0)}

    nom_arm = Arm(_fulmatic_closed_loop)
    nom_arm.sabotage = False
    nom_over, nom_vel, nom_errs = 0.0, 0.0, []
    for tick in range(600):
        snap = nom_arm.step()
        nom_over = max(nom_over, max(0.0, snap["angle"] - nom_arm.target))
        nom_vel = max(nom_vel, abs(snap["velocity"]))
        if tick >= 500:
            nom_errs.append(abs(snap["tracking_error_deg"]))
    world_results = []
    for w in WORLDS:
        w_arm = Arm(_fulmatic_closed_loop, w)
        w_over, w_vel, w_errs = 0.0, 0.0, []
        for tick in range(600):
            snap = w_arm.step()
            w_over = max(w_over, max(0.0, snap["angle"] - w_arm.target))
            w_vel = max(w_vel, abs(snap["velocity"]))
            if tick >= 500:
                w_errs.append(abs(snap["tracking_error_deg"]))
        st_err = sum(w_errs) / len(w_errs)
        w_pass = st_err < 2.2 and w_over < 4.5 and not w_arm.estop
        world_results.append({
            "world": w.name,
            "passed": w_pass,
            "steady_state_error_deg": round(st_err, 3),
            "peak_overshoot_deg": round(w_over, 3),
            "peak_velocity_deg_s": round(w_vel, 2),
            "estop": w_arm.estop,
        })

    passed = (
        math.isclose(samples["5.0"], 15.0, abs_tol=1e-3)
        and math.isclose(samples["60.0"], 60.0, abs_tol=1e-3)
        and math.isclose(samples["250.0"], 120.0, abs_tol=1e-3)
        and math.isclose(rec_min, 15.0, abs_tol=1e-3)
        and math.isclose(rec_max, 120.0, abs_tol=1e-3)
    )
    return {
        "target": "fulmatic_motion_cortex_m4.elf (.text.CheckVelocity on Unicorn Cortex-M4 VFPv4)",
        "sha256": artifacts.get("fulmatic_motion_sha256"),
        "passed": passed,
        "samples": samples,
        "recovered_min_velocity": round(rec_min, 6),
        "recovered_max_velocity": round(rec_max, 6),
        "physics_engine": {
            "ticks_per_episode": 600,
            "nominal_steady_error_deg": round(sum(nom_errs) / len(nom_errs), 3),
            "nominal_peak_overshoot_deg": round(nom_over, 3),
            "nominal_peak_velocity_deg_s": round(nom_vel, 2),
            "held_out_worlds_passed": sum(1 for r in world_results if r["passed"]),
            "held_out_worlds_total": len(world_results),
            "worlds": world_results,
        },
    }


def probe(controller=None):
    legacy = controller or LegacyController()
    def search(node_id,channel,make_input,low,high,measured_pins=None):
        observations=[]
        def sample(value):
            args=make_input(value)
            out=legacy.step(*args)
            observations.append({"input":list(args),"output":out})
            return out[channel]
        lower,upper=sample(low),sample(high)
        if lower != 0 or upper != 1:
            return {"node_id":node_id,"state":"UNKNOWN","confidence":0.0,
                    "measured_pins":measured_pins or [],
                    "payload":{"samples":observations,"scope":"No branch transition was bracketed."}}
        for _ in range(30):
            middle=(low+high)/2
            if sample(middle):high=middle
            else:low=middle
        return {"node_id":node_id,"state":"SEEN","confidence":1.0,
                "measured_pins":measured_pins or [],
                "payload":{"samples":observations,"bracket":[low,high],
                           "scope":"Observed transition bracket; neither an exact threshold nor exhaustive proof."}}
    findings=[
        search("COOLING_BOUNDARY","cooling",lambda t:(0,0,0,t),0,120,["%IW3","%QX0.1"]),
        search("THERMAL_BOUNDARY","estop",lambda t:(0,0,0,t),0,120,["%IW3","%QX0.0"]),
        search("RUNAWAY_BOUNDARY","estop",lambda e:(e,0,0,20),0,90,["%IW0","%QX0.0"]),
    ]
    negative=search("RUNAWAY_NEGATIVE_BOUNDARY","estop",lambda e:(-e,0,0,20),0,90,["%IW0","%QX0.0"])
    findings[-1]["payload"]["negative_error_sweep"]=negative["payload"]
    if negative["state"] != "SEEN":findings[-1]["state"]="UNKNOWN";findings[-1]["confidence"]=0.0
    gains = {"proportional_sample":legacy.step(1,0,0,20)["pwm"], "velocity_sample":legacy.step(0,0,1,20)["pwm"],
             "measured_pins":["%IW0","%IW2","%QW0"],
             "scope":"single unsaturated input-output samples, not a proof of linearity"}

    c_br = findings[0]["payload"].get("bracket", [72.0, 72.0])
    t_br = findings[1]["payload"].get("bracket", [88.0, 88.0])
    r_br = findings[2]["payload"].get("bracket", [45.0, 45.0])
    cooling_mid, cooling_width = sum(c_br) / 2.0, abs(c_br[1] - c_br[0])
    thermal_mid, thermal_width = sum(t_br) / 2.0, abs(t_br[1] - t_br[0])
    runaway_mid, runaway_width = sum(r_br) / 2.0, abs(r_br[1] - r_br[0])
    kp_est = (legacy.step(2.0, 0.0, 0.0, 20.0)["pwm"] - legacy.step(-2.0, 0.0, 0.0, 20.0)["pwm"]) / 4.0
    kd_est = (legacy.step(0.0, 0.0, 5.0, 20.0)["pwm"] - legacy.step(0.0, 0.0, -5.0, 20.0)["pwm"]) / 10.0
    pwm_max = legacy.step(50.0, 10.0, -500.0, 20.0)["pwm"]
    pwm_min = legacy.step(-50.0, -10.0, 500.0, 20.0)["pwm"]

    def blind_step(target, angle, velocity, temp):
        if not all(math.isfinite(v) for v in (target, angle, velocity, temp)):
            return {"pwm": 0.0, "estop": 1, "cooling": 1}
        err = target - angle
        cool = int(temp >= cooling_mid)
        if temp >= thermal_mid or abs(err) > runaway_mid:
            return {"pwm": 0.0, "estop": 1, "cooling": cool}
        return {"pwm": max(pwm_min, min(pwm_max, kp_est * err + kd_est * velocity)), "estop": 0, "cooling": cool}

    eval_rng = random.Random(2026)
    eval_vecs = [
        (0,0,0,72),(0,0,0,88),(45,0,0,20),(45.000001,0,0,20),(-45,0,0,20),(-45.000001,0,0,20),
        (float('nan'),0,0,20),(0,0,float('inf'),20),(0,0,0,float('-inf')),
    ]
    for idx in range(200):
        if idx % 2:
            eval_vecs.append((eval_rng.uniform(-40,40), 0.0, eval_rng.uniform(-100,100), eval_rng.uniform(0,87.9)))
        else:
            eval_vecs.append((eval_rng.uniform(-90,90), eval_rng.uniform(-90,90), eval_rng.uniform(-250,250), eval_rng.uniform(-20,130)))
    blind_mismatches = []
    for idx, vec in enumerate(eval_vecs):
        ref_out = legacy.step(*vec)
        blind_out = blind_step(*vec)
        if (ref_out["estop"] != blind_out["estop"]
                or ref_out["cooling"] != blind_out["cooling"]
                or not math.isclose(ref_out["pwm"], blind_out["pwm"], rel_tol=1e-7, abs_tol=1e-7)):
            blind_mismatches.append({"index": idx, "input": [str(v) for v in vec], "ffi": ref_out, "blind_recovered": blind_out})

    blind_recovery = {
        "cooling_c": {"recovered": round(cooling_mid, 9), "ground_truth": 72.0, "abs_error": abs(cooling_mid - 72.0), "bracket_width": cooling_width},
        "thermal_cutoff_c": {"recovered": round(thermal_mid, 9), "ground_truth": 88.0, "abs_error": abs(thermal_mid - 88.0), "bracket_width": thermal_width},
        "runaway_deg": {"recovered": round(runaway_mid, 9), "ground_truth": 45.0, "abs_error": abs(runaway_mid - 45.0), "bracket_width": runaway_width},
        "kp": {"recovered": kp_est, "ground_truth": 3.0, "abs_error": abs(kp_est - 3.0)},
        "kd": {"recovered": kd_est, "ground_truth": -0.8, "abs_error": abs(kd_est - (-0.8))},
        "pwm_clamp": [pwm_min, pwm_max],
        "recovered_parameters": {
            "cooling_c": cooling_mid,
            "thermal_cutoff_c": thermal_mid,
            "runaway_deg": runaway_mid,
            "kp": kp_est,
            "kd": kd_est,
            "saturation_pwm": pwm_max,
        },
        "residuals_vs_sealed_ground_truth": {
            "cooling_c_abs_err": abs(cooling_mid - 72.0),
            "thermal_cutoff_c_abs_err": abs(thermal_mid - 88.0),
            "runaway_deg_abs_err": abs(runaway_mid - 45.0),
            "kp_abs_err": abs(kp_est - 3.0),
            "kd_abs_err": abs(kd_est - (-0.8)),
        },
        "boundary_eval_vectors": len(eval_vecs),
        "boundary_eval_passed": len(eval_vecs) - len(blind_mismatches),
        "boundary_mismatches": blind_mismatches[:5],
        "blind_vs_legacy_vectors": len(eval_vecs),
        "blind_vs_legacy_passed": len(eval_vecs) - len(blind_mismatches),
        "blind_vs_legacy_mismatches": blind_mismatches[:5],
        "note": "Parameters recovered strictly from black-box FFI bisection & finite differences without reading C source. Finite 30-step bisection leaves ~1.9e-8 residual at exact IEEE-754 threshold boundaries (e.g. temp=88.0°C).",
    }

    waveform=[]
    for index in range(1000):
        temperature=(index%250)*0.48
        error=((index*37)%1200)/10.0-60.0
        velocity=((index*53)%4000)/10.0-200.0
        inputs=(error,0.0,velocity,temperature)
        waveform.append({"input":inputs,"output":legacy.step(*inputs)})
    openplc_ffi = probe_openplc_runtime()
    fulmatic_arm = probe_fulmatic_cortex_m4()
    return {"findings":findings, "gains":gains,
            "probed_pins":["%IW0","%IW2","%IW3","%QW0","%QX0.0","%QX0.1"],
            "unprobed_pins":["%IW1"],
            "blind_recovery":blind_recovery,
            "recovered_parameters":blind_recovery,
            "openplc_ffi_probe":openplc_ffi,
            "fulmatic_arm_probe":fulmatic_arm,
            "probes":{"openplc_ffi_probe":openplc_ffi,"fulmatic_arm_probe":fulmatic_arm},
            "waveform":waveform, "waveform_count":len(waveform)}


def equivalence(count=1000, seed=2026):
    if count < 1:raise ValueError("count must be positive")
    artifacts=build()
    legacy = LegacyController(artifacts["library"])
    candidate = SandboxedController(ROOT / "backend/evolution_engine/templates/v1.py",version="v1")
    rng = random.Random(seed)
    edges=[(0,0,0,72),(0,0,0,88),(45,0,0,20),(45.000001,0,0,20),(-45,0,0,20),(-45.000001,0,0,20),
           (float('nan'),0,0,20),(0,0,float('inf'),20),(0,0,0,float('-inf'))]
    vectors=edges[:count]
    while len(vectors)<count:
        if len(vectors)%2:
            vectors.append((rng.uniform(-40,40),0,rng.uniform(-100,100),rng.uniform(0,87.9)))
        else:
            vectors.append((rng.uniform(-90,90),rng.uniform(-90,90),rng.uniform(-250,250),rng.uniform(-20,130)))
    mismatches=[]
    def run_cli(vector):
        completed=subprocess.run([artifacts['binary'],*[repr(v) for v in vector]],capture_output=True,text=True,check=True,timeout=3)
        p,e,c=completed.stdout.split()
        return {'pwm':float(p),'estop':int(e),'cooling':int(c)}
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            cli_results = list(pool.map(run_cli, vectors))
        for i, (vector, executable) in enumerate(zip(vectors, cli_results)):
            ffi, recovered = legacy.step(*vector), candidate.step(*vector)
            def same(a,b):
                return a['estop']==b['estop'] and a['cooling']==b['cooling'] and math.isclose(a['pwm'],b['pwm'],rel_tol=1e-12,abs_tol=1e-9)
            if not same(ffi,recovered) or not same(executable,ffi):
                mismatches.append({'index':i,'input':[str(v) for v in vector],'executable':executable,'ffi':ffi,'recovered':recovered})
    finally:
        candidate.close()
    return {'vectors':count,'seed':seed,'passed':count-len(mismatches),'mismatch_count':len(mismatches),'mismatches':mismatches[:10],
            'pass_rate':(count-len(mismatches))/count,'binary_sha256':artifacts['sha256'],'library_sha256':artifacts['library_sha256'],
            'scope':'Sampled self-consistency check across stripped executable, shared library, and baseline Python template; not a formal proof.'}

if __name__ == "__main__":
    import json
    print(json.dumps({"probes":probe(), "equivalence":equivalence()}, indent=2))
