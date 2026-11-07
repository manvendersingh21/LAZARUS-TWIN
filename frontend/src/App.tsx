import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Box,
  CircleDot,
  Cpu,
  FlaskConical,
  Info,
  Orbit,
  Power,
  Radar,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ControlDeck, { StateDot } from './ControlDeck'
import WorkbenchScene from './WorkbenchScene'
import {
  type Evolution,
  type Frame,
  type Inspection,
  type MongoStats,
  type MutationAudit,
  type Terminal,
  type Twin,
  twinValue,
} from './types'

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiBase + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
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
const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })
const num = (value: number | undefined, suffix = '', digits = 1) => (value === undefined ? '—' : `${value.toFixed(digits)}${suffix}`)
const trackError = (twin?: Twin): number | undefined => {
  const direct = twinValue(twin, 'tracking_error_deg', 'error')
  if (direct !== undefined) return direct
  const target = twinValue(twin, 'target', 'target_angle'),
    angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle')
  return target !== undefined && angle !== undefined ? target - angle : undefined
}

function WorkcellLabel({ side, twin, version }: { side: 'left' | 'right'; twin?: Twin; version?: string }) {
  const error = trackError(twin)
  const isRight = side === 'right'
  return (
    <div className={`workcell-label ${side}`}>
      <div className="workcell-head">
        <span className={`workcell-index ${isRight ? 'green' : ''}`}>{isRight ? '02' : '01'}</span>
        <div>
          <strong>{isRight ? 'RECOVERED TWIN' : 'LEGACY CONTROLLER'}</strong>
          <small>{isRight ? `ADAPTIVE / ${version ?? '—'}` : 'STRIPPED BINARY / STATIC'}</small>
        </div>
      </div>
      <div className="workcell-readout">
        <span>TRACKING ERROR</span>
        <b>{num(error, '°')}</b>
        <i>{isRight ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}</i>
      </div>
      <div className="workcell-foot">
        <span>
          <i className={`tiny-led ${twinValue(twin, 'estop') ? 'red' : ''}`} />
          {twin ? (twinValue(twin, 'estop') ? 'E-STOP' : 'ONLINE') : 'AWAITING DATA'}
        </span>
        <span>{num(twinValue(twin, 'temperature', 'temp', 'core_temp_c'), '°C')}</span>
      </div>
    </div>
  )
}

function PinInspector({ pin, twin, onClose }: { pin: Terminal; twin?: Twin; onClose: () => void }) {
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
      value = twinValue(twin, 'estop') === undefined ? '—' : twinValue(twin, 'estop') ? 'TRIPPED' : 'OPEN'
      break
    case '%QX0.1':
      value = twinValue(twin, 'cooling') === undefined ? '—' : twinValue(twin, 'cooling') ? 'ACTIVE' : 'OFF'
      break
  }
  return (
    <div className="pin-inspector">
      <div className="inspector-top">
        <span>
          <Radar size={14} /> X-RAY TERMINAL INSPECTOR
        </span>
        <button onClick={onClose} aria-label="Close terminal inspector">
          <X size={15} />
        </button>
      </div>
      <div className="inspector-title">
        <div>
          <small>CHANNEL</small>
          <strong>{pin.id}</strong>
          <p>{pin.label}</p>
        </div>
        <span className={`state-tag ${pin.state.toLowerCase()}`}>
          <StateDot state={pin.state} />
          {pin.state}
        </span>
      </div>
      <div className="inspector-grid">
        <span>LIVE SIGNAL</span>
        <b>{value ?? '—'}</b>
        <span>INSTRUCTION</span>
        <b>{pin.offset ?? 'Unresolved'}</b>
        <span>GOVERNOR</span>
        <b>{pin.governor_function ?? 'Unresolved'}</b>
      </div>
      {pin.note && (
        <p className="inspector-note">
          <Info size={12} />
          {pin.note}
        </p>
      )}
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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState('SYSTEM READY')

  const refreshInspection = useCallback(async (probes: boolean) => {
    const data = await post<Inspection>('/api/archaeology/inspect', { run_active_probes: probes })
    setInspection(data)
    setSelected(previous => (previous ? data.topology?.terminals.find(p => p.id === previous.id) ?? previous : null))
    return data
  }, [])

  useEffect(() => {
    let running = true,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined
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
    void refreshInspection(false).catch(err => {
      if (running) setError(`Inspection: ${err instanceof Error ? err.message : 'request failed'}`)
    })
    const snapshotTimer = setInterval(() => setSnapshot({ ...frame.current }), 150)
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

  const action = async (name: string, work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(name)
    setError(null)
    try {
      await work()
      setLastAction(name.toUpperCase() + ' COMPLETE')
    } catch (err) {
      setError(`${name}: ${err instanceof Error ? err.message : 'request failed'}`)
      setLastAction('ACTION FAILED')
    } finally {
      setBusy(null)
    }
  }

  const sabotage = (enabled: boolean, thermal: boolean, auto: boolean) =>
    action(thermal ? 'Thermal spike' : enabled ? 'Hardware sabotage' : 'Reset system', async () => {
      const data = await post<Evolution>('/api/sabotage', { enabled, thermal_spike: thermal, auto_evolve: auto })
      if (data.iterations || data.ledger) setEvolution(data)
    })

  const activePin = selected ?? hovered

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>
              LAZARUS<span> / </span>TWIN
            </strong>
            <small>INDUSTRIAL INTELLIGENCE</small>
          </div>
        </div>
        <div className="topbar-center">
          <span>PROJECT 001</span>
          <i /> RECONSTRUCTION WORKBENCH
        </div>
        <div className="topbar-right">
          <span className="demo-tag">ENGINEERING MODE</span>
          <span className={`connection ${online ? 'online' : ''}`}>
            <i />
            {online ? 'LIVE LINK' : 'OFFLINE'}
          </span>
          <div className="avatar">LT</div>
        </div>
      </header>
      <div className="workspace">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">
              <span>01 / WORKBENCH</span>
              <i /> HARDWARE-IN-THE-LOOP
            </div>
            <h1>
              Give the machine <em>a second life.</em>
            </h1>
            <p>Recover, verify, and evolve control logic against a living digital twin.</p>
          </div>
          <div className="heading-meta">
            <span>
              <CircleDot size={14} /> CELL A–01
            </span>
            <span>
              <Cpu size={14} /> CONTROLLER / PLC-01
            </span>
            <button className="icon-button" aria-label="Workbench information" title="Drag to orbit. Hover or click a PLC terminal to inspect.">
              <Info size={17} />
            </button>
          </div>
        </div>
        <section className="workbench" aria-label="Interactive three-dimensional PLC and dual twin workbench">
          <div className="scene-background">
            <WorkbenchScene
              terminals={inspection?.topology?.terminals}
              frame={frame}
              selected={activePin?.id ?? null}
              onSelect={setSelected}
              onHover={setHovered}
            />
          </div>
          <div className="scene-topline">
            <div>
              <span className="scene-cross">✳</span>
              <span>HARDWARE TOPOLOGY</span>
              <i /> <strong>PLC-01</strong>
            </div>
            <div className="scene-badge">
              <span className="pulse-green" /> {online ? 'LIVE SIMULATION' : 'LINK DISCONNECTED'}
            </div>
          </div>
          <div className="scene-instruction">
            <Orbit size={13} /> DRAG TO ORBIT <span>·</span> HOVER OR SELECT A TERMINAL
          </div>
          <div className="wire-legend">
            <span>
              <i className="unknown" /> UNKNOWN
            </span>
            <span>
              <i className="inferred" /> INFERRED
            </span>
            <span>
              <i className="seen" /> SEEN
            </span>
          </div>
          <WorkcellLabel side="left" twin={snapshot.left_legacy} />
          <WorkcellLabel side="right" twin={snapshot.right_evolved} version={snapshot.active_skill_version} />
          <div className="scene-center-divider">
            <span>VS</span>
          </div>
          {activePin && (
            <PinInspector
              pin={activePin}
              twin={snapshot.right_evolved}
              onClose={() => {
                setSelected(null)
                setHovered(null)
              }}
            />
          )}
          <div className="scene-bottomline">
            <span>
              <Box size={13} /> RIGID-BODY WORKCELLS <i /> {snapshot.tick === undefined ? 'WAITING FOR SCAN' : `SCAN ${String(snapshot.tick).padStart(6, '0')}`}
            </span>
            <span>INTERACTIVE 3D MODEL</span>
          </div>
        </section>
        <div className="deck-title">
          <div>
            <span className="section-number">02</span>
            <div>
              <strong>CONTROL DECK</strong>
              <small>COMMANDS &amp; EVIDENCE</small>
            </div>
          </div>
          <span className="last-action">
            <i /> {busy ? `${busy.toUpperCase()} IN PROGRESS` : lastAction}
          </span>
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
        <ControlDeck
          busy={busy}
          sabotageActive={!!snapshot.sabotage_active}
          inspection={inspection}
          evolution={evolution}
          auditReport={auditReport}
          stats={stats}
          latestEvent={snapshot.event}
          onProbe={() => void action('Probe branches', () => refreshInspection(true))}
          onSabotage={(enabled, thermal, auto) => void sabotage(enabled, thermal, auto)}
          onEvolve={() =>
            void action('Evolve skill', async () => {
              const data = await post<Evolution>('/api/evolve', {})
              setEvolution(data)
            })
          }
          onVerify={() =>
            void action('Audit mutants', async () => {
              const data = await post<MutationAudit>('/api/verify', { entrypoint: 'active' })
              setAuditReport(data)
            })
          }
        />
        <footer className="footer">
          <span>
            <Activity size={13} /> LAZARUS-TWIN <i /> RECOVER THE PAST. ENGINEER WHAT&apos;S NEXT.
          </span>
          <span>
            <FlaskConical size={13} /> SIMULATED WORKCELL <i /> <Power size={12} /> ENGINEERING DEMO
          </span>
        </footer>
      </div>
    </main>
  )
}
