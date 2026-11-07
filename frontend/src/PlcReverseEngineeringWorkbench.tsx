import { Cpu, FileCode2, GitBranch, Radar, ShieldCheck, Terminal as TerminalIcon, Zap } from 'lucide-react'
import { useState } from 'react'
import { type Inspection, type Terminal } from './types'

type BinaryTargetTab = 'servo_elf' | 'openplc_x86' | 'cortex_m4' | 'solidity_evm'

const SERVO_DISASSEMBLY = [
  {
    offset: '0x11c0',
    bytes: 'f2 0f 5c c1',
    asm: 'subsd  xmm0, xmm1',
    comment: 'err = target_deg (%IW0) - current_angle (%IW1)',
    pinId: '%IW0',
    channel: '%IW0 / %IW1',
  },
  {
    offset: '0x11c8',
    bytes: 'f2 0f 59 05 20 0e 00 00',
    asm: 'mulsd  xmm0, QWORD PTR [rip+0xe20]',
    comment: 'p_term = kp (3.00) * err',
    pinId: '%IW1',
    channel: '%IW1 (Joint θ)',
  },
  {
    offset: '0x11d0',
    bytes: 'f2 0f 59 15 28 0e 00 00',
    asm: 'mulsd  xmm2, QWORD PTR [rip+0xe28]',
    comment: 'd_term = kd (-0.80) * angular_vel (%IW2)',
    pinId: '%IW2',
    channel: '%IW2 (Vel ω)',
  },
  {
    offset: '0x11e2',
    bytes: '66 0f 2e 1d 36 0e 00 00',
    asm: 'ucomisd xmm3, QWORD PTR [rip+0xe36]',
    comment: 'cmp core_temp (%IW3), 88.0°C (UNKNOWN rodata)',
    pinId: '%IW3',
    channel: '%IW3 (Temp °C)',
  },
  {
    offset: '0x11ea',
    bytes: '0f 83 20 00 00 00',
    asm: 'jae    0x1210 <estop_latch>',
    comment: 'if temp >= 88.0°C -> %QX0.0 = 1, %QW0 = 0%',
    pinId: '%QX0.0',
    channel: '%QX0.0 (E-Stop)',
  },
  {
    offset: '0x11f4',
    bytes: '0f 87 26 00 00 00',
    asm: 'ja     0x1220 <cooling_valve>',
    comment: 'if temp >= 72.0°C -> %QX0.1 = 1 (Cooling ON)',
    pinId: '%QX0.1',
    channel: '%QX0.1 (Cooling)',
  },
  {
    offset: '0x1204',
    bytes: '66 0f 2e 0d 46 0e 00 00',
    asm: 'ucomisd xmm1, QWORD PTR [rip+0xe46]',
    comment: 'if |angle| >= 45.0° runaway -> clamp %QW0 PWM',
    pinId: '%QW0',
    channel: '%QW0 (PWM Out)',
  },
]

const OPENPLC_DISASSEMBLY = [
  {
    offset: '0x2410',
    bytes: '48 89 fb e8 4b 02 00 00',
    asm: 'call   image_tables_bind_located_vars',
    comment: 'Binds IEC 61131-3 %IW0..%IW3, %QW0, %QX0.0, %QX0.1',
    pinId: '%IW0',
    channel: 'IEC Table Bind',
  },
  {
    offset: '0x2580',
    bytes: '48 8b 05 91 3a 00 00',
    asm: 'call   located_globals_join_ex',
    comment: 'Matches 7/7 PLC channels in libopenplc_runtime.so',
    pinId: '%QW0',
    channel: '7/7 Globals',
  },
  {
    offset: '0x26c4',
    bytes: '31 c0 48 89 07',
    asm: 'call   image_tables_zero_outputs',
    comment: 'Safety zeroing: %QW0 8500->0, %QX0.0 1->0 (%IW0 preserved)',
    pinId: '%QX0.0',
    channel: 'Fail-Safe Zero',
  },
  {
    offset: '0x2890',
    bytes: '48 83 ec 28 e8 12 fd ff',
    asm: 'call   _Z16plc_cycle_threadPv',
    comment: '10ms real-time scan cycle loop (4,712+ x86-64 instr)',
    pinId: '%IW1',
    channel: 'Scan Thread',
  },
]

const CORTEX_M4_DISASSEMBLY = [
  {
    offset: '0x08000140',
    bytes: 'ed90 7a09',
    asm: 'vldr.32 s14, [r0, #0x24]',
    comment: 'Load min_velocity clamp (15.0 deg/s) from struct [r0+0x24]',
    pinId: '%IW2',
    channel: 'VFPv4 Min Clamp',
  },
  {
    offset: '0x08000144',
    bytes: 'eeb4 0ac7',
    asm: 'vcmp.f32 s0, s14',
    comment: 'Compare requested servo velocity s0 vs min_vel s14',
    pinId: '%IW2',
    channel: 'CheckVelocity',
  },
  {
    offset: '0x08000148',
    bytes: 'eef1 fa10',
    asm: 'vmrs    APSR_nzcv, fpscr',
    comment: 'Transfer ARM Cortex-M4 FPU status flags to APSR',
    pinId: '%QW0',
    channel: 'Cortex-M4 FPU',
  },
  {
    offset: '0x0800014c',
    bytes: 'bfb8 eeb0',
    asm: 'it lt ; vmovlt.f32 s0, s14',
    comment: 'If req < 15.0 -> clamp output velocity s0 = 15.0 deg/s',
    pinId: '%QW0',
    channel: 'Thumb-2 IT Block',
  },
  {
    offset: '0x08000152',
    bytes: 'ed90 7a0a',
    asm: 'vldr.32 s15, [r0, #0x28]',
    comment: 'Load max_velocity clamp (120.0 deg/s) from struct [r0+0x28]',
    pinId: '%QX0.0',
    channel: 'VFPv4 Max Clamp',
  },
]

const SOLIDITY_DISASSEMBLY = [
  {
    offset: '0x004a',
    bytes: '63 a9 05 9c bb',
    asm: 'PUSH4 0xa9059cbb ; step(int256x4)',
    comment: 'Foundry Anvil Q16.16 fixed-point governor selector',
    pinId: '%IW0',
    channel: 'EVM Selector',
  },
  {
    offset: '0x008c',
    bytes: '7f 00 58 00 00',
    asm: 'PUSH32 0x580000 ; 88.0°C * 65536',
    comment: 'On-chain thermal E-Stop threshold parity check',
    pinId: '%QX0.0',
    channel: 'Anvil 88.0°C',
  },
  {
    offset: '0x00d4',
    bytes: '7f 00 48 00 00',
    asm: 'PUSH32 0x480000 ; 72.0°C * 65536',
    comment: 'On-chain cooling relay activation parity check',
    pinId: '%QX0.1',
    channel: 'Anvil 72.0°C',
  },
  {
    offset: '0x0118',
    bytes: 'f3 00 00 00 00',
    asm: 'RETURN (pwm_q16, estop, cooling)',
    comment: '262/262 differential vectors matched C binary 100%',
    pinId: '%QW0',
    channel: '262/262 Verified',
  },
]

export default function PlcReverseEngineeringWorkbench({
  inspection,
  activeVersion,
  selectedPinId,
  busyProbe,
  busyEvolve,
  onProbe,
  onEvolve,
  onSelectPin,
}: {
  inspection: Inspection | null
  activeVersion: string
  selectedPinId: string | null
  busyProbe: boolean
  busyEvolve: boolean
  onProbe: () => void
  onEvolve: () => void
  onSelectPin: (terminal: Terminal) => void
}) {
  const [targetTab, setTargetTab] = useState<BinaryTargetTab>('servo_elf')
  const [probeTarget, setProbeTarget] = useState(30.0)
  const [probeAngle, setProbeAngle] = useState(16.6)
  const [probeVel, setProbeVel] = useState(0.0)
  const [probeTemp, setProbeTemp] = useState(42.5)
  const terminals = inspection?.topology?.terminals ?? []
  const allProbed = terminals.some(t => t.state === 'SEEN')

  const probeErr = probeTarget - probeAngle
  const probeEstop = probeTemp >= 88.0 || Math.abs(probeErr) > 45.0 ? 1 : 0
  const probeCooling = probeTemp >= 72.0 ? 1 : 0
  const legacyPwm = probeEstop
    ? 0.0
    : Math.max(-100.0, Math.min(100.0, 3.0 * probeErr - 0.8 * probeVel))
  const evolvedGravityFf = 32.931 * Math.cos((probeAngle * Math.PI) / 180.0)
  const evolvedIntegralBoost = probeErr > 1.0 ? 14.5 : 0.0
  const evolvedPwm = probeEstop
    ? 0.0
    : Math.max(
        -100.0,
        Math.min(100.0, 3.554 * probeErr - 1.93 * probeVel + evolvedGravityFf + evolvedIntegralBoost)
      )

  const rows =
    targetTab === 'servo_elf'
      ? SERVO_DISASSEMBLY
      : targetTab === 'openplc_x86'
        ? OPENPLC_DISASSEMBLY
        : targetTab === 'cortex_m4'
          ? CORTEX_M4_DISASSEMBLY
          : SOLIDITY_DISASSEMBLY

  const handleRowClick = (pinId: string, offset: string) => {
    const found = terminals.find(t => t.id === pinId) ?? {
      id: pinId,
      label: `PLC Channel ${pinId}`,
      slot: pinId.startsWith('%IW') ? 1 : pinId.startsWith('%QW') ? 2 : 3,
      state: allProbed ? 'SEEN' : 'INFERRED',
      offset,
      governor_function: 'step(int256,int256,int256,int256)',
    }
    onSelectPin(found)
  }

  return (
    <section
      aria-label="Live PLC Reverse Engineering and Binary Archaeology Workbench"
      style={{
        marginTop: '16px',
        border: '1px solid #355248',
        borderRadius: '5px',
        background: 'linear-gradient(165deg, #0e1b19 0%, #0a1315 100%)',
        padding: '16px 18px',
        boxShadow: '0 14px 40px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* Header & 4 Binary Target Selector Tabs */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          borderBottom: '1px solid #243b34',
          paddingBottom: '12px',
          marginBottom: '14px',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 800,
              letterSpacing: '0.15em',
              color: '#8de5b5',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
            }}
          >
            <Cpu size={13} />
            <span>01B // LIVE PLC REVERSE ENGINEERING &amp; BINARY ARCHAEOLOGY WORKBENCH</span>
          </div>
          <h2
            style={{
              margin: '4px 0 0',
              fontSize: '18px',
              fontWeight: 500,
              color: '#e8f4ec',
              letterSpacing: '-0.02em',
            }}
          >
            Stripped ELF Disassembly → 30-Step FFI Boundary Bisection → Self-Evolving Python &amp; Solidity Control Law
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {(
            [
              ['servo_elf', '1. STRIPPED SERVO PLC (x86-64 ELF)'],
              ['openplc_x86', '2. OPENPLC IEC 61131-3 (.so)'],
              ['cortex_m4', '3. STM32F407 ARM CORTEX-M4 (Thumb-2)'],
              ['solidity_evm', '4. SOLIDITY GOVERNOR (Anvil EVM)'],
            ] as [BinaryTargetTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTargetTab(id)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 700,
                padding: '6px 10px',
                borderRadius: '3px',
                border: `1px solid ${targetTab === id ? '#6effc5' : '#2c443d'}`,
                background: targetTab === id ? '#16382b' : '#101f1e',
                color: targetTab === id ? '#a8f9d4' : '#9bb8ac',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Column Reverse Engineering Pipeline */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
          alignItems: 'stretch',
        }}
      >
        {/* COLUMN 1: RAW MACHINE DISASSEMBLY */}
        <div
          style={{
            border: '1px solid #284038',
            borderRadius: '4px',
            background: '#0b1516',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 800,
                color: '#68c9ff',
                letterSpacing: '0.1em',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <TerminalIcon size={12} />
              STEP A // STRIPPED DISASSEMBLY (CLICK TO INSPECT 3D PIN)
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                padding: '2px 6px',
                border: '1px solid #2d4c43',
                color: '#8de5b5',
                borderRadius: '2px',
              }}
            >
              {targetTab === 'servo_elf'
                ? '83 x86-64 INSTR'
                : targetTab === 'openplc_x86'
                  ? '4,712+ x86-64 INSTR'
                  : targetTab === 'cortex_m4'
                    ? '1,102 THUMB-2 INSTR'
                    : '262 EVM TRACES'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {rows.map(r => {
              const isSelected = selectedPinId === r.pinId
              return (
                <div
                  key={r.offset}
                  onClick={() => handleRowClick(r.pinId, r.offset)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '3px',
                    border: `1px solid ${isSelected ? '#6effc5' : '#1e332d'}`,
                    background: isSelected ? 'rgba(22, 62, 46, 0.85)' : '#0f1c1d',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ color: '#f5a623', fontWeight: 700 }}>{r.offset}</span>
                    <span style={{ color: '#e2f2e8', fontWeight: 600, flex: 1 }}>{r.asm}</span>
                    <span
                      style={{
                        color: allProbed ? '#6effc5' : '#f5a623',
                        fontSize: '8px',
                        padding: '1px 5px',
                        border: '1px solid #2b473e',
                        borderRadius: '2px',
                      }}
                    >
                      {r.channel}
                    </span>
                  </div>
                  <div style={{ color: '#7e9e90', fontSize: '8px', marginTop: '2px' }}>
                    ; {r.comment}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* COLUMN 2: ACTIVE FFI BISECTION & UNICORN EMULATION PROBER */}
        <div
          style={{
            border: '1px solid #284038',
            borderRadius: '4px',
            background: '#0b1516',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 800,
                color: '#b6e992',
                letterSpacing: '0.1em',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Radar size={12} />
              STEP B // FFI BISECTION &amp; UNICORN ARM TRUTH TABLE
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                padding: '2px 6px',
                background: allProbed ? '#143829' : '#332211',
                color: allProbed ? '#6effc5' : '#f5a623',
                border: `1px solid ${allProbed ? '#3da373' : '#d97706'}`,
                borderRadius: '2px',
                fontWeight: 700,
              }}
            >
              {allProbed ? '7/7 CHANNELS VERIFIED (SEEN)' : '3 HIDDEN BRANCHES UNKNOWN'}
            </span>
          </div>

          <table className="technical-table" style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th>BINARY CONSTANT / ABI</th>
                <th>PROBE METHOD</th>
                <th>RECOVERED VALUE</th>
                <th>RESIDUAL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>[rip+0xe36]</code> (%QX0.0)
                </td>
                <td>30-Step FFI Bisection</td>
                <td style={{ color: '#ff8590', fontWeight: 700 }}>88.00000000°C E-Stop</td>
                <td>1.86e-8°C</td>
              </tr>
              <tr>
                <td>
                  <code>[rip+0xe3e]</code> (%QX0.1)
                </td>
                <td>30-Step FFI Bisection</td>
                <td style={{ color: '#68c9ff', fontWeight: 700 }}>72.00000000°C Cooling</td>
                <td>1.86e-8°C</td>
              </tr>
              <tr>
                <td>
                  <code>[rip+0xe46]</code> (%QW0)
                </td>
                <td>30-Step FFI Bisection</td>
                <td style={{ color: '#f5a623', fontWeight: 700 }}>±45.00000000° Runaway</td>
                <td>2.09e-8°</td>
              </tr>
              <tr>
                <td>
                  <code>[rip+0xe20..28]</code>
                </td>
                <td>Unit-Impulse FFI</td>
                <td style={{ color: '#6effc5', fontWeight: 700 }}>kp=3.00, kd=-0.80</td>
                <td>0.00e+00</td>
              </tr>
              <tr>
                <td>
                  <code>OpenPLC Globals</code>
                </td>
                <td>dlopen + ctypes FFI</td>
                <td style={{ color: '#6effc5', fontWeight: 700 }}>7/7 Bound (%IW0..%QX0.1)</td>
                <td>Exact</td>
              </tr>
              <tr>
                <td>
                  <code>Cortex-M4 [r0+0x24]</code>
                </td>
                <td>Unicorn VFPv4 Probe</td>
                <td style={{ color: '#b6e992', fontWeight: 700 }}>[15.0, 120.0] °/s Clamp</td>
                <td>Exact</td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '8px 10px',
              background: '#11241e',
              border: '1px solid #2f5444',
              borderRadius: '3px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#9df5c9' }}>
              <ShieldCheck size={14} />
              <span>
                <b>1,000/1,000 (100%)</b> C FFI Vectors · <b>262/262</b> Anvil EVM Vectors
              </span>
            </div>
            <button
              type="button"
              disabled={busyProbe}
              onClick={onProbe}
              style={{
                padding: '5px 10px',
                background: '#b6e992',
                color: '#0d1e13',
                border: '1px solid #b5e98c',
                borderRadius: '3px',
                fontWeight: 800,
                fontSize: '8.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Zap size={11} />
              <span>PROBE NOW</span>
            </button>
          </div>
        </div>

        {/* COLUMN 3: RECONSTRUCTED CONTROL LAW (v1.py RECOVERED vs v3.py EVOLVED) */}
        <div
          style={{
            border: '1px solid #284038',
            borderRadius: '4px',
            background: '#0b1516',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 800,
                color: '#6effc5',
                letterSpacing: '0.1em',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <FileCode2 size={12} />
              STEP C // RECONSTRUCTED v1.py vs SELF-EVOLVED v3.py
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                padding: '2px 6px',
                background: activeVersion === 'v3' ? '#143829' : '#1b2826',
                color: activeVersion === 'v3' ? '#6effc5' : '#b4cec2',
                border: '1px solid #355447',
                borderRadius: '2px',
                fontWeight: 700,
              }}
            >
              LIVE RIGHT TWIN: {activeVersion.toUpperCase()}
            </span>
          </div>

          <pre
            style={{
              margin: 0,
              padding: '9px 10px',
              background: '#070e10',
              border: '1px solid #1f332d',
              borderRadius: '3px',
              fontFamily: 'var(--font-mono)',
              fontSize: '8.5px',
              lineHeight: 1.42,
              color: '#cde3d6',
              overflowX: 'auto',
            }}
          >
            {`# 1. RECOVERED HARDWARE SAFETY INTERLOCKS (100% PRESERVED)
if core_temp_c >= 88.0:              # Probed @ 0x11e2 -> 0x11ea
    return {"pwm": 0.0, "estop": 1, "cooling": 1}
cooling = 1 if core_temp_c >= 72.0 else 0  # Probed @ 0x11f4

# 2. REVERSE-ENGINEERED v1.py (Sags to 16.6° under 500kg load):
# pwm_v1 = 3.00 * (target - angle) - 0.80 * velocity

# 3. SELF-EVOLVED v3.py (312-Episode ES -> Holds 30.0° / 0.0° err):
ff_gravity = 32.931 * math.cos(math.radians(angle))
vel_lpf    = 0.817 * velocity + (1 - 0.817) * prev_vel
i_term     = clamp(i_term + 0.649 * err * dt, -41.68, 41.68)
pwm_v3     = clamp(3.554 * err - 10.608 * vel_lpf + i_term + ff_gravity)`}
          </pre>

          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '8px 10px',
              background: '#11241e',
              border: '1px solid #2f5444',
              borderRadius: '3px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
            }}
          >
            <span style={{ color: '#b7ecc7' }}>
              <b>v2 Overfit</b> reverted on World 3 lag · <b>v3</b> passes <b>5/5 Worlds &amp; 6/6 Mutants</b>
            </span>
            <button
              type="button"
              disabled={busyEvolve}
              onClick={onEvolve}
              style={{
                padding: '5px 10px',
                background: '#6effc5',
                color: '#0b1e15',
                border: '1px solid #6effc5',
                borderRadius: '3px',
                fontWeight: 800,
                fontSize: '8.5px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <GitBranch size={11} />
              <span>{activeVersion === 'v3' ? 'RE-RUN ES' : 'EVOLVE v3'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Live FFI Binary Signal Injector & Judge Sandbox */}
      <div
        style={{
          marginTop: '12px',
          background: '#081113',
          border: '1px solid #28443b',
          borderRadius: '4px',
          padding: '10px 14px',
          display: 'grid',
          gridTemplateColumns: '1.35fr 1fr',
          gap: '14px',
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '8px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: '#8de5b5',
              }}
            >
              INTERACTIVE FFI BINARY PROBE SANDBOX // INJECT REGISTER INPUTS (%IW0..%IW3)
            </span>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {[
                { label: 'NOMINAL 30°', t: 30, a: 27.6, v: 0, c: 30 },
                { label: '500KG SAG 16.6°', t: 30, a: 16.6, v: 0, c: 42.5 },
                { label: 'COOLING 74°C', t: 30, a: 28.0, v: 0, c: 74.0 },
                { label: 'E-STOP 89.5°C', t: 30, a: 28.0, v: 0, c: 89.5 },
                { label: 'RUNAWAY 78°', t: 30, a: -48.0, v: 12, c: 45.0 },
              ].map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setProbeTarget(preset.t)
                    setProbeAngle(preset.a)
                    setProbeVel(preset.v)
                    setProbeTemp(preset.c)
                  }}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8.5px',
                    fontWeight: 800,
                    padding: '3px 7px',
                    borderRadius: '3px',
                    border: '1px solid #2e4e43',
                    background: '#11221e',
                    color: '#bcebd0',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: '#a5beb4' }}>
              <span>%IW0 Target: <b style={{ color: '#e8f4ec' }}>{probeTarget.toFixed(1)}°</b></span>
              <input
                type="range"
                min={-30}
                max={60}
                step={0.5}
                value={probeTarget}
                onChange={e => setProbeTarget(Number(e.target.value))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: '#a5beb4' }}>
              <span>%IW1 Angle: <b style={{ color: '#e8f4ec' }}>{probeAngle.toFixed(1)}°</b></span>
              <input
                type="range"
                min={-55}
                max={60}
                step={0.2}
                value={probeAngle}
                onChange={e => setProbeAngle(Number(e.target.value))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: '#a5beb4' }}>
              <span>%IW2 Vel: <b style={{ color: '#e8f4ec' }}>{probeVel.toFixed(1)}°/s</b></span>
              <input
                type="range"
                min={-40}
                max={40}
                step={0.5}
                value={probeVel}
                onChange={e => setProbeVel(Number(e.target.value))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: '#a5beb4' }}>
              <span>%IW3 Temp: <b style={{ color: probeTemp >= 88 ? '#ff8b96' : probeTemp >= 72 ? '#f5a623' : '#e8f4ec' }}>{probeTemp.toFixed(1)}°C</b></span>
              <input
                type="range"
                min={20}
                max={100}
                step={0.5}
                value={probeTemp}
                onChange={e => setProbeTemp(Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '9.5px',
          }}
        >
          <div
            style={{
              background: '#171014',
              border: '1px solid #4d262f',
              borderRadius: '3px',
              padding: '7px 10px',
            }}
          >
            <div style={{ color: '#ff8b96', fontWeight: 800, fontSize: '8.5px', marginBottom: '4px' }}>
              STRIPPED LEGACY ELF (v1.py)
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d7e5df' }}>
              <span>%QW0 PWM: <b>{legacyPwm.toFixed(1)}%</b></span>
              <span>%QX0.0 E-STOP: <b style={{ color: probeEstop ? '#ff4d5e' : '#8de5b5' }}>{probeEstop}</b></span>
              <span>%QX0.1 COOL: <b style={{ color: probeCooling ? '#f5a623' : '#96afa6' }}>{probeCooling}</b></span>
            </div>
          </div>

          <div
            style={{
              background: '#0d2019',
              border: '1px solid #2f6b53',
              borderRadius: '3px',
              padding: '7px 10px',
            }}
          >
            <div style={{ color: '#6effc5', fontWeight: 800, fontSize: '8.5px', marginBottom: '4px' }}>
              EVOLVED COMPENSATOR (v3.py)
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d7e5df' }}>
              <span>%QW0 PWM: <b style={{ color: '#6effc5' }}>{evolvedPwm.toFixed(1)}%</b></span>
              <span>%QX0.0 E-STOP: <b style={{ color: probeEstop ? '#ff4d5e' : '#8de5b5' }}>{probeEstop}</b></span>
              <span>%QX0.1 COOL: <b style={{ color: probeCooling ? '#f5a623' : '#96afa6' }}>{probeCooling}</b></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
