export type EvidenceState = 'SEEN' | 'INFERRED' | 'UNKNOWN'
export interface Terminal { id: string; label: string; slot: number; state: EvidenceState; offset?: string | null; governor_function?: string | null; note?: string }
export interface Evidence { node_id: string; state: EvidenceState; confidence: number; payload?: unknown; source?: string }
export interface Inspection { counts: Record<EvidenceState, number>; evidence: Evidence[]; topology: { id?: string; terminals: Terminal[]; slots: { slot: number; name: string }[] }; equivalence?: { passed: number; vectors: number; pass_rate: number }; rea?: { instruction_count?: number }; probes?: unknown; sponsor_analysis?: {meta_analysis?: {provider?: string}; subq_unknown_branch_decision?: {provider?: string}; advisory_only?: boolean} }
export interface Twin { angle?: number; angle_deg?: number; current_angle?: number; target?: number; target_angle?: number; velocity?: number; angular_velocity?: number; temperature?: number; temp?: number; core_temp_c?: number; pwm?: number; motor_pwm?: number; estop?: number | boolean; cooling?: number | boolean; tracking_error_deg?: number; error?: number }
export interface Frame { tick?: number; active_skill_version?: string; left_legacy?: Twin; right_evolved?: Twin; sabotage_active?: boolean; event?: unknown }
export interface MongoStats { mode?: string; time_series_points?: number; graph_nodes_resolved?: number; vector_hits?: number; last_vector_match?: string | null; change_events?: number; offline_reason?: string | null }
export interface Evolution { iterations?: Array<Record<string, unknown>>; ledger?: Array<Record<string, unknown>>; [key: string]: unknown }
export const twinValue = (twin: Twin | undefined, ...keys: (keyof Twin)[]): number | undefined => {
  for (const k of keys) { const value = twin?.[k]; if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'boolean') return value ? 1 : 0 }
  return undefined
}
