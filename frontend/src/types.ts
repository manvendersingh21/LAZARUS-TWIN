export type EvidenceState = 'SEEN' | 'INFERRED' | 'UNKNOWN'
export interface Terminal {
  id: string
  label: string
  slot: number
  state: EvidenceState
  offset?: string | null
  governor_function?: string | null
  parent_node_id?: string | null
  note?: string
}
export interface Evidence {
  node_id: string
  state: EvidenceState
  confidence: number
  payload?: unknown
  source?: string
}
export interface EvmProbe {
  network?: string
  tested?: number
  passed?: number
  trace_steps?: number
}
export interface Inspection {
  counts: Record<EvidenceState, number>
  evidence: Evidence[]
  topology: {
    id?: string
    terminals: Terminal[]
    slots: { slot: number; name: string }[]
    physical_wiring_verified?: boolean
  }
  equivalence?: { passed: number; vectors: number; pass_rate: number }
  evm_probe?: EvmProbe
  rea?: { instruction_count?: number }
  probes?: unknown
  sponsor_analysis?: {
    meta_analysis?: { provider?: string; text?: string }
    subq_unknown_branch_decision?: { provider?: string; probability?: number | null; decision?: boolean }
    advisory_only?: boolean
  }
}
export interface Twin {
  angle?: number
  angle_deg?: number
  current_angle?: number
  target?: number
  target_angle?: number
  velocity?: number
  angular_velocity?: number
  temperature?: number
  temp?: number
  core_temp_c?: number
  pwm?: number
  motor_pwm?: number
  estop?: number | boolean
  cooling?: number | boolean
  tracking_error_deg?: number
  error?: number
}
export interface VerificationEvent {
  type?: string
  job_id?: string
  git_commit_hash?: string
  status?: string
}
export interface Frame {
  tick?: number
  active_skill_version?: string
  left_legacy?: Twin
  right_evolved?: Twin
  sabotage_active?: boolean
  event?: VerificationEvent
}
export interface MongoStats {
  mode?: string
  time_series_points?: number
  graph_nodes_resolved?: number
  vector_hits?: number
  last_vector_match?: string | null
  change_events?: number
  offline_reason?: string | null
}
export interface WorldScore {
  world?: string
  passed?: boolean
  steady_state_error_deg?: number
  peak_overshoot_deg?: number
  estop?: number
}
export interface MutantResult {
  mutation: string
  killed: boolean
  failures?: string[]
}
export interface MutationAudit {
  candidate_sha256?: string
  baseline?: { passed?: boolean; checks?: number; failures?: string[] }
  mutants?: MutantResult[]
  killed?: number
  total?: number
  isolation?: { filesystem?: string; network?: string }
  signature_hmac_sha256?: string
}
export interface EvolutionStep {
  version?: string
  skill_version?: string
  status?: string
  verdict?: string
  result?: string
  origin?: string
  commit?: string
  commit_hash?: string
  revert_commit?: string
  reason?: string
  message?: string
  training?: { steady_state_error_deg?: number; peak_overshoot_deg?: number; passed?: boolean }
  worlds?: WorldScore[]
  audit?: MutationAudit
}
export interface Evolution {
  iterations?: EvolutionStep[]
  ledger?: EvolutionStep[]
  active_skill_version?: string
  active_commit?: string
  revert_commit?: string
  memory_recall?: {
    status?: string
    hits?: Array<{ pattern_id?: string; recommended_skill_template?: string; score?: number }>
  }
  synthesis?: { status?: string; provider?: string }
  [key: string]: unknown
}
export const twinValue = (twin: Twin | undefined, ...keys: (keyof Twin)[]): number | undefined => {
  for (const k of keys) {
    const value = twin?.[k]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'boolean') return value ? 1 : 0
  }
  return undefined
}
export const pinSignal = (pin: Terminal, frame: Frame): number => {
  const t = frame.right_evolved
  switch (pin.id) {
    case '%IW0': return Math.abs(twinValue(t, 'target', 'target_angle') ?? 0) / 90
    case '%IW1': return Math.abs(twinValue(t, 'angle', 'angle_deg', 'current_angle') ?? 0) / 90
    case '%IW2': return Math.abs(twinValue(t, 'velocity', 'angular_velocity') ?? 0) / 100
    case '%IW3': return Math.abs(twinValue(t, 'temperature', 'temp', 'core_temp_c') ?? 0) / 100
    case '%QW0': return Math.abs(twinValue(t, 'pwm', 'motor_pwm') ?? 0) / 100
    case '%QX0.0': return twinValue(t, 'estop') ?? 0
    case '%QX0.1': return twinValue(t, 'cooling') ?? 0
    default: return 0
  }
}
