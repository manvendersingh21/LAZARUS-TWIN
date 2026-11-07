import { useFrame, useLoader } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, twinValue } from './types'

export const PIVOT_Y = 1.48
export const ARM_LENGTH = 1.62
const TARGET_DEG_DEFAULT = 30.0
const TARGET_RAD_DEFAULT = (TARGET_DEG_DEFAULT * Math.PI) / 180
export const TARGET_TIP_X = ARM_LENGTH * Math.cos(TARGET_RAD_DEFAULT) // ~1.403
export const TARGET_TIP_Y = PIVOT_Y + ARM_LENGTH * Math.sin(TARGET_RAD_DEFAULT) // ~2.290

const ERROR_ARC_SEGMENTS = 32
const ERROR_ARC_INNER_R = 0.52
const ERROR_ARC_OUTER_R = 1.08

const DEGREE_TICKS = [-90, -60, -30, 0, 30, 60, 90]

// Integrated 2-Tier Industrial Conveyor Machine (starts at x = 1.58 right at the arm tip handoff)
const CONV_X_START = 1.58
const CONV_X_END = 3.48
const CONV_X_SPAN = CONV_X_END - CONV_X_START
const CONV_X_MID = (CONV_X_START + CONV_X_END) * 0.5
const UPPER_DECK_Y = TARGET_TIP_Y - 0.13 // ~2.160 (aligned with 30.0° target arm tip)
const UPPER_BOX_Y = UPPER_DECK_Y + 0.14 // ~2.300
const LOWER_DECK_Y = 1.02 // Waist-high industrial reject belt atop a solid steel machine base
const LOWER_BOX_Y = LOWER_DECK_Y + 0.14 // ~1.160

const NUM_WORKPIECES = 3
const NUM_BELT_SLATS = 10

type ItemOutcome = 'picked' | 'missed'

export type ViewportHudRefs = {
  topTelemetryRef: MutableRefObject<HTMLDivElement | null>
  conveyorStatusRef: MutableRefObject<HTMLDivElement | null>
  conveyorYieldRef: MutableRefObject<HTMLDivElement | null>
  bottomSafetyRef: MutableRefObject<HTMLDivElement | null>
}

function FactoryHallEnvironment() {
  const texture = useLoader(THREE.TextureLoader, '/factory-bg.jpg')

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
  }, [texture])

  return (
    <group>
      {/* 1. 3D Curved Panoramic Factory Hall Backdrop inside the 3D scene (moves with OrbitControls!) */}
      <mesh position={[1.35, 3.65, -4.6]} rotation={[0, 0, 0]}>
        <planeGeometry args={[18.5, 9.2]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>

      {/* 2. Grounded Dark Polished Factory Concrete Floor (matches the reflective floor in factory-bg.jpg) */}
      <mesh position={[1.35, -0.005, -1.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[18.5, 7.2]} />
        <meshStandardMaterial color="#18202c" roughness={0.28} metalness={0.42} />
      </mesh>
      {/* Subtle expansion-joint grid seams in the concrete floor */}
      {[-1.5, 0.0, 1.5, 3.0, 4.5].map(gx => (
        <mesh key={gx} position={[gx, 0.002, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.018, 7.2]} />
          <meshBasicMaterial color="#0f172a" transparent opacity={0.65} />
        </mesh>
      ))}
      {[-0.8, 0.8, 2.1].map(gz => (
        <mesh key={gz} position={[1.35, 0.002, gz]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[18.5, 0.018]} />
          <meshBasicMaterial color="#0f172a" transparent opacity={0.65} />
        </mesh>
      ))}

      {/* 3. Continuous Painted Yellow Factory Safety Aisle Stripes on the Floor */}
      <mesh position={[1.35, 0.004, 0.86]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14.0, 0.075]} />
        <meshBasicMaterial color="#eab308" />
      </mesh>
      <mesh position={[1.35, 0.004, -0.92]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14.0, 0.075]} />
        <meshBasicMaterial color="#eab308" />
      </mesh>

      {/* 4. Brushed Steel Industrial Safety Guardrails along the Rear Aisle (matching factory-bg.jpg) */}
      <group position={[1.35, 0, -0.98]}>
        {[-3.2, -1.6, 0.0, 1.6, 3.2, 4.8].map(px => (
          <mesh key={px} position={[px - 1.35, 0.48, 0]} castShadow>
            <cylinderGeometry args={[0.028, 0.028, 0.96, 12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.22} />
          </mesh>
        ))}
        <mesh position={[0, 0.92, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.026, 0.026, 9.2, 12]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.88} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.52, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, 9.2, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.22} />
        </mesh>
      </group>

      {/* 5. Soft Grounding Contact Shadows under the Robot, PLC Cabinet, and Conveyor Machine */}
      <ContactShadows
        position={[1.35, 0.006, 0]}
        opacity={0.65}
        scale={9.5}
        blur={1.7}
        far={3.5}
        resolution={512}
        color="#020617"
      />
    </group>
  )
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
  const ghostGroupRef = useRef<THREE.Group>(null)
  const payloadRef = useRef<THREE.Group>(null)
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
  const upperSlatsRefs = useRef<(THREE.Mesh | null)[]>([])
  const lowerSlatsRefs = useRef<(THREE.Mesh | null)[]>([])
  const gateBeaconMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const gateLaserMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const gripperTipMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const transferPulseRef = useRef<THREE.Mesh>(null)

  // Requirement 8: Distinct solid metallic color per controller
  // Left (Legacy PLC Controller): Industrial Safety Orange (#f97316 / #ea580c)
  // Right (Autonomously Evolved Controller): Industrial Robotics Cyan (#06b6d4 / #0284c7)
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
          bodyMat.emissiveIntensity = 0.55
          stripeMat.color.set('#ecfdf5')
        } else {
          // Arm sagged below 30.0° -> Workpiece slides/falls down the reject chute onto Lower Reject Belt!
          const startY = itemDropStartYRef.current[i] ?? currentTipY
          const fallPhase = Math.min(1, u * 2.8)
          const y = startY - (startY - LOWER_BOX_Y) * (fallPhase * fallPhase)
          const tiltZ = fallPhase < 1 ? -fallPhase * 0.55 : -0.14
          group.position.set(x, y, 0)
          group.rotation.set(0, 0, tiltZ)
          bodyMat.color.set('#ef4444')
          bodyMat.emissive.set('#dc2626')
          bodyMat.emissiveIntensity = 0.6
          stripeMat.color.set('#fecaca')
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
      gateLaserMatRef.current.opacity = nearGate ? 0.5 : 0.2
    }
    if (gripperTipMatRef.current) {
      gripperTipMatRef.current.color.set(pickSuccess ? '#10b981' : '#ef4444')
      gripperTipMatRef.current.emissive.set(pickSuccess ? '#059669' : '#dc2626')
      gripperTipMatRef.current.emissiveIntensity = 1.3
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
      {/* 0. INTEGRATED 3D FACTORY FLOOR, GUARDRAILS, CONTACT SHADOWS & 3D HALL BACKDROP */}
      <FactoryHallEnvironment />

      {/* =====================================================================
          1. INDUSTRIAL PLC CABINET & FIXED ROBOT PEDESTAL AT x = -1.0 .. 0.0
             (Bolted directly to the factory concrete floor y = 0)
         ===================================================================== */}
      <group>
        {/* Industrial PLC Enclosure Cabinet & Andon Stack Tower on Left (x = -0.98, z = -0.28) */}
        <group position={[-0.98, 0, -0.28]}>
          <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.56, 1.64, 0.46]} />
            <meshStandardMaterial color="#334155" metalness={0.68} roughness={0.32} />
          </mesh>
          <mesh position={[0, 0.85, 0.235]}>
            <boxGeometry args={[0.46, 1.44, 0.015]} />
            <meshStandardMaterial color="#475569" metalness={0.62} roughness={0.34} />
          </mesh>
          {/* Glowing PLC Diagnostic HMI Screen */}
          <mesh position={[0, 1.15, 0.248]}>
            <boxGeometry args={[0.34, 0.24, 0.01]} />
            <meshStandardMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.85} />
          </mesh>
          {/* 3-Light Industrial Andon Stack Tower (Red / Amber / Green) */}
          <group position={[0, 1.64, 0]}>
            <mesh position={[0, 0.18, 0]}>
              <cylinderGeometry args={[0.024, 0.024, 0.36, 12]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.068, 0.068, 0.1, 18]} />
              <meshStandardMaterial ref={andonGreenMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.5} />
            </mesh>
            <mesh position={[0, 0.49, 0]}>
              <cylinderGeometry args={[0.068, 0.068, 0.1, 18]} />
              <meshStandardMaterial ref={andonAmberMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
            </mesh>
            <mesh position={[0, 0.6, 0]}>
              <cylinderGeometry args={[0.068, 0.068, 0.1, 18]} />
              <meshStandardMaterial ref={andonRedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
            </mesh>
          </group>
        </group>

        {/* Heavy Cast-Steel Robot Base Bolted to Factory Floor at x = 0 */}
        <mesh position={[0, 0.07, -0.18]} receiveShadow castShadow>
          <boxGeometry args={[1.18, 0.14, 0.98]} />
          <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.15, -0.2]} receiveShadow>
          <boxGeometry args={[0.96, 0.04, 0.82]} />
          <meshStandardMaterial color="#475569" metalness={0.75} roughness={0.26} />
        </mesh>
        <mesh position={[0, 0.86, -0.32]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 1.46, 0.42]} />
          <meshStandardMaterial color="#334155" metalness={0.76} roughness={0.3} />
        </mesh>

        {/* Fixed Revolute Joint Servo Turret Housing at [0, PIVOT_Y, 0] */}
        <mesh position={[0, PIVOT_Y, -0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.32, 0.36, 0.4, 32]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.24} />
        </mesh>
        <mesh position={[0, PIVOT_Y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.06, 28]} />
          <meshStandardMaterial color="#64748b" metalness={0.88} roughness={0.2} />
        </mesh>

        {/* Compact Status LEDs & Thermal Bar on Robot Pedestal */}
        <group position={[-0.38, 0.86, -0.15]}>
          <mesh>
            <boxGeometry args={[0.28, 0.78, 0.08]} />
            <meshStandardMaterial color="#0f172a" metalness={0.65} roughness={0.35} />
          </mesh>
          <mesh position={[-0.065, -0.04, 0.045]}>
            <boxGeometry args={[0.05, 0.5, 0.02]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <group ref={thermalBarGroupRef} position={[-0.065, -0.29, 0.055]}>
            <mesh position={[0, 0.25, 0]}>
              <boxGeometry args={[0.042, 0.5, 0.02]} />
              <meshStandardMaterial
                ref={thermalBarMatRef}
                color="#10b981"
                emissive="#10b981"
                emissiveIntensity={0.85}
              />
            </mesh>
          </group>
          <mesh position={[0.055, 0.16, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={tempLedMatRef} color="#10b981" emissive="#10b981" emissiveIntensity={1.1} />
          </mesh>
          <mesh position={[0.055, 0.02, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={coolingLedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>
          <mesh position={[0.055, -0.12, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={estopLedMatRef} color="#334155" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>
          <group ref={coolingFanRef} position={[0.055, -0.26, 0.05]}>
            {[0, 1, 2].map(b => (
              <mesh key={b} rotation={[0, 0, (b * Math.PI) / 3]}>
                <boxGeometry args={[0.085, 0.02, 0.01]} />
                <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.6} />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      {/* =====================================================================
          2. COMPACT INDUSTRIAL ROTARY ENCODER RING ON JOINT HOUSING (r = 0.52)
             (Replaces the giant floating textbook protractor so it looks like a real machine!)
         ===================================================================== */}
      <group position={[0, PIVOT_Y, -0.11]}>
        <mesh>
          <ringGeometry args={[0.48, 0.52, 48, 1, -Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#64748b" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
        {DEGREE_TICKS.map(deg => {
          const rad = (deg * Math.PI) / 180
          const tickLen = 0.07
          const rMid = 0.5 - tickLen * 0.5
          return (
            <group key={deg} position={[rMid * Math.cos(rad), rMid * Math.sin(rad), 0]} rotation={[0, 0, rad]}>
              <mesh>
                <boxGeometry args={[tickLen, 0.016, 0.004]} />
                <meshBasicMaterial color={deg === 30 ? '#34d399' : '#94a3b8'} />
              </mesh>
            </group>
          )
        })}
      </group>

      {/* =====================================================================
          3. REQUIREMENT 9 — VISIBLE ANGULAR ERROR ARC (r = 0.52..1.08)
         ===================================================================== */}
      <mesh ref={errorArcMeshRef} position={[0, PIVOT_Y, -0.08]} geometry={errorArcGeometry}>
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
          <cylinderGeometry args={[0.19, 0.19, 0.09, 24]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#059669"
            emissiveIntensity={0.55}
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.16, 0.08]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#059669"
            emissiveIntensity={0.55}
            transparent
            opacity={0.32}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.045]}>
          <boxGeometry args={[ARM_LENGTH, 0.024, 0.01]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.85} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0]}>
          <ringGeometry args={[0.13, 0.19, 28]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* =====================================================================
          5. REQUIREMENT 8 — ACTUAL CONTROLLED 1-DOF RIGID ARM
          Pivoting about +Z at [0, PIVOT_Y, 0], extending along +X to L = 1.62
         ===================================================================== */}
      <group ref={armGroupRef} position={[0, PIVOT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.2, 32]} />
          <meshStandardMaterial color={accentColor} metalness={0.65} roughness={0.25} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.11]}>
          <cylinderGeometry args={[0.1, 0.1, 0.04, 20]} />
          <meshStandardMaterial color="#0f172a" metalness={0.88} roughness={0.2} />
        </mesh>
        <mesh position={[-0.2, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.24, 0.16]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.28} />
        </mesh>

        {/* Main 1-DOF Rigid Structural Arm Boom */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARM_LENGTH, 0.19, 0.15]} />
          <meshStandardMaterial
            color={primaryColor}
            emissive={accentColor}
            emissiveIntensity={0.22}
            metalness={0.55}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.08]}>
          <boxGeometry args={[ARM_LENGTH - 0.28, 0.065, 0.014]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.75} roughness={0.2} />
        </mesh>

        {/* Endpoint Magnetic/Vacuum Transfer Head at x = ARM_LENGTH */}
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.18, 28]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.22} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.024, 20]} />
          <meshStandardMaterial ref={gripperTipMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.2} />
        </mesh>

        {/* ===================================================================
            6. REQUIREMENT 10 — ENDPOINT PAYLOAD MASS AT x = ARM_LENGTH
           =================================================================== */}
        <group ref={payloadRef} position={[ARM_LENGTH - 0.2, -0.22, 0]} visible={false}>
          <mesh position={[0, 0.1, 0]} castShadow>
            <boxGeometry args={[0.08, 0.12, 0.1]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.28, 24]} />
            <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.26} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.196, 0.196, 0.11, 24]} />
            <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.45} />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          7. GROUNDED 2-TIER INDUSTRIAL CONVEYOR MACHINE (x = 1.58 .. 3.48)
             Bolted directly to the factory floor with a solid steel lower cabinet
             base (y = 0 .. 1.02) and structural steel frame up to the Upper
             30.0° Pass Conveyor (y = 2.16)!
         ===================================================================== */}
      <group>
        {/* Glowing Transfer Bridge Pulse between 30.0° Arm Tip and Upper Conveyor Entrance */}
        <mesh ref={transferPulseRef} position={[CONV_X_START - 0.09, TARGET_TIP_Y, 0]}>
          <boxGeometry args={[0.18, 0.045, 0.2]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.75} />
        </mesh>

        {/* --- SOLID GROUNDED MACHINE BASE CABINET UNDER CONVEYOR (y = 0 .. LOWER_DECK_Y = 1.02) --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y * 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, LOWER_DECK_Y * 0.96, 0.56]} />
          <meshStandardMaterial color="#1e293b" metalness={0.72} roughness={0.34} />
        </mesh>
        {/* recessed sheet-metal access doors on conveyor base cabinet */}
        {[CONV_X_START + 0.48, CONV_X_END - 0.48].map((dx, idx) => (
          <mesh key={idx} position={[dx, LOWER_DECK_Y * 0.48, 0.285]}>
            <boxGeometry args={[0.72, LOWER_DECK_Y * 0.72, 0.015]} />
            <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.35} />
          </mesh>
        ))}
        {/* Yellow/Black floor kickplate along bottom of conveyor machine */}
        <mesh position={[CONV_X_MID, 0.05, 0.29]}>
          <boxGeometry args={[CONV_X_SPAN + 0.1, 0.08, 0.015]} />
          <meshBasicMaterial color="#eab308" />
        </mesh>

        {/* --- A. UPPER 30.0° TARGET PASS CONVEYOR (x = 1.58 .. 3.48, y = 2.16) --- */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN, 0.11, 0.58]} />
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.3} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, 0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.055, 0.035]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, -0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.055, 0.035]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.5} />
        </mesh>
        {[CONV_X_START + 0.04, CONV_X_END - 0.04].map((rx, idx) => (
          <mesh key={idx} position={[rx, UPPER_DECK_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.56, 18]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.22} />
          </mesh>
        ))}

        {/* Laser Photo-Eye Scanner Arch at Left Entrance of Upper Conveyor */}
        <group position={[CONV_X_START, UPPER_DECK_Y + 0.21, 0]}>
          <mesh position={[0, 0, -0.28]}>
            <boxGeometry args={[0.055, 0.4, 0.045]} />
            <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.19, 0]}>
            <boxGeometry args={[0.065, 0.05, 0.6]} />
            <meshStandardMaterial ref={gateBeaconMatRef} color="#10b981" emissive="#059669" emissiveIntensity={1.4} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.015, 0.36, 0.52]} />
            <meshBasicMaterial ref={gateLaserMatRef} color="#10b981" transparent opacity={0.3} />
          </mesh>
        </group>

        {/* Upper Pass Outfeed Tunnel ("FINISHED GOODS BAY") at Right End */}
        <group position={[CONV_X_END + 0.14, UPPER_DECK_Y + 0.21, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.46, 0.64]} />
            <meshStandardMaterial color="#0f172a" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[-0.165, 0.17, 0]}>
            <boxGeometry args={[0.02, 0.055, 0.58]} />
            <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={1.1} />
          </mesh>
        </group>

        {/* --- B. LOWER WAIST-HIGH REJECT CONVEYOR DECK (y = 1.02) --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.11, 0.62]} />
          <meshStandardMaterial color="#0f172a" metalness={0.78} roughness={0.32} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, 0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.055, 0.035]} />
          <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.45} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, -0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.055, 0.035]} />
          <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.45} />
        </mesh>

        {/* Lower Reject Scrap Hopper Hood at Right End */}
        <group position={[CONV_X_END + 0.14, LOWER_DECK_Y + 0.2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.34, 0.42, 0.66]} />
            <meshStandardMaterial color="#1e293b" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh position={[-0.175, 0.15, 0]}>
            <boxGeometry args={[0.02, 0.055, 0.6]} />
            <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={1.0} />
          </mesh>
        </group>

        {/* Structural Steel Frame Columns connecting Lower Base (y = 1.02) to Upper Deck (y = 2.16) */}
        {[CONV_X_START + 0.12, CONV_X_MID, CONV_X_END - 0.12].map((sx, idx) => (
          <mesh key={idx} position={[sx, (LOWER_DECK_Y + UPPER_DECK_Y) * 0.5, -0.27]} castShadow>
            <boxGeometry args={[0.085, UPPER_DECK_Y - LOWER_DECK_Y, 0.085]} />
            <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.28} />
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
              <boxGeometry args={[0.04, 0.014, 0.5]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
            <mesh
              ref={el => {
                lowerSlatsRefs.current[i] = el
              }}
              position={[CONV_X_START + (i / NUM_BELT_SLATS) * CONV_X_SPAN, LOWER_DECK_Y + 0.06, 0]}
            >
              <boxGeometry args={[0.04, 0.014, 0.54]} />
              <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
            </mesh>
          </group>
        ))}

        {/* 3 Cycling Workpiece Crates */}
        {Array.from({ length: NUM_WORKPIECES }).map((_, i) => (
          <group
            key={i}
            ref={el => {
              workpieceGroupRefs.current[i] = el
            }}
            position={[CONV_X_START + (i / NUM_WORKPIECES) * CONV_X_SPAN, UPPER_BOX_Y, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.23, 0.2, 0.24]} />
              <meshStandardMaterial
                ref={el => {
                  workpieceBodyMatRefs.current[i] = el
                }}
                color="#10b981"
                emissive="#059669"
                emissiveIntensity={0.55}
                metalness={0.38}
                roughness={0.28}
              />
            </mesh>
            <mesh position={[0, 0.105, 0]}>
              <boxGeometry args={[0.19, 0.02, 0.2]} />
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
