import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  GitBranch,
  LoaderCircle,
  Radar,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Unplug,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import {
  type Evidence,
  type EvidenceState,
  type Evolution,
  type EvolutionStep,
  type Inspection,
  type MongoStats,
  type MutationAudit,
  type VerificationEvent,
} from './types'

const safeText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''))

export function StateDot({ state }: { state: EvidenceState }) {
  return <span className={`state-dot ${state.toLowerCase()}`} />
}

function PanelValue({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="panel-value">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  )
}

function EvidenceRow({ item }: { item: Evidence }) {
  const payload = safeText(item.payload)
  return (
    <div className="evidence-row">
      <StateDot state={item.state} />
      <div>
        <strong>{item.node_id.replace(/_/g, ' ')}</strong>
        <span title={payload}>{payload.length > 88 ? payload.slice(0, 88) + '…' : payload}</span>
      </div>
      <span className={`evidence-code ${item.state.toLowerCase()}`}>{item.state}</span>
    </div>
  )
}

function HeldOutWorlds({ step }: { step: EvolutionStep }) {
  const worlds = step.worlds ?? []
  if (!worlds.length) return null
  return (
    <div className="world-grid">
      {worlds.map((w, idx) => {
        const passed = !!w.passed
        const label = (w.world ?? `world_${idx + 1}`).replace(/_/g, ' ')
        return (
          <div key={label} className={`world-chip ${passed ? 'pass' : 'fail'}`} title={`${label}: err ${w.steady_state_error_deg ?? '—'}°, overshoot ${w.peak_overshoot_deg ?? '—'}°`}>
            <span>W{idx + 1} · {label.slice(0, 14)}</span>
            <b>{passed ? 'PASS' : `FAIL (${w.peak_overshoot_deg?.toFixed(1) ?? '—'}°)`}</b>
          </div>
        )
      })}
    </div>
  )
}

function EvolutionList({ evolution }: { evolution: Evolution | null }) {
  const steps = evolution?.iterations ?? evolution?.ledger ?? []
  if (!steps.length) {
    return (
      <div className="timeline-empty">
        <GitBranch size={18} />
        <div>
          <b>Awaiting an evolution run</b>
          <span>Fault the cell or run the architect to trigger Git evolution across 5 Held-Out Physics Worlds.</span>
        </div>
      </div>
    )
  }
  return (
    <div className="timeline">
      {steps.map((step, i) => {
        const verdict = String(step.verdict ?? step.status ?? step.result ?? '')
        const rollback = /revert|reject|fail/i.test(verdict)
        const version = String(step.version ?? step.skill_version ?? `ITERATION ${i + 1}`)
        const commitHash = String(step.commit ?? step.commit_hash ?? '').slice(0, 8)
        const revertHash = String(step.revert_commit ?? '').slice(0, 8)
        const worldsPassed = step.worlds?.filter(w => w.passed).length
        const worldsTotal = step.worlds?.length
        return (
          <div className="timeline-row" key={`${version}-${i}`}>
            <span className={`timeline-node ${rollback ? 'failed' : ''}`}>{rollback ? <RotateCcw size={12} /> : <Check size={12} />}</span>
            <div style={{ flex: 1 }}>
              <b>
                {version.toUpperCase()} <em>{verdict ? ` / ${verdict.toUpperCase()}` : ''}</em>
                {worldsTotal ? <span className="world-summary">{worldsPassed}/{worldsTotal} WORLDS</span> : null}
              </b>
              <small>
                {String(step.reason ?? step.message ?? (step.training ? `Training err ${step.training.steady_state_error_deg}°` : 'Verified candidate'))}
                {commitHash ? ` · commit ${commitHash}` : ''}
                {revertHash ? ` → git revert ${revertHash}` : ''}
              </small>
              <HeldOutWorlds step={step} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ControlDeck({
  busy,
  sabotageActive,
  inspection,
  evolution,
  auditReport,
  stats,
  latestEvent,
  onProbe,
  onSabotage,
  onEvolve,
  onVerify,
}: {
  busy: string | null
  sabotageActive: boolean
  inspection: Inspection | null
  evolution: Evolution | null
  auditReport: MutationAudit | null
  stats: MongoStats | null
  latestEvent?: VerificationEvent
  onProbe: () => void
  onSabotage: (enabled: boolean, thermal: boolean, auto: boolean) => void
  onEvolve: () => void
  onVerify: () => void
}) {
  const [auditOpen, setAuditOpen] = useState(false)
  const eq = inspection?.equivalence
  const evm = inspection?.evm_probe
  const counts = inspection?.counts
  const priorityEvidence = [...(inspection?.evidence ?? [])]
    .sort((a, b) => ({ UNKNOWN: 0, INFERRED: 1, SEEN: 2 }[a.state] - { UNKNOWN: 0, INFERRED: 1, SEEN: 2 }[b.state]))
    .slice(0, 4)

  const steps = evolution?.iterations ?? evolution?.ledger ?? []
  const latestAudit: MutationAudit | undefined =
    auditReport ?? [...steps].reverse().find(s => s.audit)?.audit
  const topRecall = evolution?.memory_recall?.hits?.[0]

  return (
    <div className="deck-grid">
      <section className="deck-panel operator-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">01 / OPERATOR</span>
            <h2>Test the system</h2>
          </div>
          <div className="panel-icon">
            <Zap size={16} />
          </div>
        </div>
        <p>Introduce faults and watch both controllers respond in real time.</p>
        <button className="action-primary" disabled={!!busy} onClick={onProbe}>
          <Radar size={16} />
          <span>
            Probe unknown branches
            <small>Run active waveform sweeps</small>
          </span>
          {busy === 'Probe branches' ? <LoaderCircle size={16} className="spin" /> : <ArrowUpRight size={16} />}
        </button>
        <div className="action-pair">
          <button disabled={!!busy} onClick={() => onSabotage(true, false, true)}>
            <Unplug size={15} />
            <span>
              Sabotage
              <small>−58% torque + load</small>
            </span>
          </button>
          <button disabled={!!busy} onClick={() => onSabotage(sabotageActive, true, false)}>
            <Thermometer size={15} />
            <span>
              Thermal spike
              <small>Inject 89.5°C</small>
            </span>
          </button>
        </div>
        <div className="secondary-actions">
          <button disabled={!!busy} onClick={onEvolve}>
            <GitBranch size={13} /> EVOLVE SKILL
          </button>
          <button disabled={!!busy} onClick={onVerify}>
            <ShieldCheck size={13} /> AUDIT MUTANTS
          </button>
          <button disabled={!!busy} onClick={() => onSabotage(false, false, false)}>
            <RotateCcw size={13} /> RESET SYSTEM
          </button>
        </div>
      </section>

      <section className="deck-panel evidence-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">02 / ARCHAEOLOGY</span>
            <h2>Evidence ledger</h2>
          </div>
          <span className="evidence-mini">
            <i /> REA
          </span>
        </div>
        <p>From raw instructions to recoverable behavior.</p>
        <div className="evidence-counts">
          {(['SEEN', 'INFERRED', 'UNKNOWN'] as EvidenceState[]).map(state => (
            <div key={state}>
              <span>
                <StateDot state={state} />
                {state}
              </span>
              <b>{counts?.[state] ?? '—'}</b>
            </div>
          ))}
        </div>
        <div className="evidence-list">
          {priorityEvidence.length ? (
            priorityEvidence.map(item => <EvidenceRow key={item.node_id} item={item} />)
          ) : (
            <div className="empty-hint">Awaiting archaeology inspection…</div>
          )}
        </div>
        <div className="certificate">
          <ShieldCheck size={16} />
          <span>
            <strong>DIFFERENTIAL TEST</strong>
            <small>
              {eq ? `${eq.passed} / ${eq.vectors} C vectors` : 'Not yet run'}
              {evm?.passed ? ` · ${evm.passed}/${evm.tested} Anvil EVM` : ''}
            </small>
          </span>
          {eq && <span className="cert-value">{(eq.pass_rate * 100).toFixed(1)}%</span>}
        </div>
        {inspection?.sponsor_analysis && (
          <div className="empty-hint">
            ADVISORY / META {inspection.sponsor_analysis.meta_analysis?.provider?.toUpperCase()} · SUBQ{' '}
            {inspection.sponsor_analysis.subq_unknown_branch_decision?.provider?.toUpperCase()}
          </div>
        )}
      </section>

      <section className="deck-panel evolution-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">03 / SELF-IMPROVEMENT</span>
            <h2>Evolution history</h2>
          </div>
          <div className="panel-icon">
            <GitBranch size={16} />
          </div>
        </div>
        <p>Every candidate is tested across 5 Held-Out Physics Worlds before hot-swap.</p>
        <EvolutionList evolution={evolution} />

        <button
          type="button"
          className="verification-note"
          onClick={() => {
            if (!latestAudit && !busy) onVerify()
            setAuditOpen(prev => !prev)
          }}
        >
          <ShieldCheck size={15} />
          <span>
            ADVERSARIAL VERIFICATION
            {latestAudit ? ` · ${latestAudit.killed}/${latestAudit.total} MUTANTS KILLED` : ''}
          </span>
          {auditOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {auditOpen && (
          <div className="audit-drawer">
            {latestAudit ? (
              <>
                <div className="audit-meta">
                  <span>ISOLATION: {latestAudit.isolation?.filesystem?.toUpperCase() ?? 'LANDLOCK'} / {latestAudit.isolation?.network?.toUpperCase() ?? 'SECCOMP'}</span>
                  <span>KILL RATE: {latestAudit.total ? ((latestAudit.killed ?? 0) / latestAudit.total * 100).toFixed(0) : 100}%</span>
                </div>
                <div className="mutant-grid">
                  {(latestAudit.mutants ?? []).map(m => (
                    <div key={m.mutation} className={`mutant-chip ${m.killed ? 'killed' : 'survived'}`}>
                      {m.killed ? <Check size={11} /> : <X size={11} />}
                      <span>{m.mutation.toUpperCase()}</span>
                      <b>{m.killed ? 'KILLED' : 'LIVE'}</b>
                    </div>
                  ))}
                </div>
                {latestAudit.signature_hmac_sha256 && (
                  <div className="audit-receipt">
                    RECEIPT HMAC-SHA256 / {latestAudit.signature_hmac_sha256.slice(0, 24)}…
                  </div>
                )}
              </>
            ) : (
              <div className="empty-hint">Running 6-mutant AST hardness audit in Landlock/seccomp sandbox…</div>
            )}
          </div>
        )}

        <div className="mongo-card">
          <div className="mongo-head">
            <Database size={15} />
            <strong>MONGODB {stats?.mode === 'atlas' ? 'ATLAS' : stats ? 'LOCAL' : ''}</strong>
            <span className={stats?.mode === 'atlas' ? 'mongo-online' : ''}>
              {stats?.mode === 'atlas' ? 'CONNECTED' : stats ? 'FALLBACK' : 'CHECKING'}
            </span>
          </div>
          <div className="mongo-grid">
            <PanelValue label="TIME SERIES" value={stats?.time_series_points?.toLocaleString() ?? '—'} unit=" pts" />
            <PanelValue label="$GRAPHLOOKUP" value={stats?.graph_nodes_resolved?.toLocaleString() ?? '—'} />
            <PanelValue label="$VECTORSEARCH" value={stats?.vector_hits?.toLocaleString() ?? '—'} />
            <PanelValue label="$CHANGESTREAM" value={stats?.change_events?.toLocaleString() ?? '—'} />
          </div>
          {(stats?.last_vector_match || topRecall?.recommended_skill_template || latestEvent?.status) && (
            <div className="mongo-match">
              {stats?.last_vector_match ? `RECALL / ${stats.last_vector_match}` : ''}
              {topRecall?.recommended_skill_template ? ` · ${topRecall.recommended_skill_template}` : ''}
              {latestEvent?.status ? ` · BUS: ${latestEvent.status}` : ''}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
