import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { RecordedSample } from './types'

type SecondaryMode = 'pwm' | 'vel' | 'temp'

const W = 390
const H = 186
const PAD_L = 44
const PAD_R = 12
const PAD_T = 14
const PAD_B = 24
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function mapX(idx: number, count: number): number {
  if (count <= 1) return PAD_L + PLOT_W
  return PAD_L + (idx / (count - 1)) * PLOT_W
}

function mapY(val: number, yMin: number, yMax: number): number {
  const span = yMax - yMin || 1
  const norm = clamp((val - yMin) / span, 0, 1)
  return PAD_T + PLOT_H - norm * PLOT_H
}

function buildPolyline(
  samples: RecordedSample[],
  getter: (s: RecordedSample) => number,
  yMin: number,
  yMax: number,
): string {
  const n = samples.length
  if (n === 0) return ''
  if (n === 1) {
    const y = mapY(getter(samples[0]), yMin, yMax).toFixed(1)
    return `${PAD_L},${y} ${PAD_L + PLOT_W},${y}`
  }
  const pts: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const x = mapX(i, n).toFixed(1)
    const y = mapY(getter(samples[i]), yMin, yMax).toFixed(1)
    pts[i] = `${x},${y}`
  }
  return pts.join(' ')
}

export default function TimeSeriesGraphs({
  samples,
  replayIndex,
  onScrub,
}: {
  samples: RecordedSample[]
  replayIndex: number | null
  onScrub?: (index: number | null) => void
}) {
  const [secondaryMode, setSecondaryMode] = useState<SecondaryMode>('pwm')
  const draggingRef = useRef(false)

  const count = samples.length
  const isReplaying = replayIndex !== null && count > 0
  const activeIdx =
    count === 0
      ? -1
      : replayIndex !== null
        ? clamp(replayIndex, 0, count - 1)
        : count - 1
  const activeSample: RecordedSample | undefined =
    activeIdx >= 0 ? samples[activeIdx] : undefined

  const handlePointerScrub = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!onScrub || count === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const ratio = clamp((svgX - PAD_L) / PLOT_W, 0, 1)
    const idx = Math.round(ratio * Math.max(0, count - 1))
    onScrub(idx)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!onScrub || count === 0) return
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    handlePointerScrub(e)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    handlePointerScrub(e)
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore if pointer capture was already released
    }
  }

  // Dynamic range calculation for Chart 1 (Joint Angle)
  let minAngleObserved = -45
  let maxAngleObserved = 45
  let maxErrObserved = 45
  let maxAbsVel = 60
  for (let i = 0; i < count; i++) {
    const s = samples[i]
    if (s.left_angle_deg < minAngleObserved) minAngleObserved = s.left_angle_deg
    if (s.right_angle_deg < minAngleObserved) minAngleObserved = s.right_angle_deg
    if (s.left_angle_deg > maxAngleObserved) maxAngleObserved = s.left_angle_deg
    if (s.right_angle_deg > maxAngleObserved) maxAngleObserved = s.right_angle_deg
    const lErr = Math.abs(s.left_err_deg)
    const rErr = Math.abs(s.right_err_deg)
    if (lErr > maxErrObserved) maxErrObserved = lErr
    if (rErr > maxErrObserved) maxErrObserved = rErr
    const lVel = Math.abs(s.left_vel_deg_s)
    const rVel = Math.abs(s.right_vel_deg_s)
    if (lVel > maxAbsVel) maxAbsVel = lVel
    if (rVel > maxAbsVel) maxAbsVel = rVel
  }

  const angleYMin = minAngleObserved < -45 ? -90 : -45
  const angleYMax = maxAngleObserved > 45 ? 60 : 45
  const angleTicks =
    angleYMin === -90 ? [-90, -60, -30, 0, 30, 45] : [-45, -22.5, 0, 22.5, 30, 45]

  const errYMin = 0
  const errYMax = maxErrObserved > 45 ? Math.min(120, Math.ceil(maxErrObserved / 15) * 15) : 45
  const errTicks =
    errYMax > 45
      ? [0, Math.round(errYMax * 0.25), Math.round(errYMax * 0.5), Math.round(errYMax * 0.75), errYMax]
      : [0, 10, 20, 30, 45]

  const velBound = Math.max(60, Math.ceil(maxAbsVel / 20) * 20)
  const secondaryConfig =
    secondaryMode === 'pwm'
      ? {
          title: 'ACTUATOR COMMAND (PWM %)',
          unit: '%',
          yMin: -100,
          yMax: 100,
          ticks: [-100, -50, 0, 50, 100],
          leftGetter: (s: RecordedSample) => s.left_pwm,
          rightGetter: (s: RecordedSample) => s.right_pwm,
        }
      : secondaryMode === 'vel'
        ? {
            title: 'ANGULAR VELOCITY (ω)',
            unit: '°/s',
            yMin: -velBound,
            yMax: velBound,
            ticks: [-velBound, -velBound / 2, 0, velBound / 2, velBound],
            leftGetter: (s: RecordedSample) => s.left_vel_deg_s,
            rightGetter: (s: RecordedSample) => s.right_vel_deg_s,
          }
        : {
            title: 'CORE TEMPERATURE (°C)',
            unit: '°C',
            yMin: 20,
            yMax: 100,
            ticks: [20, 40, 60, 72, 88, 100],
            leftGetter: (s: RecordedSample) => s.left_temp_c,
            rightGetter: (s: RecordedSample) => s.right_temp_c,
          }

  const tStart = count > 0 ? samples[0].time_s : 0
  const tEnd = count > 0 ? samples[count - 1].time_s : 0
  const tMid = (tStart + tEnd) * 0.5
  const cursorX = activeIdx >= 0 ? mapX(activeIdx, count) : PAD_L + PLOT_W

  // Precompute polylines
  const angleTargetPoly = buildPolyline(samples, (s) => s.target_deg, angleYMin, angleYMax)
  const angleLeftPoly = buildPolyline(samples, (s) => s.left_angle_deg, angleYMin, angleYMax)
  const angleRightPoly = buildPolyline(samples, (s) => s.right_angle_deg, angleYMin, angleYMax)

  const errLeftPoly = buildPolyline(samples, (s) => Math.abs(s.left_err_deg), errYMin, errYMax)
  const errRightPoly = buildPolyline(samples, (s) => Math.abs(s.right_err_deg), errYMin, errYMax)

  const secLeftPoly = buildPolyline(
    samples,
    secondaryConfig.leftGetter,
    secondaryConfig.yMin,
    secondaryConfig.yMax,
  )
  const secRightPoly = buildPolyline(
    samples,
    secondaryConfig.rightGetter,
    secondaryConfig.yMin,
    secondaryConfig.yMax,
  )

  const targetDegVal = activeSample?.target_deg ?? 30.0
  const leftAngleVal = activeSample?.left_angle_deg ?? 0
  const rightAngleVal = activeSample?.right_angle_deg ?? 0
  const leftErrVal = activeSample ? Math.abs(activeSample.left_err_deg) : 0
  const rightErrVal = activeSample ? Math.abs(activeSample.right_err_deg) : 0
  const leftSecVal = activeSample ? secondaryConfig.leftGetter(activeSample) : 0
  const rightSecVal = activeSample ? secondaryConfig.rightGetter(activeSample) : 0

  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderTop: '2px solid #0f172a',
        padding: '10px 14px 12px',
        fontFamily: "var(--font-sans, 'Space Grotesk', sans-serif)",
        color: '#0f172a',
      }}
    >
      {/* Top Synchronized Strip-Chart Header & Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px 16px',
          paddingBottom: '8px',
          marginBottom: '10px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: "var(--font-display, 'Chakra Petch', sans-serif)",
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: '#0f172a',
              textTransform: 'uppercase',
            }}
          >
            SYNCHRONIZED ENGINEERING TELEMETRY (3-CHANNEL STRIP RECORDER)
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 7px',
              background: isReplaying ? '#fef3c7' : '#f1f5f9',
              border: `1px solid ${isReplaying ? '#f59e0b' : '#cbd5e1'}`,
              color: isReplaying ? '#92400e' : '#334155',
            }}
          >
            {count === 0
              ? 'AWAITING TELEMETRY SAMPLES'
              : isReplaying
                ? `REPLAY SCRUBBING: SAMPLE #${activeIdx + 1}/${count} · t=${(activeSample?.time_s ?? 0).toFixed(2)}s (tick ${activeSample?.tick ?? 0})`
                : `LIVE STREAMING: ${count} SAMPLES · t=${(activeSample?.time_s ?? 0).toFixed(2)}s (tick ${activeSample?.tick ?? 0})`}
          </span>
          {isReplaying && onScrub && (
            <button
              type="button"
              onClick={() => onScrub(null)}
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 8px',
                background: '#0284c7',
                color: '#ffffff',
                border: '1px solid #0369a1',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              RETURN TO LIVE HEAD
            </button>
          )}
        </div>

        {/* Shared Signal Legend */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '10px',
            color: '#334155',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '16px',
                height: '0px',
                borderTop: '2px dashed #10b981',
                display: 'inline-block',
              }}
            />
            <strong style={{ color: '#059669' }}>TARGET (30.0°)</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '16px',
                height: '3px',
                background: '#f97316',
                display: 'inline-block',
              }}
            />
            <strong style={{ color: '#ea580c' }}>LEGACY PLC (LEFT)</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '16px',
                height: '3px',
                background: '#06b6d4',
                display: 'inline-block',
              }}
            />
            <strong style={{ color: '#0891b2' }}>EVOLVED CONTROLLER (RIGHT)</strong>
          </span>
          <span style={{ color: '#64748b' }}>
            [Click or drag any chart to scrub 3D twin trajectory]
          </span>
        </div>
      </div>

      {/* 3 Synchronized SVG Charts Side-by-Side */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '12px',
        }}
      >
        {/* CHART 1: JOINT ANGLE VS TARGET */}
        <div
          style={{
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display, 'Chakra Petch', sans-serif)",
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: '#0f172a',
                }}
              >
                1. JOINT ANGLE vs TARGET (θ in deg)
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: '9.5px',
                  color: '#64748b',
                }}
              >
                Range [{angleYMin}°, +{angleYMax}°] · Setpoint {targetDegVal.toFixed(1)}°
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '6px',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  padding: '2px 5px',
                  background: '#ffedd5',
                  border: '1px solid #fdba74',
                  color: '#c2410c',
                }}
                title="Legacy PLC Joint Angle"
              >
                L: {leftAngleVal.toFixed(1)}°
              </span>
              <span
                style={{
                  padding: '2px 5px',
                  background: '#cffafe',
                  border: '1px solid #67e8f9',
                  color: '#0e7490',
                }}
                title="Autonomously Evolved Controller Joint Angle"
              >
                R: {rightAngleVal.toFixed(1)}°
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{
              width: '100%',
              height: '185px',
              display: 'block',
              cursor: onScrub ? 'ew-resize' : 'default',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Plot Area Background */}
            <rect
              x={PAD_L}
              y={PAD_T}
              width={PLOT_W}
              height={PLOT_H}
              fill="#ffffff"
              stroke="#cbd5e1"
              strokeWidth={1}
            />

            {/* Horizontal Grid Lines & Y-Axis Ticks */}
            {angleTicks.map((tickVal) => {
              const y = mapY(tickVal, angleYMin, angleYMax)
              const isZero = tickVal === 0
              return (
                <g key={tickVal}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={PAD_L + PLOT_W}
                    y2={y}
                    stroke={isZero ? '#cbd5e1' : '#f1f5f9'}
                    strokeWidth={isZero ? 1.1 : 1}
                  />
                  <text
                    x={PAD_L - 5}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#475569"
                  >
                    {tickVal > 0 ? `+${tickVal}°` : `${tickVal}°`}
                  </text>
                </g>
              )
            })}

            {/* Vertical Time Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const x = PAD_L + frac * PLOT_W
              return (
                <line
                  key={frac}
                  x1={x}
                  y1={PAD_T}
                  x2={x}
                  y2={PAD_T + PLOT_H}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
              )
            })}

            {/* Target Angle (30.0 deg) Dashed Emerald Line */}
            {(() => {
              const yTarget = mapY(30.0, angleYMin, angleYMax)
              return (
                <g>
                  {count > 1 ? (
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={1.8}
                      strokeDasharray="5 3"
                      points={angleTargetPoly}
                    />
                  ) : (
                    <line
                      x1={PAD_L}
                      y1={yTarget}
                      x2={PAD_L + PLOT_W}
                      y2={yTarget}
                      stroke="#10b981"
                      strokeWidth={1.8}
                      strokeDasharray="5 3"
                    />
                  )}
                  <text
                    x={PAD_L + 6}
                    y={Math.max(PAD_T + 10, yTarget - 4)}
                    fontSize="8.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#059669"
                  >
                    TARGET 30.0°
                  </text>
                </g>
              )
            })()}

            {/* Legacy PLC Angle (Orange) & Evolved Controller Angle (Cyan) */}
            {count > 0 && (
              <>
                <polyline
                  fill="none"
                  stroke="#f97316"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={angleLeftPoly}
                />
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={angleRightPoly}
                />
              </>
            )}

            {/* Interactive Synchronized Vertical Cursor */}
            {activeSample && (
              <g>
                <line
                  x1={cursorX}
                  y1={PAD_T}
                  x2={cursorX}
                  y2={PAD_T + PLOT_H}
                  stroke={isReplaying ? '#d97706' : '#0f172a'}
                  strokeWidth={isReplaying ? 1.5 : 1}
                  strokeDasharray={isReplaying ? '3 2' : '2 2'}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(activeSample.left_angle_deg, angleYMin, angleYMax)}
                  r={3.6}
                  fill="#f97316"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(activeSample.right_angle_deg, angleYMin, angleYMax)}
                  r={3.6}
                  fill="#06b6d4"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
              </g>
            )}

            {/* Shared Time Axis Labels */}
            <text
              x={PAD_L}
              y={H - 6}
              textAnchor="start"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tStart.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W * 0.5}
              y={H - 6}
              textAnchor="middle"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#475569"
            >
              t = {tMid.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W}
              y={H - 6}
              textAnchor="end"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tEnd.toFixed(1)}s
            </text>
          </svg>
        </div>

        {/* CHART 2: ABSOLUTE ANGULAR TRACKING ERROR */}
        <div
          style={{
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display, 'Chakra Petch', sans-serif)",
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  color: '#0f172a',
                }}
              >
                2. ABSOLUTE TRACKING ERROR (|θ_target - θ|)
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: '9.5px',
                  color: '#64748b',
                }}
              >
                Pass Gate ≤ 2.2° Steady Error · Lower is Better
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '6px',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  padding: '2px 5px',
                  background: leftErrVal > 2.2 ? '#fee2e2' : '#ffedd5',
                  border: `1px solid ${leftErrVal > 2.2 ? '#fca5a5' : '#fdba74'}`,
                  color: leftErrVal > 2.2 ? '#b91c1c' : '#c2410c',
                }}
                title="Legacy Tracking Error |left_err_deg|"
              >
                |e_L|: {leftErrVal.toFixed(2)}°
              </span>
              <span
                style={{
                  padding: '2px 5px',
                  background: rightErrVal <= 2.2 ? '#d1fae5' : '#cffafe',
                  border: `1px solid ${rightErrVal <= 2.2 ? '#6ee7b7' : '#67e8f9'}`,
                  color: rightErrVal <= 2.2 ? '#065f46' : '#0e7490',
                }}
                title="Evolved Tracking Error |right_err_deg|"
              >
                |e_R|: {rightErrVal.toFixed(2)}°
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{
              width: '100%',
              height: '185px',
              display: 'block',
              cursor: onScrub ? 'ew-resize' : 'default',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <rect
              x={PAD_L}
              y={PAD_T}
              width={PLOT_W}
              height={PLOT_H}
              fill="#ffffff"
              stroke="#cbd5e1"
              strokeWidth={1}
            />

            {/* Y-Axis Ticks & Grid Lines */}
            {errTicks.map((tickVal) => {
              const y = mapY(tickVal, errYMin, errYMax)
              return (
                <g key={tickVal}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={PAD_L + PLOT_W}
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 5}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#475569"
                  >
                    {tickVal}°
                  </text>
                </g>
              )
            })}

            {/* Vertical Time Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const x = PAD_L + frac * PLOT_W
              return (
                <line
                  key={frac}
                  x1={x}
                  y1={PAD_T}
                  x2={x}
                  y2={PAD_T + PLOT_H}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
              )
            })}

            {/* 2.2 deg Pass Threshold Line */}
            {(() => {
              const yThresh = mapY(2.2, errYMin, errYMax)
              return (
                <g>
                  <line
                    x1={PAD_L}
                    y1={yThresh}
                    x2={PAD_L + PLOT_W}
                    y2={yThresh}
                    stroke="#dc2626"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={PAD_L + 6}
                    y={Math.max(PAD_T + 10, yThresh - 4)}
                    fontSize="8.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#dc2626"
                  >
                    2.2° MAX STEADY ERROR
                  </text>
                </g>
              )
            })()}

            {/* Error Curves */}
            {count > 0 && (
              <>
                <polyline
                  fill="none"
                  stroke="#f97316"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={errLeftPoly}
                />
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={errRightPoly}
                />
              </>
            )}

            {/* Interactive Synchronized Vertical Cursor */}
            {activeSample && (
              <g>
                <line
                  x1={cursorX}
                  y1={PAD_T}
                  x2={cursorX}
                  y2={PAD_T + PLOT_H}
                  stroke={isReplaying ? '#d97706' : '#0f172a'}
                  strokeWidth={isReplaying ? 1.5 : 1}
                  strokeDasharray={isReplaying ? '3 2' : '2 2'}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(Math.abs(activeSample.left_err_deg), errYMin, errYMax)}
                  r={3.6}
                  fill="#f97316"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(Math.abs(activeSample.right_err_deg), errYMin, errYMax)}
                  r={3.6}
                  fill="#06b6d4"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
              </g>
            )}

            {/* Shared Time Axis Labels */}
            <text
              x={PAD_L}
              y={H - 6}
              textAnchor="start"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tStart.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W * 0.5}
              y={H - 6}
              textAnchor="middle"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#475569"
            >
              t = {tMid.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W}
              y={H - 6}
              textAnchor="end"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tEnd.toFixed(1)}s
            </text>
          </svg>
        </div>

        {/* CHART 3: SELECTABLE SECONDARY TELEMETRY (PWM % / VEL deg/s / TEMP C) */}
        <div
          style={{
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'pwm', label: 'ACTUATOR PWM %' },
                  { id: 'vel', label: 'ANGULAR VEL °/s' },
                  { id: 'temp', label: 'CORE TEMP °C' },
                ] as const
              ).map((tab) => {
                const active = secondaryMode === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSecondaryMode(tab.id)}
                    style={{
                      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                      fontSize: '9.5px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      background: active ? '#0f172a' : '#f1f5f9',
                      color: active ? '#ffffff' : '#475569',
                      border: `1px solid ${active ? '#0f172a' : '#cbd5e1'}`,
                      cursor: 'pointer',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '6px',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  padding: '2px 5px',
                  background: '#ffedd5',
                  border: '1px solid #fdba74',
                  color: '#c2410c',
                }}
              >
                L: {leftSecVal.toFixed(1)}
                {secondaryConfig.unit}
              </span>
              <span
                style={{
                  padding: '2px 5px',
                  background: '#cffafe',
                  border: '1px solid #67e8f9',
                  color: '#0e7490',
                }}
              >
                R: {rightSecVal.toFixed(1)}
                {secondaryConfig.unit}
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{
              width: '100%',
              height: '185px',
              display: 'block',
              cursor: onScrub ? 'ew-resize' : 'default',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <rect
              x={PAD_L}
              y={PAD_T}
              width={PLOT_W}
              height={PLOT_H}
              fill="#ffffff"
              stroke="#cbd5e1"
              strokeWidth={1}
            />

            {/* Y-Axis Ticks & Grid Lines */}
            {secondaryConfig.ticks.map((tickVal) => {
              const y = mapY(tickVal, secondaryConfig.yMin, secondaryConfig.yMax)
              const isZero = tickVal === 0
              return (
                <g key={tickVal}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={PAD_L + PLOT_W}
                    y2={y}
                    stroke={isZero ? '#cbd5e1' : '#f1f5f9'}
                    strokeWidth={isZero ? 1.1 : 1}
                  />
                  <text
                    x={PAD_L - 5}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="JetBrains Mono, monospace"
                    fill="#475569"
                  >
                    {tickVal}
                    {secondaryConfig.unit}
                  </text>
                </g>
              )
            })}

            {/* Vertical Time Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const x = PAD_L + frac * PLOT_W
              return (
                <line
                  key={frac}
                  x1={x}
                  y1={PAD_T}
                  x2={x}
                  y2={PAD_T + PLOT_H}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                />
              )
            })}

            {/* Mode-Specific Reference Lines */}
            {secondaryMode === 'temp' && (
              <>
                {(() => {
                  const yCool = mapY(72, secondaryConfig.yMin, secondaryConfig.yMax)
                  const yEstop = mapY(88, secondaryConfig.yMin, secondaryConfig.yMax)
                  return (
                    <g>
                      <line
                        x1={PAD_L}
                        y1={yCool}
                        x2={PAD_L + PLOT_W}
                        y2={yCool}
                        stroke="#d97706"
                        strokeWidth={1.3}
                        strokeDasharray="4 3"
                      />
                      <text
                        x={PAD_L + 6}
                        y={yCool - 3}
                        fontSize="8.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#b45309"
                      >
                        72°C COOLING FAN ON
                      </text>
                      <line
                        x1={PAD_L}
                        y1={yEstop}
                        x2={PAD_L + PLOT_W}
                        y2={yEstop}
                        stroke="#dc2626"
                        strokeWidth={1.4}
                        strokeDasharray="4 3"
                      />
                      <text
                        x={PAD_L + 6}
                        y={yEstop - 3}
                        fontSize="8.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                        fill="#dc2626"
                      >
                        88°C THERMAL E-STOP
                      </text>
                    </g>
                  )
                })()}
              </>
            )}

            {secondaryMode === 'pwm' && (
              <text
                x={PAD_L + 6}
                y={PAD_T + 11}
                fontSize="8.5"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                fill="#64748b"
              >
                SATURATION ±100% · 0% CUTOFF ON E-STOP
              </text>
            )}

            {/* Secondary Telemetry Curves */}
            {count > 0 && (
              <>
                <polyline
                  fill="none"
                  stroke="#f97316"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={secLeftPoly}
                />
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={secRightPoly}
                />
              </>
            )}

            {/* Interactive Synchronized Vertical Cursor */}
            {activeSample && (
              <g>
                <line
                  x1={cursorX}
                  y1={PAD_T}
                  x2={cursorX}
                  y2={PAD_T + PLOT_H}
                  stroke={isReplaying ? '#d97706' : '#0f172a'}
                  strokeWidth={isReplaying ? 1.5 : 1}
                  strokeDasharray={isReplaying ? '3 2' : '2 2'}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(leftSecVal, secondaryConfig.yMin, secondaryConfig.yMax)}
                  r={3.6}
                  fill="#f97316"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
                <circle
                  cx={cursorX}
                  cy={mapY(rightSecVal, secondaryConfig.yMin, secondaryConfig.yMax)}
                  r={3.6}
                  fill="#06b6d4"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
              </g>
            )}

            {/* Shared Time Axis Labels */}
            <text
              x={PAD_L}
              y={H - 6}
              textAnchor="start"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tStart.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W * 0.5}
              y={H - 6}
              textAnchor="middle"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#475569"
            >
              t = {tMid.toFixed(1)}s
            </text>
            <text
              x={PAD_L + PLOT_W}
              y={H - 6}
              textAnchor="end"
              fontSize="9"
              fontFamily="JetBrains Mono, monospace"
              fill="#64748b"
            >
              {tEnd.toFixed(1)}s
            </text>
          </svg>
        </div>
      </div>
    </section>
  )
}
