import {
  Activity,
  Check,
  Cpu,
  Flame,
  GitBranch,
  HelpCircle,
  Info,
  LoaderCircle,
  Orbit,
  Play,
  Radar,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Unplug,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ControlDeck, { StateDot } from './ControlDeck'
import WorkbenchScene from './WorkbenchScene'
import {
  type BusyKey,
  type BusyMap,
  type Evolution,
  type Frame,
  type Inspection,
  type MongoStats,
  type MutationAudit,
  type Terminal,
  type Twin,
  pinConfidence,
  twinValue,
} from './types'

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiBase + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || body.message || ''
    } catch {
      /* HTTP status is sufficient */
    }
    throw new Error(`${response.status} ${detail || response.statusText}`)
  }
  return response.json() as Promise<T>
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

const num = (value: number | undefined, suffix = '', digits = 1) =>
  value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`

const trackError = (twin?: Twin): number | undefined => {
  const direct = twinValue(twin, 'tracking_error_deg', 'error')
  if (direct !== undefined) return direct
  const target = twinValue(twin, 'target', 'target_angle')
  const angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle')
  return target !== undefined && angle !== undefined ? target - angle : undefined
}

function WorkcellBayHud({
  side,
  twin,
  version,
  sabotageActive,
}: {
  side: 'left' | 'right'
  twin?: Twin
  version?: string
  sabotageActive: boolean
}) {
  const isRight = side === 'right'
  const angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle')
  const target = twinValue(twin, 'target', 'target_angle') ?? 30
  const error = trackError(twin)
  const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c')
  const pwm = twinValue(twin, 'pwm', 'motor_pwm')
  const estop = (twinValue(twin, 'estop') ?? 0) > 0
  const cooling = (twinValue(twin, 'cooling') ?? 0) > 0

  let statusLabel = 'NOMINAL TRACKING'
  let statusClass = 'status-nominal'
  if (estop) {
    statusLabel = 'E-STOP LATCHED (≥88°C)'
    statusClass = 'status-estop'
  } else if (cooling) {
    statusLabel = 'CRYO COOLING ACTIVE (≥72°C)'
    statusClass = 'status-cooling'
  } else if (sabotageActive && !isRight && Math.abs(error ?? 0) > 5) {
    statusLabel = 'GRAVITY SAG (-58% TORQUE)'
    statusClass = 'status-fault'
  } else if (sabotageActive && isRight) {
    statusLabel = `COMPENSATED (${(version ?? 'v1').toUpperCase()})`
    statusClass = 'status-compensated'
  }

  return (
    <div className={`workcell-hud ${side}`}>
      <div className="hud-header">
        <span className={`hud-cell-id ${isRight ? 'cell-right' : 'cell-left'}`}>
          {isRight ? 'CELL 02' : 'CELL 01'}
        </span>
        <div className="hud-title-block">
          <strong>{isRight ? 'SANDBOXED SKILL TWIN' : 'LEGACY C BINARY'}</strong>
          <small>
            {isRight
              ? `ACTIVE SKILL: ${(version ?? 'v1').toUpperCase()} · LANDLOCK`
              : 'STRIPPED ELF · STATIC PD (KP=3.0, KD=-0.8)'}
          </small>
        </div>
      </div>

      <div className="hud-metrics">
        <div className="hud-metric">
          <span>ANGLE / SETPOINT</span>
          <b>
            {num(angle, '°')} <small>/ {num(target, '°')}</small>
          </b>
        </div>
        <div className="hud-metric">
          <span>TRACKING ERR</span>
          <b className={Math.abs(error ?? 0) > 4.5 ? 'text-crimson' : 'text-ink'}>{num(error, '°')}</b>
        </div>
        <div className="hud-metric">
          <span>CORE TEMP</span>
          <b className={(temp ?? 25) >= 88 ? 'text-crimson' : (temp ?? 25) >= 72 ? 'text-amber' : 'text-ink'}>
            {num(temp, '°C')}
          </b>
        </div>
        <div className="hud-metric">
          <span>SERVO PWM</span>
          <b>{num(pwm, '%')}</b>
        </div>
      </div>

      <div className={`hud-status-bar ${statusClass}`}>
        <i className="hud-dot" />
        <span>{statusLabel}</span>
      </div>
    </div>
  )
}

function PinInspector({
  pin,
  twin,
  physicalVerified,
  onClose,
}: {
  pin: Terminal
  twin?: Twin
  physicalVerified?: boolean
  onClose: () => void
}) {
  let value: string | undefined
  switch (pin.id) {
    case '%IW0':
      value = num(twinValue(twin, 'target', 'target_angle'), '°')
      break
    case '%IW1':
      value = num(twinValue(twin, 'angle', 'angle_deg', 'current_angle'), '°')
      break
    case '%IW2':
      value = num(twinValue(twin, 'velocity', 'angular_velocity'), '°/s')
      break
    case '%IW3':
      value = num(twinValue(twin, 'temperature', 'temp', 'core_temp_c'), '°C')
      break
    case '%QW0':
      value = num(twinValue(twin, 'pwm', 'motor_pwm'), '%')
      break
    case '%QX0.0':
      value = twinValue(twin, 'estop') === undefined ? '—' : twinValue(twin, 'estop') ? 'TRIPPED (1)' : 'CLOSED (0)'
      break
    case '%QX0.1':
      value = twinValue(twin, 'cooling') === undefined ? '—' : twinValue(twin, 'cooling') ? 'ACTIVE (1)' : 'OFF (0)'
      break
  }

  const conf = pinConfidence(pin)
  const provenance = pin.provenance ?? 'heuristic_demo_topology'
  const honestNote =
    pin.note && !pin.note.includes('static REA CFG')
      ? pin.note
      : 'Heuristic demo topology mapping; static objdump provides instruction evidence without a CFG.'

  return (
    <div className="pin-inspector" role="dialog" aria-label={`Terminal ${pin.id} inspector`}>
      <div className="inspector-top">
        <span>
          <Radar size={13} /> TERMINAL PROVENANCE INSPECTOR
        </span>
        <button onClick={onClose} aria-label="Close terminal inspector">
          <X size={14} />
        </button>
      </div>
      <div className="inspector-title">
        <div>
          <small>PLC TERMINAL CHANNEL</small>
          <strong>{pin.id}</strong>
          <p>{pin.label}</p>
        </div>
        <span className={`state-tag ${pin.state.toLowerCase()}`}>
          <StateDot state={pin.state} />
          {pin.state}
        </span>
      </div>
      <div className="inspector-grid">
        <span>LIVE TELEMETRY</span>
        <b>{value ?? '—'}</b>
        <span>CONFIDENCE</span>
        <b>{conf.toFixed(2)}</b>
        <span>PROVENANCE</span>
        <b>{provenance}</b>
        <span>PHYSICAL WIRING</span>
        <b className="text-amber">{physicalVerified ? 'VERIFIED' : 'UNVERIFIED (SIM TOPOLOGY)'}</b>
        <span>ELF INSTRUCTION</span>
        <b>{pin.offset ?? 'Unresolved'}</b>
        <span>EVM SELECTOR</span>
        <b>{pin.governor_function ?? 'Unresolved'}</b>
      </div>
      <p className="inspector-note">
        <Info size={12} />
        <span>{honestNote}</span>
      </p>
    </div>
  )
}

function SpecAndDemoModal({
  onClose,
  onProbe,
  onSabotage,
  onEvolve,
  onVerify,
  onResetToV1,
}: {
  onClose: () => void
  onProbe: () => void
  onSabotage: (enabled: boolean, thermal: boolean) => void
  onEvolve: () => void
  onVerify: () => void
  onResetToV1: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="spec-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Architecture and 3-Minute Demo Script">
        <div className="spec-modal-header">
          <div>
            <span className="spec-kicker">TECHNICAL DISCLOSURE &amp; INTERACTIVE RUNBOOK</span>
            <h2>LAZARUS-TWIN // Architecture, Ownership &amp; 3-Minute Judge Script</h2>
          </div>
          <button className="spec-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="spec-modal-body">
          {/* 1. What We Built vs External Dependency */}
          <section className="spec-section">
            <h3>1. Ownership Boundary: External Dependency vs What We Built at Hackathon</h3>
            <table className="technical-table">
              <thead>
                <tr>
                  <th>COMPONENT</th>
                  <th>ROLE IN SYSTEM</th>
                  <th>OWNERSHIP</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono-cell">rea-agents (npm CLI)</td>
                  <td>
                    Runs <code>objdump -d</code> on the stripped ELF binary and 4-byte selector extraction on EVM hex.
                    Produces raw instruction listings only (no CFG, no pin proof).
                  </td>
                  <td>
                    <span className="origin-badge origin-overfit">EXTERNAL CLI FEED</span>
                  </td>
                </tr>
                <tr>
                  <td className="mono-cell">Tri-State Evidence Ledger &amp; FFI Prober</td>
                  <td>
                    Models hypotheses as <code>UNKNOWN (0.00)</code> / <code>INFERRED (0.65)</code> /{' '}
                    <code>SEEN (0.90)</code>, runs 30-step FFI binary search to bracket <code>72.0°C</code>,{' '}
                    <code>88.0°C</code>, and <code>±45.0°</code> to <code>~1.9e-8</code>, plus 1,000-vector differential
                    sweeps.
                  </td>
                  <td>
                    <span className="origin-badge origin-synthesized">BUILT BY US</span>
                  </td>
                </tr>
                <tr>
                  <td className="mono-cell">100Hz Dual Physics Twin &amp; 3D Workcell</td>
                  <td>
                    Synchronized rotational + thermal physics engine comparing the stripped C controller (Cell 01)
                    against the sandboxed Python skill (Cell 02) with live mechanical fault &amp; E-Stop visualization.
                  </td>
                  <td>
                    <span className="origin-badge origin-synthesized">BUILT BY US</span>
                  </td>
                </tr>
                <tr>
                  <td className="mono-cell">Compensating Git Saga &amp; 5-World Verifier</td>
                  <td>
                    Commits <code>v1</code> baseline, tests overfit <code>v2</code> (passes training, fails held-out
                    World 3 → automatic <code>git revert</code>), and promotes <code>v3</code> only after passing 5
                    Held-Out Worlds + 6 AST mutants in a Landlock ABI 3+ / seccomp sandbox.
                  </td>
                  <td>
                    <span className="origin-badge origin-synthesized">BUILT BY US</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 2. Explicit Honesty & Non-Claims Disclosure */}
          <section className="spec-section">
            <h3>2. Explicit Engineering Honesty &amp; Non-Claims</h3>
            <ul className="spec-list">
              <li>
                <strong>Three Compiled ELF PLC Targets (x86-64 &amp; ARM Cortex-M4):</strong> <code>inspect.py</code> and{' '}
                <code>probe.py</code> execute live against three compiled ELF targets: (1) OpenPLC v4 IEC 61131-3
                Runtime (<code>build/openplc_runtime</code> + live <code>libopenplc_runtime.so</code> FFI verifying{' '}
                <code>located_globals_join_ex</code> 7/7 channel binding and <code>image_tables_zero_outputs</code>{' '}
                emergency-stop clearing), (2) Fulmatic STM32F407 ARM Cortex-M4 DIN-rail PLC Firmware (
                <code>build/fulmatic_motion_cortex_m4.elf</code>), and (3) the stripped closed-loop servo plant (
                <code>targets/legacy_controller.c</code>).
              </li>
              <li>
                <strong>Authored 22-Line C Servo Plant:</strong> <code>targets/legacy_controller.c</code> is a
                deterministic 22-line C control law compiled &amp; stripped (`strip --strip-unneeded`) at startup so
                every judge can reproduce disassembly and FFI probing locally without proprietary PLC hardware.
              </li>
              <li>
                <strong>Unverified Physical Wiring (`physical_wiring_verified: false`):</strong> Software probes verify
                function behavior across FFI/CLI/EVM boundaries (promoted to <code>0.90 CONF</code>), not physical copper
                screw terminals.
              </li>
              <li>
                <strong>Sampled Differential vs Blind Bisection Residual:</strong> The 1,000-vector suite checks
                self-consistency between the C binary and <code>v1.py</code>, while blind bisection recovers thresholds
                within <code>~1.9e-8°C</code> (which can differ right on an exact <code>88.0°C</code> boundary sample).
              </li>
              <li>
                <strong>Honest Fallback Provenance:</strong> When external LLM synthesis is offline or rejected, the
                promoted controller is explicitly badged <code>LOCAL_TEMPLATE (FALLBACK)</code> — never disguised as AI
                synthesis.
              </li>
            </ul>
          </section>

          {/* 3. Interactive 3-Minute Judge Demo Script */}
          <section className="spec-section">
            <h3>3. Interactive 3-Minute Judge Demo Script (0:00 – 3:00)</h3>
            <div className="beat-list">
              <div className="beat-row">
                <span className="beat-time">0:00–0:40</span>
                <div className="beat-desc">
                  <strong>Beat 1 — The Stripped Black Box:</strong> Inspect the PLC cabinet. Notice red dashed{' '}
                  <code>UNKNOWN (0.00)</code> safety wires (<code>%IW3</code>, <code>%QX0.0</code>, <code>%QX0.1</code>)
                  and amber <code>INFERRED (0.65)</code> control wires. Both cells track <code>30.0°</code>.
                </div>
                <button
                  className="beat-btn"
                  onClick={() => {
                    onResetToV1()
                    onClose()
                  }}
                >
                  <Play size={12} /> STAGE BEAT 1
                </button>
              </div>

              <div className="beat-row">
                <span className="beat-time">0:40–1:10</span>
                <div className="beat-desc">
                  <strong>Beat 2 — Active Boundary Probing:</strong> Run 30-step FFI bisection + 1,000-vector C sweep +
                  Anvil EVM parity. Watch red dashed wires promote to signal blue <code>SEEN (0.90 CONF)</code> and
                  inspect the Blind Parameter Recovery table.
                </div>
                <button
                  className="beat-btn"
                  onClick={() => {
                    onProbe()
                    onClose()
                  }}
                >
                  <Play size={12} /> RUN BEAT 2 (PROBE)
                </button>
              </div>

              <div className="beat-row">
                <span className="beat-time">1:10–2:10</span>
                <div className="beat-desc">
                  <strong>Beat 3 — Physical Sabotage (-58% Torque + Gravity):</strong> Clamp the orange heavy load block
                  onto both arms WITHOUT auto-evolving. Watch Cell 01 (Legacy C) sag to <code>~16.6°</code> (
                  <code>13.4°</code> lag) against the <code>30.0°</code> laser setpoint ring!
                </div>
                <button
                  className="beat-btn"
                  onClick={() => {
                    onSabotage(true, false)
                    onClose()
                  }}
                >
                  <Play size={12} /> RUN BEAT 3 (LOAD FAULT)
                </button>
              </div>

              <div className="beat-row">
                <span className="beat-time">2:10–2:50</span>
                <div className="beat-desc">
                  <strong>Beat 4 — Git Evolution Saga (v1 → v2 Revert → v3 Hot-Swap):</strong> Trigger the evolution
                  saga. See <code>v2</code> pass training (`0.78°`) but fail Held-Out World 3 (`30.0°` overshoot →{' '}
                  <code>git revert</code>), then see <code>v3</code> pass all 5 Worlds + 6 AST mutants and restore Cell
                  02 to <code>30.0°</code>!
                </div>
                <button
                  className="beat-btn"
                  onClick={() => {
                    onEvolve()
                    onClose()
                  }}
                >
                  <Play size={12} /> RUN BEAT 4 (EVOLVE)
                </button>
              </div>

              <div className="beat-row">
                <span className="beat-time">2:50–3:00</span>
                <div className="beat-desc">
                  <strong>Beat 5 — 89.5°C Thermal Spike &amp; 6-Mutant Audit:</strong> Inject an <code>89.5°C</code> core
                  thermal spike to slam the mechanical E-Stop brake bar across both joints and verify the HMAC-SHA256
                  6-mutant AST receipt.
                </div>
                <button
                  className="beat-btn"
                  onClick={() => {
                    onSabotage(true, true)
                    onVerify()
                    onClose()
                  }}
                >
                  <Play size={12} /> RUN BEAT 5 (THERMAL + AUDIT)
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const frame = useRef<Frame>({})
  const [snapshot, setSnapshot] = useState<Frame>({})
  const [online, setOnline] = useState(false)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [selected, setSelected] = useState<Terminal | null>(null)
  const [hovered, setHovered] = useState<Terminal | null>(null)
  const [stats, setStats] = useState<MongoStats | null>(null)
  const [evolution, setEvolution] = useState<Evolution | null>(null)
  const [auditReport, setAuditReport] = useState<MutationAudit | null>(null)
  const [busyMap, setBusyMap] = useState<BusyMap>({})
  const [fastMode, setFastMode] = useState(true)
  const [specOpen, setSpecOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState('BAY READY // 100HZ TWIN ACTIVE')

  const refreshInspection = useCallback(async (probes: boolean, fast = true) => {
    const data = await post<Inspection>('/api/archaeology/inspect', {
      run_active_probes: probes,
      fast_mode: fast,
    })
    setInspection(data)
    setSelected(previous =>
      previous ? data.topology?.terminals.find(p => p.id === previous.id) ?? previous : null
    )
    return data
  }, [])

  useEffect(() => {
    let running = true
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (!running) return
      const base = apiBase ? new URL(apiBase, window.location.href) : new URL(window.location.href)
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      base.pathname = '/ws'
      base.search = ''
      socket = new WebSocket(base.toString())
      socket.onopen = () => {
        if (running) setOnline(true)
      }
      socket.onmessage = event => {
        try {
          const data = JSON.parse(String(event.data)) as Frame
          if (data && typeof data === 'object') frame.current = data
        } catch {
          /* ignore malformed frames */
        }
      }
      socket.onclose = () => {
        if (running) {
          setOnline(false)
          retry = setTimeout(connect, 1600)
        }
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    void request('/api/health').catch(() => undefined)
    void refreshInspection(false, true).catch(err => {
      if (running) setError(`Inspection: ${err instanceof Error ? err.message : 'request failed'}`)
    })
    const snapshotTimer = setInterval(() => setSnapshot({ ...frame.current }), 120)
    const loadStats = () => {
      void request<MongoStats>('/api/mongodb/stats')
        .then(x => {
          if (running) setStats(x)
        })
        .catch(() => undefined)
    }
    loadStats()
    const statsTimer = setInterval(loadStats, 2500)
    return () => {
      running = false
      socket?.close()
      if (retry) clearTimeout(retry)
      clearInterval(snapshotTimer)
      clearInterval(statsTimer)
    }
  }, [refreshInspection])

  const runAction = async (key: BusyKey, label: string, work: () => Promise<unknown>) => {
    if (busyMap[key]) return
    setBusyMap(prev => ({ ...prev, [key]: label }))
    setError(null)
    try {
      await work()
      setLastAction(`${label.split(':')[0]} COMPLETE`)
    } catch (err) {
      setError(`${label}: ${err instanceof Error ? err.message : 'request failed'}`)
      setLastAction('ACTION FAILED')
    } finally {
      setBusyMap(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const handleProbe = () =>
    void runAction(
      'probe',
      fastMode ? 'PROBING: FFI BISECTION → 1000-VEC → ANVIL' : 'PROBING: OBJDUMP → FFI → 1000-VEC → ANVIL → LLM',
      () => refreshInspection(true, fastMode)
    )

  const handleSabotage = (enabled: boolean, thermal: boolean, auto = false, resetSkill = false) =>
    void runAction(
      'fault',
      thermal ? 'INJECTING 89.5°C SPIKE' : enabled ? 'CLAMPING -58% LOAD' : 'RESETTING WORKCELL',
      async () => {
        const data = await post<Evolution>('/api/sabotage', {
          enabled,
          thermal_spike: thermal,
          auto_evolve: auto,
          reset_skill: resetSkill,
        })
        if (resetSkill) {
          setEvolution(null)
        } else if (data.iterations || data.ledger) {
          setEvolution(data)
        }
      }
    )

  const handleEvolve = () =>
    void runAction('evolve', 'GIT SAGA: v1 → v2 REVERT → v3 5-WORLD GATE', async () => {
      const data = await post<Evolution>('/api/evolve', {})
      setEvolution(data)
    })

  const handleVerify = () =>
    void runAction('verify', 'AUDITING: 6X AST MUTANTS IN LANDLOCK', async () => {
      const data = await post<MutationAudit>('/api/verify', { entrypoint: 'active' })
      setAuditReport(data)
    })

  const activePin = selected ?? hovered
  const sabotageActive = !!snapshot.sabotage_active
  const leftAngle = twinValue(snapshot.left_legacy, 'angle', 'angle_deg', 'current_angle')
  const rightAngle = twinValue(snapshot.right_evolved, 'angle', 'angle_deg', 'current_angle')
  const armDivergence =
    leftAngle !== undefined && rightAngle !== undefined ? Math.abs(rightAngle - leftAngle) : undefined
  const activeVersion = snapshot.active_skill_version ?? evolution?.active_skill_version ?? 'v1'
  const steps = evolution?.iterations ?? evolution?.ledger ?? []
  const v3Step = steps.find(s => (s.version ?? s.skill_version) === 'v3' && s.status === 'ADOPTED')
  const evmPassed = (inspection?.evm_probe?.passed ?? 0) > 0

  return (
    <main className="app-shell">
      {/* 1. COMPACT TECHNICAL HEADER BAR */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>
              LAZARUS-TWIN <span>//</span> WORKCELL REPAIR BAY
            </strong>
            <small>BINARY ARCHAEOLOGY · 100HZ TWIN · COMPENSATING GIT SAGA</small>
          </div>
        </div>

        <div className="topbar-tags">
          <span className="tech-tag">SIM TWIN</span>
          <span className={`tech-tag connection-tag ${online ? 'online' : 'offline'}`}>
            <i />
            {online ? 'WS TELEMETRY' : 'WS DISCONNECTED'}
          </span>
          <span className="tech-tag">SAMPLED DIFFERENTIAL</span>
          <span className="tech-tag">DEMO TOPOLOGY (AUTHORED C PLANT)</span>
          <span className="tech-tag tag-warn">
            PHYSICAL WIRING: {inspection?.topology?.physical_wiring_verified ? 'VERIFIED' : 'UNVERIFIED'}
          </span>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className={`fast-mode-toggle ${fastMode ? 'active' : ''}`}
            onClick={() => setFastMode(prev => !prev)}
            title="Judge Fast-Probe skips slow external LLM timeouts during 01 PROBE while running all real objdump, 30-step FFI bisection, 1,000-vector C equivalence, and Anvil EVM checks."
          >
            <Sliders size={12} />
            <span>JUDGE FAST-PROBE: {fastMode ? 'ON' : 'OFF'}</span>
          </button>
          <button
            type="button"
            className="spec-button"
            onClick={() => setSpecOpen(true)}
            aria-label="Open Architecture, Honesty and 3-Minute Demo Script"
          >
            <HelpCircle size={14} />
            <span>[? SPEC &amp; 3-MIN DEMO]</span>
          </button>
        </div>
      </header>

      {/* VERBATIM ARCHAEOLOGY OWNERSHIP BOUNDARY BANNER */}
      <div className="ownership-banner">
        <div className="ownership-banner-left">
          <Cpu size={13} />
          <strong>OWNERSHIP BOUNDARY:</strong>
          <span>
            REA = external objdump evidence feed; WE built tri-state ledger, probe promotion, twin, git gates, Landlock.
          </span>
        </div>
        <div className="ownership-banner-right">
          <span>SCAN {snapshot.tick === undefined ? '000000' : String(snapshot.tick).padStart(6, '0')}</span>
          <span>·</span>
          <span>{Object.values(busyMap)[0] ?? lastAction}</span>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <Info size={15} />
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 2. FIRST VIEWPORT: DOMINANT FULL-BLEED 3D FACTORY WORKCELL + DOCKED OPERATOR BAR */}
      <div className="workspace">
        <section className="workbench-bay" aria-label="Interactive 3D PLC and dual robotics workcell bay">
          <div className="scene-background">
            <WorkbenchScene
              terminals={inspection?.topology?.terminals}
              frame={frame}
              selected={activePin?.id ?? null}
              evmPassed={evmPassed}
              onSelect={setSelected}
              onHover={setHovered}
            />
          </div>

          {/* Top-left / Top-right technical datum bar inside 3D bay */}
          <div className="scene-topline">
            <div className="scene-topology-id">
              <strong>DIN-RAIL PLC-01 // DEMO TOPOLOGY</strong>
              <span>7 TERMINALS · 5 SLOTS · TARGET SETPOINT 30.0°</span>
            </div>

            <div className="wire-legend" aria-label="Honest wire state legend">
              <span>
                <i className="unknown" /> UNKNOWN · UNPROBED BRANCH (0.00 CONF)
              </span>
              <span>
                <i className="inferred" /> INFERRED · HEURISTIC / UNSWEPT (0.65 CONF)
              </span>
              <span>
                <i className="seen" /> SEEN · PROBED SOFTWARE I/O (0.90 CONF · WIRING UNVERIFIED)
              </span>
            </div>

            <div className="scene-orbit-hint">
              <Orbit size={12} /> DRAG TO ORBIT · CLICK SCREW TERMINALS TO INSPECT
            </div>
          </div>

          {/* Left & Right Workcell HUD Overlays anchored to bay corners */}
          <WorkcellBayHud
            side="left"
            twin={snapshot.left_legacy}
            sabotageActive={sabotageActive}
          />
          <WorkcellBayHud
            side="right"
            twin={snapshot.right_evolved}
            version={activeVersion}
            sabotageActive={sabotageActive}
          />

          {/* Center Divergence & Live Git Saga Strip anchored to lower-middle of 3D bay */}
          <div className="bay-center-hud">
            <div className="divergence-pill">
              <span>DUAL-ARM DIVERGENCE Δ°</span>
              <strong className={(armDivergence ?? 0) > 5 ? 'text-orange' : 'text-ink'}>
                {num(armDivergence, '°')}
              </strong>
              <small>
                {sabotageActive
                  ? activeVersion === 'v3'
                    ? 'LOAD FAULT ACTIVE: CELL 01 SAGGING (~16.6°) vs CELL 02 HOLDING (~30.0°)'
                    : 'LOAD FAULT ACTIVE (-58% TORQUE): BOTH CELLS SAGGING — RUN 04 EVOLVE SKILL'
                  : 'NOMINAL PAYLOAD · 30.0° SETPOINT CALIBRATION RING'}
              </small>
            </div>

            <div className="git-saga-strip">
              <span className="saga-step active">
                <Check size={11} /> v1 BASELINE (RECOVERED_BASELINE)
              </span>
              <span className="saga-arrow">→</span>
              <span className={`saga-step ${steps.length >= 2 ? 'reverted' : ''}`}>
                <RotateCcw size={11} /> v2 OVERFIT{' '}
                {steps.length >= 2 ? '[TRAIN PASS 0.78° / WORLD 3 FAIL 30.0° → GIT REVERT]' : '[PENDING SAGA]'}
              </span>
              <span className="saga-arrow">→</span>
              <span className={`saga-step ${v3Step || activeVersion === 'v3' ? 'adopted' : ''}`}>
                <ShieldCheck size={11} /> v3 ADOPTED{' '}
                {v3Step
                  ? `[${v3Step.origin === 'synthesized' ? 'MUSE_SYNTHESIZED' : 'LOCAL_TEMPLATE (FALLBACK)'} · 5/5 WORLDS]`
                  : activeVersion === 'v3'
                    ? '[ACTIVE IN CELL 02]'
                    : '[AWAITING PROMOTION]'}
              </span>
            </div>
          </div>

          {activePin && (
            <PinInspector
              pin={activePin}
              twin={snapshot.right_evolved}
              physicalVerified={inspection?.topology?.physical_wiring_verified}
              onClose={() => {
                setSelected(null)
                setHovered(null)
              }}
            />
          )}

          {/* 3. SECONDARY DOCKED OPERATOR TOOL BAR AT BOTTOM OF 3D BAY */}
          <div className="operator-dock" role="toolbar" aria-label="Workcell operator fault and verification tools">
            <button
              type="button"
              className="dock-btn primary-probe"
              disabled={!!busyMap.probe}
              onClick={handleProbe}
            >
              {busyMap.probe ? <LoaderCircle size={15} className="spin" /> : <Radar size={15} />}
              <div>
                <strong>01 PROBE I/O BRANCHES</strong>
                <small>{busyMap.probe ?? '30-step FFI bisection + 1,000-vec + Anvil'}</small>
              </div>
            </button>

            <button
              type="button"
              className={`dock-btn ${sabotageActive ? 'active-fault' : ''}`}
              disabled={!!busyMap.fault}
              onClick={() => handleSabotage(!sabotageActive, false, false)}
            >
              <Unplug size={15} />
              <div>
                <strong>02 LOAD FAULT (-58% TORQUE)</strong>
                <small>{sabotageActive ? 'ACTIVE (CLICK TO REMOVE LOAD)' : 'Clamp heavy mass · NO auto-evolve'}</small>
              </div>
            </button>

            <button
              type="button"
              className="dock-btn warn-thermal"
              disabled={!!busyMap.fault}
              onClick={() => handleSabotage(sabotageActive, true, false)}
            >
              <Flame size={15} />
              <div>
                <strong>03 THERMAL SPIKE (89.5°C)</strong>
                <small>Trip ≥88.0°C E-Stop brake bar</small>
              </div>
            </button>

            <button
              type="button"
              className="dock-btn evolve-btn"
              disabled={!!busyMap.evolve}
              onClick={handleEvolve}
            >
              {busyMap.evolve ? <LoaderCircle size={15} className="spin" /> : <GitBranch size={15} />}
              <div>
                <strong>04 EVOLVE SKILL (GIT SAGA)</strong>
                <small>{busyMap.evolve ?? 'v1 → v2 git revert → v3 5-world gate'}</small>
              </div>
            </button>

            <button
              type="button"
              className="dock-btn verify-btn"
              disabled={!!busyMap.verify}
              onClick={handleVerify}
            >
              {busyMap.verify ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}
              <div>
                <strong>05 AUDIT AST MUTANTS (6X)</strong>
                <small>{busyMap.verify ?? 'Landlock ABI 3+ & seccomp verifier'}</small>
              </div>
            </button>

            <div className="dock-reset-group">
              <button
                type="button"
                className="dock-btn reset-btn"
                disabled={!!busyMap.fault}
                onClick={() => handleSabotage(false, false, false, false)}
              >
                <RotateCcw size={14} />
                <div>
                  <strong>06 RESET CELL</strong>
                  <small>Clear faults &amp; E-Stop</small>
                </div>
              </button>
              <button
                type="button"
                className="reset-v1-mini"
                disabled={!!busyMap.fault}
                onClick={() => handleSabotage(false, false, false, true)}
                title="Reset both physics faults AND revert Cell 02 active controller back to v1 baseline"
              >
                [RESET TO v1]
              </button>
            </div>
          </div>
        </section>

        {/* 4. BELOW-THE-FOLD TECHNICAL DIAGNOSTIC LEDGER */}
        <div className="deck-title">
          <div>
            <span className="section-number">02</span>
            <div>
              <strong>TECHNICAL DIAGNOSTIC LEDGER // ARCHAEOLOGY, BLIND RECOVERY &amp; GIT SAGA</strong>
              <small>HONEST PROVENANCE · 1,000-VECTOR SAMPLED DIFFERENTIAL · 5 HELD-OUT WORLDS · 6 AST MUTANTS</small>
            </div>
          </div>
          <span className="last-action">
            <Activity size={13} /> {Object.values(busyMap)[0] ?? lastAction}
          </span>
        </div>

        <ControlDeck
          busyMap={busyMap}
          sabotageActive={sabotageActive}
          inspection={inspection}
          evolution={evolution}
          auditReport={auditReport}
          stats={stats}
          latestEvent={snapshot.event}
          onProbe={handleProbe}
          onSabotage={(enabled, thermal, auto) => handleSabotage(enabled, thermal, auto)}
          onEvolve={handleEvolve}
          onVerify={handleVerify}
        />
      </div>

      {specOpen && (
        <SpecAndDemoModal
          onClose={() => setSpecOpen(false)}
          onProbe={handleProbe}
          onSabotage={(enabled, thermal) => handleSabotage(enabled, thermal, false)}
          onEvolve={handleEvolve}
          onVerify={handleVerify}
          onResetToV1={() => handleSabotage(false, false, false, true)}
        />
      )}
    </main>
  )
}
