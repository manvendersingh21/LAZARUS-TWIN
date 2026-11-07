import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, twinValue } from './types'

export const PIVOT_Y = 1.65
export const ARM_LENGTH = 1.75
const TARGET_DEG_DEFAULT = 30.0
const TARGET_RAD_DEFAULT = (TARGET_DEG_DEFAULT * Math.PI) / 180
export const TARGET_TIP_X = ARM_LENGTH * Math.cos(TARGET_RAD_DEFAULT) // ~1.516
export const TARGET_TIP_Y = PIVOT_Y + ARM_LENGTH * Math.sin(TARGET_RAD_DEFAULT) // ~2.525

const ERROR_ARC_SEGMENTS = 32
const ERROR_ARC_INNER_R = 0.68
const ERROR_ARC_OUTER_R = 1.25

const DEGREE_TICKS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90]

// Left-to-Right (+X) Dual-Level Conveyor Geometry (starts to the right of the arm tip so ZERO poles block the arm)
const CONV_X_START = 1.72
const CONV_X_END = 3.64
const CONV_X_SPAN = CONV_X_END - CONV_X_START
const CONV_X_MID = (CONV_X_START + CONV_X_END) * 0.5
const UPPER_DECK_Y = TARGET_TIP_Y - 0.14 // ~2.385 (aligned directly with 30.0° target arm tip)
const UPPER_BOX_Y = UPPER_DECK_Y + 0.145 // ~2.53
const LOWER_DECK_Y = 0.22
const LOWER_BOX_Y = LOWER_DECK_Y + 0.145 // ~0.365

const NUM_WORKPIECES = 3
const NUM_BELT_SLATS = 10
const BG_STATION_Z = [-2.2, -4.4]

type ItemOutcome = 'picked' | 'missed'

export type ViewportHudRefs = {
  topTelemetryRef: MutableRefObject<HTMLDivElement | null>
  conveyorStatusRef: MutableRefObject<HTMLDivElement | null>
  conveyorYieldRef: MutableRefObject<HTMLDivElement | null>
  bottomSafetyRef: MutableRefObject<HTMLDivElement | null>
}

export function SingleArmScene({
  side,
  frame,
  showPayload,
  hudRefs,
}: {
  side: 'left' | 'right'
  frame: MutableRefObject<Frame>
  showPayload?: boolean
  hudRefs?: ViewportHudRefs
}) {
  const armGroupRef = useRef<THREE.Group>(null)
  const bgArmRefs = useRef<(THREE.Group | null)[]>([])
  const ghostGroupRef = useRef<THREE.Group>(null)
  const payloadRef = useRef<THREE.Group>(null)
  const bgPayloadRefs = useRef<(THREE.Group | null)[]>([])
  const errorArcMeshRef = useRef<THREE.Mesh>(null)
  const errorArcMatRef = useRef<THREE.MeshBasicMaterial>(null)

  // Fixed base status LEDs & thermal column refs
  const tempLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const coolingLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const estopLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const coolingFanRef = useRef<THREE.Group>(null)
  const thermalBarGroupRef = useRef<THREE.Group>(null)
  const thermalBarMatRef = useRef<THREE.MeshStandardMaterial>(null)

  // Andon stack light tower refs (Red / Amber / Green)
  const andonRedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const andonAmberMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const andonGreenMatRef = useRef<THREE.MeshStandardMaterial>(null)

  // Conveyor & Workpiece Pick/Miss refs (moving left-to-right along +X)
  const beltPhaseRef = useRef(0)
  const prevURef = useRef<number[]>([0, 1 / 3, 2 / 3])
  const itemOutcomeRef = useRef<ItemOutcome[]>(['picked', 'picked', 'picked'])
  const itemDropStartYRef = useRef<number[]>([UPPER_BOX_Y, UPPER_BOX_Y, UPPER_BOX_Y])
  const pickedCountRef = useRef(0)
  const missedCountRef = useRef(0)
  const lastResetTickRef = useRef(-1)

  const workpieceGroupRefs = useRef<(THREE.Group | null)[]>([])
  const workpieceBodyMatRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const workpieceStripeMatRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const bgWorkpieceGroupRefs = useRef<(THREE.Group | null)[][]>([[], []])
  const bgWorkpieceMatRefs = useRef<(THREE.MeshStandardMaterial | null)[][]>([[], []])
  const upperSlatsRefs = useRef<(THREE.Mesh | null)[]>([])
  const lowerSlatsRefs = useRef<(THREE.Mesh | null)[]>([])
  const gateBeaconMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const gateLaserMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const gripperTipMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const transferPulseRef = useRef<THREE.Mesh>(null)

  // Requirement 8: Distinct solid metallic color per controller
  // Left (Legacy PLC Controller): Solid Industrial Orange (#f97316 / #ea580c)
  // Right (Autonomously Evolved Controller): Solid Engineering Cyan (#06b6d4 / #0284c7)
  const primaryColor = side === 'left' ? '#f97316' : '#06b6d4'
  const accentColor = side === 'left' ? '#ea580c' : '#0284c7'

  // Pre-allocated 32-segment triangle-strip BufferGeometry for the angular error sector in X-Y plane
  const errorArcGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const vertexCount = (ERROR_ARC_SEGMENTS + 1) * 2
    const positions = new Float32Array(vertexCount * 3)
    const indices: number[] = []

    for (let i = 0; i < ERROR_ARC_SEGMENTS; i++) {
      const i0 = i * 2
      const i1 = i0 + 1
      const i2 = i0 + 2
      const i3 = i0 + 3
      indices.push(i0, i1, i2)
      indices.push(i1, i3, i2)
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setIndex(indices)
    return geom
  }, [])

  useFrame(({ clock }, delta) => {
    const f = frame.current
    const twin = side === 'left' ? f.left_legacy : f.right_evolved

    // Direct physics state from backend Arm.step() — NO artificial damping or fabricated angles
    const angle = twin ? (twinValue(twin, 'angle', 'angle_deg', 'current_angle') ?? 0) : 30
    const target = twinValue(twin, 'target', 'target_angle') ?? 30
    const vel = twinValue(twin, 'velocity', 'angular_velocity') ?? 0
    const pwm = twinValue(twin, 'pwm', 'motor_pwm') ?? 0
    const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c') ?? 30
    const estop = (twinValue(twin, 'estop') ?? 0) > 0
    const cooling = (twinValue(twin, 'cooling') ?? 0) > 0 || temp >= 72
    const sabotage =
      showPayload ?? Boolean(f.sabotage_active || twin?.sabotage_active || (f.world?.gravity ?? 0) > 15)
    const signedErr = target - angle
    const absErr = Math.abs(signedErr)

    // Transfer gate alignment tolerance is ±3.2° around the 30.0° upper conveyor deck
    const pickSuccess = !estop && absErr <= 3.2

    // Reset conveyor yield counters when simulation resets (tick < 15)
    if (f.tick !== undefined && f.tick < 15 && lastResetTickRef.current !== f.tick) {
      pickedCountRef.current = 0
      missedCountRef.current = 0
      lastResetTickRef.current = f.tick
    } else if (f.tick !== undefined && f.tick >= 15) {
      lastResetTickRef.current = -1
    }

    // Coordinate convention: X-Y plane, rotating about +Z, 0° = +X horizontal, CCW positive
    const thetaRad = (angle * Math.PI) / 180
    const targetRad = (target * Math.PI) / 180

    if (armGroupRef.current) {
      armGroupRef.current.rotation.z = thetaRad
    }
    for (let b = 0; b < BG_STATION_Z.length; b++) {
      const bgArm = bgArmRefs.current[b]
      if (bgArm) bgArm.rotation.z = thetaRad
      const bgPay = bgPayloadRefs.current[b]
      if (bgPay) bgPay.visible = sabotage
    }
    if (ghostGroupRef.current) {
      ghostGroupRef.current.rotation.z = targetRad
    }

    // Requirement 9: Dynamically update angular error sector between thetaRad and targetRad
    const posAttr = errorArcGeometry.getAttribute('position') as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const startRad = Math.min(thetaRad, targetRad)
    const endRad = Math.max(thetaRad, targetRad)
    for (let i = 0; i <= ERROR_ARC_SEGMENTS; i++) {
      const t = i / ERROR_ARC_SEGMENTS
      const a = startRad + (endRad - startRad) * t
      const cosA = Math.cos(a)
      const sinA = Math.sin(a)
      const idx = i * 6
      arr[idx] = ERROR_ARC_INNER_R * cosA
      arr[idx + 1] = ERROR_ARC_INNER_R * sinA
      arr[idx + 2] = 0
      arr[idx + 3] = ERROR_ARC_OUTER_R * cosA
      arr[idx + 4] = ERROR_ARC_OUTER_R * sinA
      arr[idx + 5] = 0
    }
    posAttr.needsUpdate = true

    if (errorArcMeshRef.current && errorArcMatRef.current) {
      errorArcMeshRef.current.visible = absErr >= 0.15
      errorArcMatRef.current.color.set(absErr > 3.2 ? '#ef4444' : '#f59e0b')
      errorArcMatRef.current.opacity = 0.42
    }

    // Requirement 10: Endpoint payload mass visible when scenario models additional load
    if (payloadRef.current) {
      payloadRef.current.visible = sabotage
    }

    // =========================================================================
    // LEFT-TO-RIGHT (+X) DUAL CONVEYOR BELT & WORKPIECE TRANSFER / DROP LOGIC
    // =========================================================================
    const beltRunning = !f.paused && !estop
    if (beltRunning) {
      beltPhaseRef.current = (beltPhaseRef.current + delta * 0.38) % 1
    }

    // Animate upper pass belt slats and lower reject belt slats moving left-to-right (+X)
    for (let i = 0; i < NUM_BELT_SLATS; i++) {
      const u = (beltPhaseRef.current * 2.5 + i / NUM_BELT_SLATS) % 1
      const xPos = CONV_X_START + 0.08 + u * (CONV_X_SPAN - 0.16)
      const upSlat = upperSlatsRefs.current[i]
      if (upSlat) upSlat.position.x = xPos
      const lowSlat = lowerSlatsRefs.current[i]
      if (lowSlat) lowSlat.position.x = xPos
    }

    // Actual Y height of the arm tip right now
    const currentTipY = Math.max(LOWER_BOX_Y + 0.15, PIVOT_Y + ARM_LENGTH * Math.sin(thetaRad))

    // Update 3 cycling workpieces moving from the arm tip handoff (u = 0) to the right end (u = 1)
    let nearGate = false
    for (let i = 0; i < NUM_WORKPIECES; i++) {
      const u = (beltPhaseRef.current + i / NUM_WORKPIECES) % 1
      const prevU = prevURef.current[i] ?? u

      // When a workpiece spawns at the arm-tip handoff gate (u wraps around 0):
      if (u < prevU) {
        if (pickSuccess) {
          itemOutcomeRef.current[i] = 'picked'
          itemDropStartYRef.current[i] = UPPER_BOX_Y
          pickedCountRef.current += 1
        } else {
          itemOutcomeRef.current[i] = 'missed'
          itemDropStartYRef.current[i] = currentTipY
          missedCountRef.current += 1
        }
      }
      prevURef.current[i] = u
      if (u < 0.2) nearGate = true

      const group = workpieceGroupRefs.current[i]
      const bodyMat = workpieceBodyMatRefs.current[i]
      const stripeMat = workpieceStripeMatRefs.current[i]
      const outcome = itemOutcomeRef.current[i]
      const x = CONV_X_START + u * (CONV_X_SPAN - 0.18)

      if (group && bodyMat && stripeMat) {
        if (outcome === 'picked') {
          // Arm is at 30.0° -> Workpiece transfers cleanly onto Upper Pass Conveyor (y = UPPER_BOX_Y)
          group.position.set(x, UPPER_BOX_Y, 0)
          group.rotation.set(0, 0, 0)
          bodyMat.color.set('#10b981')
          bodyMat.emissive.set('#059669')
          bodyMat.emissiveIntensity = 0.65
          stripeMat.color.set('#ecfdf5')
        } else {
          // Arm sagged below 30.0° -> Workpiece misses the Upper Conveyor, falls onto Lower Reject Belt!
          const startY = itemDropStartYRef.current[i] ?? currentTipY
          const fallPhase = Math.min(1, u * 3.0)
          const y = startY - (startY - LOWER_BOX_Y) * (fallPhase * fallPhase)
          const tiltZ = fallPhase < 1 ? -fallPhase * 0.65 : -0.18
          group.position.set(x, y, 0)
          group.rotation.set(0, 0, tiltZ)
          bodyMat.color.set('#ef4444')
          bodyMat.emissive.set('#dc2626')
          bodyMat.emissiveIntensity = 0.7
          stripeMat.color.set('#fecaca')
        }
      }

      // Synchronize background stations' conveyor packages too
      for (let b = 0; b < BG_STATION_Z.length; b++) {
        const bgGrp = bgWorkpieceGroupRefs.current[b]?.[i]
        const bgMat = bgWorkpieceMatRefs.current[b]?.[i]
        if (bgGrp && bgMat) {
          if (outcome === 'picked') {
            bgGrp.position.set(x, UPPER_BOX_Y, 0)
            bgGrp.rotation.set(0, 0, 0)
            bgMat.color.set('#10b981')
            bgMat.emissive.set('#059669')
            bgMat.emissiveIntensity = 0.55
          } else {
            const startY = itemDropStartYRef.current[i] ?? currentTipY
            const fallPhase = Math.min(1, u * 3.0)
            const y = startY - (startY - LOWER_BOX_Y) * (fallPhase * fallPhase)
            bgGrp.position.set(x, y, 0)
            bgGrp.rotation.set(0, 0, fallPhase < 1 ? -fallPhase * 0.5 : -0.15)
            bgMat.color.set('#ef4444')
            bgMat.emissive.set('#dc2626')
            bgMat.emissiveIntensity = 0.6
          }
        }
      }
    }

    if (transferPulseRef.current) {
      transferPulseRef.current.visible = pickSuccess && nearGate
    }

    // Update Gate Beacon, Laser Curtain & Gripper Tip LED colors
    if (gateBeaconMatRef.current) {
      gateBeaconMatRef.current.color.set(pickSuccess ? '#10b981' : '#ef4444')
      gateBeaconMatRef.current.emissive.set(pickSuccess ? '#059669' : '#dc2626')
      gateBeaconMatRef.current.emissiveIntensity = pickSuccess ? 1.4 : 1.8
    }
    if (gateLaserMatRef.current) {
      gateLaserMatRef.current.color.set(pickSuccess ? '#10b981' : '#ef4444')
      gateLaserMatRef.current.opacity = nearGate ? 0.55 : 0.22
    }
    if (gripperTipMatRef.current) {
      gripperTipMatRef.current.color.set(pickSuccess ? '#10b981' : '#ef4444')
      gripperTipMatRef.current.emissive.set(pickSuccess ? '#059669' : '#dc2626')
      gripperTipMatRef.current.emissiveIntensity = 1.4
    }

    // Update Andon Stack Light Tower (Red / Amber / Green) on PLC Cabinet
    const flash = 0.6 + 0.8 * Math.abs(Math.sin(clock.elapsedTime * 8))
    if (andonRedMatRef.current) {
      const redOn = estop || !pickSuccess
      andonRedMatRef.current.color.set(redOn ? '#ef4444' : '#334155')
      andonRedMatRef.current.emissive.set(redOn ? '#dc2626' : '#0f172a')
      andonRedMatRef.current.emissiveIntensity = redOn ? flash * 1.8 : 0.08
    }
    if (andonAmberMatRef.current) {
      const amberOn = cooling || (absErr > 1.5 && absErr <= 3.2)
      andonAmberMatRef.current.color.set(amberOn ? '#f59e0b' : '#334155')
      andonAmberMatRef.current.emissive.set(amberOn ? '#d97706' : '#0f172a')
      andonAmberMatRef.current.emissiveIntensity = amberOn ? 1.4 : 0.08
    }
    if (andonGreenMatRef.current) {
      const greenOn = pickSuccess
      andonGreenMatRef.current.color.set(greenOn ? '#10b981' : '#334155')
      andonGreenMatRef.current.emissive.set(greenOn ? '#059669' : '#0f172a')
      andonGreenMatRef.current.emissiveIntensity = greenOn ? 1.5 : 0.08
    }

    // Fixed Base Thermal / Cooling / E-Stop LEDs
    const tempRatio = THREE.MathUtils.clamp((temp - 20) / 80, 0.08, 1.0)
    const tempHex = temp >= 88 ? '#ef4444' : temp >= 72 ? '#f59e0b' : '#10b981'
    if (thermalBarGroupRef.current) {
      thermalBarGroupRef.current.scale.y = tempRatio
    }
    if (thermalBarMatRef.current) {
      thermalBarMatRef.current.color.set(tempHex)
      thermalBarMatRef.current.emissive.set(tempHex)
      thermalBarMatRef.current.emissiveIntensity = temp >= 88 ? 1.6 : 0.9
    }
    if (tempLedMatRef.current) {
      tempLedMatRef.current.color.set(tempHex)
      tempLedMatRef.current.emissive.set(tempHex)
      tempLedMatRef.current.emissiveIntensity = temp >= 88 ? 2.0 : 1.1
    }
    if (coolingLedMatRef.current) {
      const coolHex = cooling ? '#06b6d4' : '#334155'
      coolingLedMatRef.current.color.set(coolHex)
      coolingLedMatRef.current.emissive.set(cooling ? '#0284c7' : '#0f172a')
      coolingLedMatRef.current.emissiveIntensity = cooling ? 1.6 : 0.1
    }
    if (estopLedMatRef.current) {
      const estopHex = estop ? '#ef4444' : '#334155'
      estopLedMatRef.current.color.set(estopHex)
      estopLedMatRef.current.emissive.set(estop ? '#dc2626' : '#0f172a')
      estopLedMatRef.current.emissiveIntensity = estop ? flash * 1.8 : 0.1
    }
    if (coolingFanRef.current) {
      coolingFanRef.current.rotation.z += delta * (cooling ? 18 : 0.8)
    }

    // Update Non-Overlapping 2D Corner HUD Bars in Viewport3D
    if (hudRefs?.topTelemetryRef.current) {
      hudRefs.topTelemetryRef.current.textContent = `TARGET: ${target.toFixed(1)}°  ·  ACTUAL θ: ${angle.toFixed(1)}°  ·  ERROR Δθ: ${signedErr >= 0 ? '+' : ''}${signedErr.toFixed(1)}°  ·  PWM: ${pwm.toFixed(0)}%`
    }
    if (hudRefs?.conveyorStatusRef.current) {
      if (estop) {
        hudRefs.conveyorStatusRef.current.textContent = '✗ E-STOP LATCHED — LINE HALTED'
        hudRefs.conveyorStatusRef.current.style.backgroundColor = '#dc2626'
      } else if (pickSuccess) {
        hudRefs.conveyorStatusRef.current.textContent = `✓ PASSING TO UPPER BELT (θ = ${angle.toFixed(1)}°)`
        hudRefs.conveyorStatusRef.current.style.backgroundColor = '#059669'
      } else {
        hudRefs.conveyorStatusRef.current.textContent = `✗ ARM SAGGED (${angle.toFixed(1)}°) — DROPPING TO REJECT BELT`
        hudRefs.conveyorStatusRef.current.style.backgroundColor = '#dc2626'
      }
    }
    if (hudRefs?.conveyorYieldRef.current) {
      hudRefs.conveyorYieldRef.current.textContent = `PICKED (UPPER PASS): ${pickedCountRef.current}   ·   MISSED (LOWER REJECT): ${missedCountRef.current}`
    }
    if (hudRefs?.bottomSafetyRef.current) {
      hudRefs.bottomSafetyRef.current.textContent = `g ↓ (-Y)  ·  ω: ${vel.toFixed(1)}°/s  ·  TEMP: ${temp.toFixed(1)}°C  ·  COOLING: ${cooling ? 'ON' : 'OFF'}  ·  E-STOP: ${estop ? 'LATCHED (0% PWM)' : 'OK (RUN)'}${sabotage ? '  ·  [HEAVY PAYLOAD ATTACHED]' : ''}`
    }
  })

  return (
    <group>
      {/* =====================================================================
          0. INDUSTRIAL FACTORY ARCHITECTURE: FLOOR PAD, SAFETY BOLLARDS,
             OVERHEAD GANTRY TRUSSES, LED HIGH-BAY LIGHTS & PLC CABINET
         ===================================================================== */}
      <group>
        {/* Polished Dark-Slate Industrial Epoxy Workcell Floor Pad */}
        <mesh position={[1.35, 0.008, -1.8]} receiveShadow>
          <boxGeometry args={[5.9, 0.016, 6.2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.38} metalness={0.35} />
        </mesh>
        {/* High-Visibility Safety Yellow Perimeter Stripes (Front, Rear, Left, Right) */}
        <mesh position={[1.35, 0.018, 1.15]}>
          <boxGeometry args={[5.9, 0.006, 0.09]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
        <mesh position={[1.35, 0.018, -4.75]}>
          <boxGeometry args={[5.9, 0.006, 0.09]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
        <mesh position={[-1.56, 0.018, -1.8]}>
          <boxGeometry args={[0.09, 0.006, 5.9]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
        <mesh position={[4.26, 0.018, -1.8]}>
          <boxGeometry args={[0.09, 0.006, 5.9]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>

        {/* Safety Yellow Bollard Posts at Workcell Corners */}
        {[
          [-1.45, 1.05],
          [4.15, 1.05],
          [-1.45, -4.65],
          [4.15, -4.65],
        ].map(([bx, bz], idx) => (
          <group key={idx} position={[bx, 0, bz]}>
            <mesh position={[0, 0.34, 0]} castShadow>
              <cylinderGeometry args={[0.055, 0.055, 0.68, 16]} />
              <meshStandardMaterial color="#eab308" metalness={0.45} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.52, 0]}>
              <cylinderGeometry args={[0.058, 0.058, 0.12, 16]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
          </group>
        ))}

        {/* Overhead Factory Gantry Structural Steel Frame & Glowing LED High-Bay Lights (y = 4.15) */}
        {[0.2, -2.2, -4.4].map((gz, idx) => (
          <group key={idx} position={[1.35, 4.15, gz]}>
            {/* Overhead Horizontal I-Beam Truss */}
            <mesh>
              <boxGeometry args={[5.8, 0.14, 0.14]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Glowing Industrial LED Light Fixtures */}
            {[-0.4, 2.2].map((lx, lIdx) => (
              <mesh key={lIdx} position={[lx - 1.35, -0.09, 0]}>
                <boxGeometry args={[1.1, 0.035, 0.18]} />
                <meshStandardMaterial color="#f8fafc" emissive="#bae6fd" emissiveIntensity={1.6} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Rear Gantry Columns at z = -0.9 and z = -4.65 (never blocking the front camera!) */}
        {[
          [-1.45, -0.9],
          [4.15, -0.9],
          [-1.45, -4.65],
          [4.15, -4.65],
        ].map(([cx, cz], idx) => (
          <mesh key={idx} position={[cx, 2.08, cz]}>
            <boxGeometry args={[0.14, 4.16, 0.14]} />
            <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.32} />
          </mesh>
        ))}

        {/* Industrial PLC Enclosure Cabinet & Andon Stack Tower on Left (x = -1.06, z = -0.42) */}
        <group position={[-1.06, 0, -0.42]}>
          <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 1.7, 0.5]} />
            <meshStandardMaterial color="#1e293b" metalness={0.72} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.88, 0.255]}>
            <boxGeometry args={[0.52, 1.5, 0.015]} />
            <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.32} />
          </mesh>
          {/* Glowing PLC Diagnostic Screen on Cabinet Door */}
          <mesh position={[0, 1.18, 0.268]}>
            <boxGeometry args={[0.38, 0.26, 0.01]} />
            <meshStandardMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.85} />
          </mesh>
          {/* High-Voltage Warning Diamond */}
          <mesh position={[0, 0.72, 0.268]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.11, 0.11, 0.01]} />
            <meshStandardMaterial color="#facc15" emissive="#ca8a04" emissiveIntensity={0.4} />
          </mesh>
          {/* 3-Light Industrial Andon Stack Tower (Red / Amber / Green) on Top of PLC Cabinet */}
          <group position={[0, 1.7, 0]}>
            <mesh position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.026, 0.026, 0.4, 12]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
            </mesh>
            <mesh position={[0, 0.42, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.11, 18]} />
              <meshStandardMaterial ref={andonGreenMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.4} />
            </mesh>
            <mesh position={[0, 0.54, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.11, 18]} />
              <meshStandardMaterial ref={andonAmberMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
            </mesh>
            <mesh position={[0, 0.66, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.11, 18]} />
              <meshStandardMaterial ref={andonRedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
            </mesh>
          </group>
        </group>

        {/* Synchronized Down-Line Assembly Robot Stations 02 & 03 (z = -2.2 and z = -4.4) */}
        {BG_STATION_Z.map((zPos, idx) => (
          <group key={zPos} position={[0, 0, zPos]}>
            <mesh position={[0, 0.06, -0.22]} receiveShadow castShadow>
              <boxGeometry args={[1.15, 0.12, 1.05]} />
              <meshStandardMaterial color="#1e293b" metalness={0.75} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.92, -0.34]} castShadow receiveShadow>
              <boxGeometry args={[0.42, 1.62, 0.36]} />
              <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.35} />
            </mesh>
            <mesh position={[0, PIVOT_Y, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.28, 0.32, 0.36, 24]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.28} />
            </mesh>
            {/* Synchronized 1-DOF arm rotating at thetaRad */}
            <group
              ref={el => {
                bgArmRefs.current[idx] = el
              }}
              position={[0, PIVOT_Y, 0]}
            >
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.2, 0.2, 0.18, 24]} />
                <meshStandardMaterial color={accentColor} metalness={0.6} roughness={0.3} />
              </mesh>
              <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow>
                <boxGeometry args={[ARM_LENGTH, 0.17, 0.13]} />
                <meshStandardMaterial color={primaryColor} metalness={0.55} roughness={0.28} />
              </mesh>
              <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.13, 0.13, 0.16, 20]} />
                <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.25} />
              </mesh>
              <group
                ref={el => {
                  bgPayloadRefs.current[idx] = el
                }}
                position={[ARM_LENGTH - 0.2, -0.2, 0]}
                visible={false}
              >
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.16, 0.16, 0.24, 18]} />
                  <meshStandardMaterial color="#ea580c" metalness={0.45} roughness={0.35} />
                </mesh>
              </group>
            </group>
            {/* Down-line upper & lower conveyor decks */}
            <mesh position={[CONV_X_MID, UPPER_DECK_Y, 0]} receiveShadow>
              <boxGeometry args={[CONV_X_SPAN, 0.09, 0.48]} />
              <meshStandardMaterial color="#1e293b" metalness={0.72} roughness={0.35} />
            </mesh>
            <mesh position={[CONV_X_MID, LOWER_DECK_Y, 0]} receiveShadow>
              <boxGeometry args={[CONV_X_SPAN, 0.1, 0.54]} />
              <meshStandardMaterial color="#1e293b" metalness={0.75} roughness={0.35} />
            </mesh>
            {/* Synchronized packages on down-line stations */}
            {Array.from({ length: NUM_WORKPIECES }).map((_, wIdx) => (
              <group
                key={wIdx}
                ref={el => {
                  if (!bgWorkpieceGroupRefs.current[idx]) bgWorkpieceGroupRefs.current[idx] = []
                  bgWorkpieceGroupRefs.current[idx][wIdx] = el
                }}
                position={[CONV_X_START + (wIdx / NUM_WORKPIECES) * CONV_X_SPAN, UPPER_BOX_Y, 0]}
              >
                <mesh>
                  <boxGeometry args={[0.2, 0.17, 0.2]} />
                  <meshStandardMaterial
                    ref={el => {
                      if (!bgWorkpieceMatRefs.current[idx]) bgWorkpieceMatRefs.current[idx] = []
                      bgWorkpieceMatRefs.current[idx][wIdx] = el
                    }}
                    color="#10b981"
                    emissive="#059669"
                    emissiveIntensity={0.5}
                  />
                </mesh>
              </group>
            ))}
          </group>
        ))}
      </group>

      {/* =====================================================================
          1. FOREGROUND STATION 01 — FIXED INDUSTRIAL ROBOT PEDESTAL AT x = 0, z = 0
         ===================================================================== */}
      <group>
        <mesh position={[0, 0.06, -0.22]} receiveShadow castShadow>
          <boxGeometry args={[1.38, 0.12, 1.28]} />
          <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.13, -0.24]} receiveShadow>
          <boxGeometry args={[1.18, 0.035, 1.08]} />
          <meshStandardMaterial color="#475569" metalness={0.72} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.96, -0.36]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 1.68, 0.44]} />
          <meshStandardMaterial color="#334155" metalness={0.76} roughness={0.3} />
        </mesh>

        {/* Fixed Revolute Joint Servo Housing projecting forward to [0, PIVOT_Y, 0] */}
        <mesh position={[0, PIVOT_Y, -0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.34, 0.38, 0.42, 32]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.24} />
        </mesh>
        <mesh position={[0, PIVOT_Y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.27, 0.27, 0.06, 28]} />
          <meshStandardMaterial color="#64748b" metalness={0.88} roughness={0.2} />
        </mesh>

        {/* Compact Status LEDs & Thermal Bar on Base Stanchion */}
        <group position={[-0.42, 0.95, -0.18]}>
          <mesh>
            <boxGeometry args={[0.3, 0.84, 0.08]} />
            <meshStandardMaterial color="#0f172a" metalness={0.65} roughness={0.35} />
          </mesh>
          <mesh position={[-0.07, -0.04, 0.045]}>
            <boxGeometry args={[0.055, 0.54, 0.02]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <group ref={thermalBarGroupRef} position={[-0.07, -0.31, 0.055]}>
            <mesh position={[0, 0.27, 0]}>
              <boxGeometry args={[0.045, 0.54, 0.02]} />
              <meshStandardMaterial
                ref={thermalBarMatRef}
                color="#10b981"
                emissive="#10b981"
                emissiveIntensity={0.85}
              />
            </mesh>
          </group>
          <mesh position={[0.06, 0.18, 0.05]}>
            <sphereGeometry args={[0.036, 14, 14]} />
            <meshStandardMaterial ref={tempLedMatRef} color="#10b981" emissive="#10b981" emissiveIntensity={1.1} />
          </mesh>
          <mesh position={[0.06, 0.02, 0.05]}>
            <sphereGeometry args={[0.036, 14, 14]} />
            <meshStandardMaterial ref={coolingLedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>
          <mesh position={[0.06, -0.14, 0.05]}>
            <sphereGeometry args={[0.036, 14, 14]} />
            <meshStandardMaterial ref={estopLedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>
          <group ref={coolingFanRef} position={[0.06, -0.29, 0.05]}>
            {[0, 1, 2].map(b => (
              <mesh key={b} rotation={[0, 0, (b * Math.PI) / 3]}>
                <boxGeometry args={[0.095, 0.022, 0.01]} />
                <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.6} />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      {/* =====================================================================
          2. CLEAN PROTRACTOR REFERENCE DIAL IN X-Y PLANE (z = -0.14)
         ===================================================================== */}
      <group position={[0, PIVOT_Y, -0.14]}>
        <mesh>
          <ringGeometry args={[ARM_LENGTH - 0.018, ARM_LENGTH + 0.018, 64, 1, -Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#475569" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.014, 0.004]} />
          <meshBasicMaterial color="#475569" transparent opacity={0.5} />
        </mesh>
        {DEGREE_TICKS.map(deg => {
          const rad = (deg * Math.PI) / 180
          const isMajor = deg % 30 === 0
          const tickLen = isMajor ? 0.12 : 0.06
          const rMid = ARM_LENGTH - tickLen * 0.5
          return (
            <group key={deg} position={[rMid * Math.cos(rad), rMid * Math.sin(rad), 0]} rotation={[0, 0, rad]}>
              <mesh>
                <boxGeometry args={[tickLen, isMajor ? 0.022 : 0.01, 0.005]} />
                <meshBasicMaterial color={deg === 30 ? '#10b981' : isMajor ? '#94a3b8' : '#475569'} />
              </mesh>
            </group>
          )
        })}
        {/* Downward Gravity Arrow (g ↓) on left of base */}
        <group position={[-0.68, 0.55, 0]}>
          <mesh position={[0, -0.22, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.4, 12]} />
            <meshBasicMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[0, -0.45, 0]} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.055, 0.12, 14]} />
            <meshBasicMaterial color="#94a3b8" />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          3. REQUIREMENT 9 — VISIBLE ANGULAR ERROR ARC (r = 0.68..1.25)
         ===================================================================== */}
      <mesh ref={errorArcMeshRef} position={[0, PIVOT_Y, -0.09]} geometry={errorArcGeometry}>
        <meshBasicMaterial
          ref={errorArcMatRef}
          color="#ef4444"
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* =====================================================================
          4. REQUIREMENT 7 — TRANSLUCENT GREEN GHOST ARM AT TARGET ANGLE (30.0°)
         ===================================================================== */}
      <group ref={ghostGroupRef} position={[0, PIVOT_Y, -0.05]} rotation={[0, 0, TARGET_RAD_DEFAULT]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.21, 0.21, 0.1, 24]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#059669"
            emissiveIntensity={0.55}
            transparent
            opacity={0.34}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.18, 0.09]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#059669"
            emissiveIntensity={0.55}
            transparent
            opacity={0.34}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.05]}>
          <boxGeometry args={[ARM_LENGTH, 0.028, 0.01]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.85} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0]}>
          <ringGeometry args={[0.14, 0.21, 28]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* =====================================================================
          5. REQUIREMENT 8 — ACTUAL CONTROLLED 1-DOF RIGID ARM
          Pivoting about +Z at [0, PIVOT_Y, 0], extending along +X to L = 1.75
         ===================================================================== */}
      <group ref={armGroupRef} position={[0, PIVOT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.22, 32]} />
          <meshStandardMaterial color={accentColor} metalness={0.65} roughness={0.25} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.12]}>
          <cylinderGeometry args={[0.11, 0.11, 0.04, 20]} />
          <meshStandardMaterial color="#0f172a" metalness={0.88} roughness={0.2} />
        </mesh>
        <mesh position={[-0.22, 0, 0]} castShadow>
          <boxGeometry args={[0.28, 0.26, 0.18]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.28} />
        </mesh>

        {/* Main 1-DOF Rigid Structural Arm Boom */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARM_LENGTH, 0.21, 0.16]} />
          <meshStandardMaterial
            color={primaryColor}
            emissive={accentColor}
            emissiveIntensity={0.22}
            metalness={0.55}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.085]}>
          <boxGeometry args={[ARM_LENGTH - 0.3, 0.07, 0.015]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.75} roughness={0.2} />
        </mesh>

        {/* Endpoint Magnetic/Vacuum Transfer Head at x = ARM_LENGTH */}
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.2, 28]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.22} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.085, 0.085, 0.025, 20]} />
          <meshStandardMaterial ref={gripperTipMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.2} />
        </mesh>

        {/* ===================================================================
            6. REQUIREMENT 10 — ENDPOINT PAYLOAD MASS AT x = ARM_LENGTH
            Mounted below/behind the tip collar when scenario models heavy load
           =================================================================== */}
        <group ref={payloadRef} position={[ARM_LENGTH - 0.22, -0.24, 0]} visible={false}>
          <mesh position={[0, 0.11, 0]} castShadow>
            <boxGeometry args={[0.09, 0.14, 0.11]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.21, 0.21, 0.3, 24]} />
            <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.26} />
          </mesh>
          <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.216, 0.216, 0.12, 24]} />
            <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.45} />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          7. LEFT-TO-RIGHT (+X) DUAL CONVEYOR ASSEMBLY LINE (x = 1.72 .. 3.64)
          - UPPER CONVEYOR (y = 2.385): Aligned with 30.0° Target Arm Tip (PASS)
          - LOWER CONVEYOR (y = 0.22): Catches Dropped Items when Arm Sags (FAIL)
         ===================================================================== */}
      <group>
        {/* Glowing Transfer Bridge Pulse between 30.0° Arm Tip and Upper Conveyor Entrance */}
        <mesh ref={transferPulseRef} position={[CONV_X_START - 0.1, TARGET_TIP_Y, 0]}>
          <boxGeometry args={[0.22, 0.05, 0.22]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.75} />
        </mesh>

        {/* --- A. UPPER 30.0° TARGET PASS CONVEYOR (x = 1.72 .. 3.64, y = 2.385) --- */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN, 0.11, 0.6]} />
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.3} />
        </mesh>
        {/* Glowing Emerald Target Alignment Side Rails on Upper Pass Conveyor */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, 0.31]}>
          <boxGeometry args={[CONV_X_SPAN, 0.055, 0.035]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.55} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, -0.31]}>
          <boxGeometry args={[CONV_X_SPAN, 0.055, 0.035]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.55} />
        </mesh>
        {/* Upper Conveyor End Rollers */}
        {[CONV_X_START + 0.04, CONV_X_END - 0.04].map((rx, idx) => (
          <mesh key={idx} position={[rx, UPPER_DECK_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.58, 18]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.22} />
          </mesh>
        ))}

        {/* Laser Photo-Eye Scanner Arch at Left Entrance of Upper Conveyor (x = CONV_X_START) */}
        <group position={[CONV_X_START, UPPER_DECK_Y + 0.22, 0]}>
          <mesh position={[0, 0, -0.29]}>
            <boxGeometry args={[0.055, 0.42, 0.045]} />
            <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.065, 0.05, 0.62]} />
            <meshStandardMaterial ref={gateBeaconMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.4} />
          </mesh>
          {/* Translucent Laser Light Curtain across the Pickup Gate */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.015, 0.38, 0.54]} />
            <meshBasicMaterial ref={gateLaserMatRef} color="#10b981" transparent opacity={0.32} />
          </mesh>
        </group>

        {/* Upper Pass Outfeed Tunnel ("FINISHED GOODS BAY") at Right End (x = CONV_X_END + 0.16) */}
        <group position={[CONV_X_END + 0.14, UPPER_DECK_Y + 0.22, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.34, 0.48, 0.68]} />
            <meshStandardMaterial color="#0f172a" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[-0.175, 0.18, 0]}>
            <boxGeometry args={[0.02, 0.06, 0.62]} />
            <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={1.1} />
          </mesh>
        </group>

        {/* --- B. LOWER FLOOR REJECT CONVEYOR (x = 0.68 .. 3.64, y = 0.22) --- */}
        <mesh position={[(0.68 + CONV_X_END) * 0.5, LOWER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_END - 0.68, 0.12, 0.66]} />
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.32} />
        </mesh>
        {/* Glowing Crimson Reject Side Rails on Lower Conveyor */}
        <mesh position={[(0.68 + CONV_X_END) * 0.5, LOWER_DECK_Y + 0.05, 0.34]}>
          <boxGeometry args={[CONV_X_END - 0.68, 0.055, 0.035]} />
          <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.45} />
        </mesh>
        <mesh position={[(0.68 + CONV_X_END) * 0.5, LOWER_DECK_Y + 0.05, -0.34]}>
          <boxGeometry args={[CONV_X_END - 0.68, 0.055, 0.035]} />
          <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.45} />
        </mesh>
        {/* Lower Conveyor End Rollers */}
        {[0.72, CONV_X_END - 0.04].map((rx, idx) => (
          <mesh key={idx} position={[rx, LOWER_DECK_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.62, 18]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.22} />
          </mesh>
        ))}

        {/* Lower Reject Scrap Hopper Bin at Right End (x = CONV_X_END + 0.16) */}
        <group position={[CONV_X_END + 0.14, LOWER_DECK_Y + 0.2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.36, 0.44, 0.72]} />
            <meshStandardMaterial color="#1e293b" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh position={[-0.185, 0.15, 0]}>
            <boxGeometry args={[0.02, 0.06, 0.66]} />
            <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={1.0} />
          </mesh>
        </group>

        {/* Rear Support Stanchions at z = -0.28 (strictly to the right of the arm so nothing blocks the view) */}
        {[CONV_X_START + 0.18, CONV_X_END - 0.18].map((sx, idx) => (
          <mesh key={idx} position={[sx, UPPER_DECK_Y * 0.5, -0.28]} castShadow>
            <boxGeometry args={[0.1, UPPER_DECK_Y, 0.1]} />
            <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.3} />
          </mesh>
        ))}

        {/* Animated Belt Slats on Upper & Lower Conveyors moving along +X */}
        {Array.from({ length: NUM_BELT_SLATS }).map((_, i) => (
          <group key={i}>
            <mesh
              ref={el => {
                upperSlatsRefs.current[i] = el
              }}
              position={[CONV_X_START + (i / NUM_BELT_SLATS) * CONV_X_SPAN, UPPER_DECK_Y + 0.06, 0]}
            >
              <boxGeometry args={[0.04, 0.014, 0.52]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
            <mesh
              ref={el => {
                lowerSlatsRefs.current[i] = el
              }}
              position={[CONV_X_START + (i / NUM_BELT_SLATS) * CONV_X_SPAN, LOWER_DECK_Y + 0.068, 0]}
            >
              <boxGeometry args={[0.04, 0.014, 0.56]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
          </group>
        ))}

        {/* 3 Cycling Workpiece Crates (Green on Upper Pass Belt when Arm at 30°, Red Dropping to Lower Reject Belt when Arm Sags) */}
        {Array.from({ length: NUM_WORKPIECES }).map((_, i) => (
          <group
            key={i}
            ref={el => {
              workpieceGroupRefs.current[i] = el
            }}
            position={[CONV_X_START + (i / NUM_WORKPIECES) * CONV_X_SPAN, UPPER_BOX_Y, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.24, 0.21, 0.26]} />
              <meshStandardMaterial
                ref={el => {
                  workpieceBodyMatRefs.current[i] = el
                }}
                color="#10b981"
                emissive="#059669"
                emissiveIntensity={0.6}
                metalness={0.38}
                roughness={0.28}
              />
            </mesh>
            <mesh position={[0, 0.11, 0]}>
              <boxGeometry args={[0.2, 0.022, 0.22]} />
              <meshStandardMaterial
                ref={el => {
                  workpieceStripeMatRefs.current[i] = el
                }}
                color="#ecfdf5"
                metalness={0.65}
                roughness={0.22}
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

export default function TwinPhysicsArena({ frame }: { frame: MutableRefObject<Frame> }) {
  return (
    <group>
      <group position={[-3.2, 0, 0]}>
        <SingleArmScene side="left" frame={frame} />
      </group>
      <group position={[3.2, 0, 0]}>
        <SingleArmScene side="right" frame={frame} />
      </group>
    </group>
  )
}
