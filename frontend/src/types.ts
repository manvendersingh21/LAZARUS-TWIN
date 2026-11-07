export type EvidenceState = 'SEEN' | 'INFERRED' | 'UNKNOWN'

export interface Terminal {
  id: string
  label: string
  slot: number
  state: EvidenceState
  confidence?: number
  provenance?: string
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

export interface PlcPhysicsWorldScore {
  world?: string
  passed?: boolean
  steady_state_error_deg?: number
  peak_overshoot_deg?: number
  peak_velocity_deg_s?: number
  estop?: number
}

export interface PlcPhysicsEngineResult {
  ticks_per_episode?: number
  nominal_steady_error_deg?: number
  nominal_peak_overshoot_deg?: number
  nominal_peak_velocity_deg_s?: number
  held_out_worlds_passed?: number
  held_out_worlds_total?: number
  worlds?: PlcPhysicsWorldScore[]
}

export interface OpenPlcRuntimeTarget {
  evidence_id?: string
  sha256?: string
  arch?: string
  instruction_count?: number
  functions_discovered?: string[]
  sample_instructions?: string[]
}

export interface FulmaticCortexM4Target {
  evidence_id?: string
  core_evidence_id?: string
  sha256?: string
  core_sha256?: string
  arch?: string
  symbol_count?: number
  thumb2_instruction_count?: number
  text_sections?: string[]
  hardware_abi_symbols?: string[]
  sample_instructions?: string[]
}

export interface FulmaticArmProbe {
  target?: string
  sha256?: string
  passed?: boolean
  cpu_model?: string
  function_tested?: string
  recovered_min_velocity?: number
  recovered_max_velocity?: number
  samples?: Record<string, number>
  test_vectors?: Array<{ req: number; out: number }>
  physics_engine?: PlcPhysicsEngineResult
}

export interface PlcTargets {
  openplc_runtime?: OpenPlcRuntimeTarget
  fulmatic_cortex_m4?: FulmaticCortexM4Target
}

export interface OpenPlcFfiProbe {
  target?: string
  sha256?: string
  passed?: boolean
  library_sha256?: string
  capacities?: Record<string, number>
  located_globals_matched?: number
  located_globals_total?: number
  located_globals_indices?: number[]
  zero_outputs_verified?: boolean
  before_zero?: Record<string, number>
  after_zero?: Record<string, number>
  after_zero_outputs?: Record<string, number>
  input_preserved?: number
  physics_engine?: PlcPhysicsEngineResult
}

export interface BlindRecovery {
  recovered_parameters?: {
    cooling_c?: number
    thermal_cutoff_c?: number
    runaway_deg?: number
    runaway_negative_deg?: number
    kp?: number
    kd?: number
    saturation_pwm?: number
  }
  brackets?: Record<string, [number, number] | null>
  residuals_vs_sealed_ground_truth?: {
    cooling_c_abs_err?: number | null
    thermal_cutoff_c_abs_err?: number | null
    runaway_deg_abs_err?: number | null
    kp_abs_err?: number | null
    kd_abs_err?: number | null
  }
  max_boundary_residual?: number | null
  blind_vs_legacy_vectors?: number
  blind_vs_legacy_passed?: number
  blind_vs_legacy_mismatches?: Array<{
    index?: number
    input?: string[]
    legacy?: unknown
    blind_recovered?: unknown
  }>
  scope?: string
}

export interface ProbesData {
  findings?: Evidence[]
  gains?: {
    proportional_sample?: number
    velocity_sample?: number
    scope?: string
  }
  waveform_count?: number
  blind_recovery?: BlindRecovery
  openplc_ffi_probe?: OpenPlcFfiProbe
  fulmatic_arm_probe?: FulmaticArmProbe
}

export interface Inspection {
  artifact?: {
    binary?: string
    library?: string
    sha256?: string
    library_sha256?: string
    plant_provenance?: string
  }
  counts: Record<EvidenceState, number>
  evidence: Evidence[]
  topology: {
    id?: string
    terminals: Terminal[]
    slots: { slot: number; name: string }[]
    provenance?: string
    physical_wiring_verified?: boolean
  }
  plc_targets?: PlcTargets
  openplc_ffi_probe?: OpenPlcFfiProbe
  fulmatic_arm_probe?: FulmaticArmProbe
  equivalence?: {
    passed: number
    vectors: number
    pass_rate: number
    scope?: string
    blind_recovery?: BlindRecovery
  }
  evm_probe?: EvmProbe
  rea?: {
    instruction_count?: number
    evidence_id?: string
    provider?: string
    boundary_note?: string
  }
  we_built?: string[]
  probes?: ProbesData
  fast_mode?: boolean
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
  sabotage_active?: boolean
}

export type ScenarioConfig = {
  id: string
  name: string
  efficiency: number
  gravity: number
  inertia: number
  friction: number
  sensor_lag_s: number
  initial_temp: number
  dt: number
}

export type RecordedSample = {
  tick: number
  time_s: number
  target_deg: number
  left_angle_deg: number
  right_angle_deg: number
  left_err_deg: number
  right_err_deg: number
  left_vel_deg_s: number
  right_vel_deg_s: number
  left_pwm: number
  right_pwm: number
  left_temp_c: number
  right_temp_c: number
  left_estop: number
  right_estop: number
  left_cooling: number
  right_cooling: number
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
  scenario_id?: string
  paused?: boolean
  world?: ScenarioConfig
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
  world?: string | number
  name?: string
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

export type EsGeneration = {
  generation: number
  best_loss: number
  genome: { kp: number; kd: number; ki: number; k_ff: number; alpha_v: number; i_clamp: number }
}

export type EsSearch = {
  algorithm?: string
  generations?: number
  population_size?: number
  episodes_simulated?: number
  steps_per_episode?: number
  stage1_single_world?: { kp: number; kd: number }
  initial_v1_genome?: Record<string, number>
  converged_v3_genome?: Record<string, number>
  initial_loss?: number
  final_loss?: number
  history?: EsGeneration[]
}

export interface EvolutionStep {
  version?: string
  skill_version?: string
  status?: string
  verdict?: string
  result?: string
  origin?: string
  origin_label?: string
  commit?: string
  commit_hash?: string
  revert_commit?: string
  reason?: string
  message?: string
  genome?: Record<string, number> | null
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
  active_origin?: string
  active_origin_label?: string
  es_search?: EsSearch
  memory_recall?: {
    status?: string
    hits?: Array<{ pattern_id?: string; recommended_skill_template?: string; score?: number }>
  }
  synthesis?: { status?: string; provider?: string }
  [key: string]: unknown
}

export type BusyKey = 'probe' | 'fault' | 'evolve' | 'verify'
export type BusyMap = Partial<Record<BusyKey, string>>

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
    case '%IW0':
      return Math.abs(twinValue(t, 'target', 'target_angle') ?? 0) / 90
    case '%IW1':
      return Math.abs(twinValue(t, 'angle', 'angle_deg', 'current_angle') ?? 0) / 90
    case '%IW2':
      return Math.abs(twinValue(t, 'velocity', 'angular_velocity') ?? 0) / 100
    case '%IW3':
      return Math.abs(twinValue(t, 'temperature', 'temp', 'core_temp_c') ?? 0) / 100
    case '%QW0':
      return Math.abs(twinValue(t, 'pwm', 'motor_pwm') ?? 0) / 100
    case '%QX0.0':
      return twinValue(t, 'estop') ?? 0
    case '%QX0.1':
      return twinValue(t, 'cooling') ?? 0
    default:
      return 0
  }
}

export const pinConfidence = (pin: Terminal): number => {
  if (typeof pin.confidence === 'number') return pin.confidence
  if (pin.state === 'SEEN') return 0.9
  if (pin.state === 'INFERRED') return 0.65
  return 0.0
}
