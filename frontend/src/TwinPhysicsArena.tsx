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

  // Create a smooth alpha-fade floor canvas texture so the 3D floor dissolves seamlessly into factory-bg.jpg
  const floorFadeTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256)
      // Back edge (z = -3.6) is completely transparent (0.0) so factory-bg.jpg floor shows through seamlessly;
      // Foreground under the machine (z = -0.6..+1.5) is softly grounded (0.82)
      grad.addColorStop(0.0, 'rgba(34, 42, 52, 0.0)')
      grad.addColorStop(0.32, 'rgba(34, 42, 52, 0.55)')
      grad.addColorStop(0.65, 'rgba(33, 41, 50, 0.84)')
      grad.addColorStop(1.0, 'rgba(30, 37, 46, 0.90)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 64, 256)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [])

  return (
    <group>
      {/* 1. Color-Graded 3D Factory Hall Backdrop aligned with the horizon */}
      <mesh position={[1.35, 2.25, -4.2]}>
        <planeGeometry args={[17.5, 8.2]} />
        <meshBasicMaterial map={texture} color="#d6dde6" />
      </mesh>

      {/* 2. Seamlessly Feathered 3D Concrete Floor Pad (dissolves into the photo's floor at z = -3.4) */}
      <mesh position={[1.35, -0.004, -0.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16.0, 5.8]} />
        <meshStandardMaterial
          map={floorFadeTexture}
          transparent
          roughness={0.34}
          metalness={0.35}
          depthWrite={false}
        />
      </mesh>

      {/* 3. Weathered Industrial Traffic-Yellow Safety Aisle Line (matches yellow lines in factory-bg.jpg) */}
      <mesh position={[1.35, 0.003, 0.82]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8.5, 0.055]} />
        <meshBasicMaterial color="#b88c28" transparent opacity={0.62} />
      </mesh>

      {/* 4. Brushed Aluminum Tubular Safety Guardrail in Rear Aisle (matches silver rails in factory-bg.jpg) */}
      <group position={[1.35, 0, -0.88]}>
        {[-2.4, -0.8, 0.8, 2.4, 4.0].map(px => (
          <mesh key={px} position={[px - 1.35, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.024, 0.024, 0.88, 12]} />
            <meshStandardMaterial color="#7c8794" metalness={0.78} roughness={0.32} />
          </mesh>
        ))}
        <mesh position={[0, 0.84, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, 7.6, 12]} />
          <meshStandardMaterial color="#8d99a6" metalness={0.82} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.46, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.018, 0.018, 7.6, 12]} />
          <meshStandardMaterial color="#737e8c" metalness={0.78} roughness={0.32} />
        </mesh>
      </group>

      {/* 5. Soft Grounding Contact Shadows under the Robot, PLC Cabinet, and Conveyor Machine */}
      <ContactShadows
        position={[1.35, 0.005, 0]}
        opacity={0.72}
        scale={8.8}
        blur={1.9}
        far={3.2}
        resolution={512}
        color="#0b0f17"
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

  // Color-matched to the industrial KUKA/ABB robots & steel gantries in factory-bg.jpg:
  // Left (Legacy PLC): Burnt Industrial Copper-Orange (#c25929 / #9c421a)
  // Right (Evolved PLC): Anodized Industrial Steel-Teal (#2b7c94 / #1e5c70)
  const primaryColor = side === 'left' ? '#c25929' : '#2b7c94'
  const accentColor = side === 'left' ? '#9c421a' : '#1e5c70'

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
      errorArcMatRef.current.color.set(absErr > 3.2 ? '#c53030' : '#b7791f')
      errorArcMatRef.current.opacity = 0.34
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
          // Industrial graphite tote with muted sage-emerald pass beacon
          group.position.set(x, UPPER_BOX_Y, 0)
          group.rotation.set(0, 0, 0)
          bodyMat.color.set('#374151')
          bodyMat.emissive.set('#1e3a2f')
          bodyMat.emissiveIntensity = 0.35
          stripeMat.color.set('#38a169')
          stripeMat.emissive.set('#276749')
          stripeMat.emissiveIntensity = 0.55
        } else {
          // Sagged arm -> Tote drops onto lower reject belt with industrial crimson fault beacon
          const startY = itemDropStartYRef.current[i] ?? currentTipY
          const fallPhase = Math.min(1, u * 2.8)
          const y = startY - (startY - LOWER_BOX_Y) * (fallPhase * fallPhase)
          const tiltZ = fallPhase < 1 ? -fallPhase * 0.55 : -0.14
          group.position.set(x, y, 0)
          group.rotation.set(0, 0, tiltZ)
          bodyMat.color.set('#3f2e32')
          bodyMat.emissive.set('#4a1c1c')
          bodyMat.emissiveIntensity = 0.4
          stripeMat.color.set('#c53030')
          stripeMat.emissive.set('#9b2c2c')
          stripeMat.emissiveIntensity = 0.65
        }
      }
    }

    if (transferPulseRef.current) {
      transferPulseRef.current.visible = pickSuccess && nearGate
    }

    // Update Gate Beacon, Laser Curtain & Gripper Tip LED colors (industrial toned)
    if (gateBeaconMatRef.current) {
      gateBeaconMatRef.current.color.set(pickSuccess ? '#38a169' : '#c53030')
      gateBeaconMatRef.current.emissive.set(pickSuccess ? '#276749' : '#9b2c2c')
      gateBeaconMatRef.current.emissiveIntensity = pickSuccess ? 0.9 : 1.3
    }
    if (gateLaserMatRef.current) {
      gateLaserMatRef.current.color.set(pickSuccess ? '#48bb78' : '#e53e3e')
      gateLaserMatRef.current.opacity = nearGate ? 0.34 : 0.14
    }
    if (gripperTipMatRef.current) {
      gripperTipMatRef.current.color.set(pickSuccess ? '#38a169' : '#c53030')
      gripperTipMatRef.current.emissive.set(pickSuccess ? '#276749' : '#9b2c2c')
      gripperTipMatRef.current.emissiveIntensity = 0.95
    }

    // Update Andon Stack Light Tower (Red / Amber / Green) on PLC Cabinet
    const flash = 0.6 + 0.8 * Math.abs(Math.sin(clock.elapsedTime * 8))
    if (andonRedMatRef.current) {
      const redOn = estop || !pickSuccess
      andonRedMatRef.current.color.set(redOn ? '#c53030' : '#3e4752')
      andonRedMatRef.current.emissive.set(redOn ? '#9b2c2c' : '#1f262e')
      andonRedMatRef.current.emissiveIntensity = redOn ? flash * 1.4 : 0.05
    }
    if (andonAmberMatRef.current) {
      const amberOn = cooling || (absErr > 1.5 && absErr <= 3.2)
      andonAmberMatRef.current.color.set(amberOn ? '#d69e2e' : '#3e4752')
      andonAmberMatRef.current.emissive.set(amberOn ? '#b7791f' : '#1f262e')
      andonAmberMatRef.current.emissiveIntensity = amberOn ? 1.1 : 0.05
    }
    if (andonGreenMatRef.current) {
      const greenOn = pickSuccess
      andonGreenMatRef.current.color.set(greenOn ? '#38a169' : '#3e4752')
      andonGreenMatRef.current.emissive.set(greenOn ? '#276749' : '#1f262e')
      andonGreenMatRef.current.emissiveIntensity = greenOn ? 1.1 : 0.05
    }

    // Fixed Base Thermal / Cooling / E-Stop LEDs
    const tempRatio = THREE.MathUtils.clamp((temp - 20) / 80, 0.08, 1.0)
    const tempHex = temp >= 88 ? '#c53030' : temp >= 72 ? '#d69e2e' : '#38a169'
    if (thermalBarGroupRef.current) {
      thermalBarGroupRef.current.scale.y = tempRatio
    }
    if (thermalBarMatRef.current) {
      thermalBarMatRef.current.color.set(tempHex)
      thermalBarMatRef.current.emissive.set(tempHex)
      thermalBarMatRef.current.emissiveIntensity = temp >= 88 ? 1.2 : 0.65
    }
    if (tempLedMatRef.current) {
      tempLedMatRef.current.color.set(tempHex)
      tempLedMatRef.current.emissive.set(tempHex)
      tempLedMatRef.current.emissiveIntensity = temp >= 88 ? 1.5 : 0.8
    }
    if (coolingLedMatRef.current) {
      const coolHex = cooling ? '#319795' : '#3e4752'
      coolingLedMatRef.current.color.set(coolHex)
      coolingLedMatRef.current.emissive.set(cooling ? '#285e61' : '#1f262e')
      coolingLedMatRef.current.emissiveIntensity = cooling ? 1.2 : 0.05
    }
    if (estopLedMatRef.current) {
      const estopHex = estop ? '#c53030' : '#3e4752'
      estopLedMatRef.current.color.set(estopHex)
      estopLedMatRef.current.emissive.set(estop ? '#9b2c2c' : '#1f262e')
      estopLedMatRef.current.emissiveIntensity = estop ? flash * 1.4 : 0.05
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
        hudRefs.conveyorStatusRef.current.style.backgroundColor = 'rgba(155, 44, 44, 0.92)'
      } else if (pickSuccess) {
        hudRefs.conveyorStatusRef.current.textContent = `✓ PASSING TO UPPER BELT (θ = ${angle.toFixed(1)}°)`
        hudRefs.conveyorStatusRef.current.style.backgroundColor = 'rgba(39, 103, 73, 0.92)'
      } else {
        hudRefs.conveyorStatusRef.current.textContent = `✗ ARM SAGGED (${angle.toFixed(1)}°) — DROPPING TO REJECT BELT`
        hudRefs.conveyorStatusRef.current.style.backgroundColor = 'rgba(155, 44, 44, 0.92)'
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
      {/* 0. COLOR-MATCHED 3D FACTORY FLOOR, GUARDRAILS, CONTACT SHADOWS & HALL BACKDROP */}
      <FactoryHallEnvironment />

      {/* =====================================================================
          1. INDUSTRIAL PLC CABINET & FIXED ROBOT PEDESTAL AT x = -1.0 .. 0.0
             (Color-graded in brushed gunmetal & warm industrial steel to match factory-bg.jpg)
         ===================================================================== */}
      <group>
        {/* Industrial PLC Enclosure Cabinet & Andon Stack Tower on Left (x = -0.98, z = -0.28) */}
        <group position={[-0.98, 0, -0.28]}>
          <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.56, 1.64, 0.46]} />
            <meshStandardMaterial color="#525d6b" metalness={0.62} roughness={0.38} />
          </mesh>
          <mesh position={[0, 0.85, 0.235]}>
            <boxGeometry args={[0.46, 1.44, 0.015]} />
            <meshStandardMaterial color="#687482" metalness={0.58} roughness={0.36} />
          </mesh>
          {/* Subtle Industrial HMI Panel */}
          <mesh position={[0, 1.15, 0.248]}>
            <boxGeometry args={[0.34, 0.22, 0.01]} />
            <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.25} />
          </mesh>
          <mesh position={[0, 1.15, 0.254]}>
            <boxGeometry args={[0.28, 0.14, 0.005]} />
            <meshStandardMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.45} />
          </mesh>
          {/* 3-Light Industrial Andon Stack Tower (Red / Amber / Green) */}
          <group position={[0, 1.64, 0]}>
            <mesh position={[0, 0.18, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.36, 12]} />
              <meshStandardMaterial color="#8d99a6" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonGreenMatRef} color="#38a169" emissive="#276749" emissiveIntensity={1.1} />
            </mesh>
            <mesh position={[0, 0.485, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonAmberMatRef} color="#3e4752" emissive="#1f262e" emissiveIntensity={0.05} />
            </mesh>
            <mesh position={[0, 0.59, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonRedMatRef} color="#3e4752" emissive="#1f262e" emissiveIntensity={0.05} />
            </mesh>
          </group>
        </group>

        {/* Heavy Cast-Iron & Brushed-Steel Robot Base Bolted to Factory Floor at x = 0 */}
        <mesh position={[0, 0.07, -0.18]} receiveShadow castShadow>
          <boxGeometry args={[1.18, 0.14, 0.98]} />
          <meshStandardMaterial color="#343d48" metalness={0.72} roughness={0.34} />
        </mesh>
        <mesh position={[0, 0.15, -0.2]} receiveShadow>
          <boxGeometry args={[0.96, 0.04, 0.82]} />
          <meshStandardMaterial color="#64707d" metalness={0.68} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.86, -0.32]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 1.46, 0.42]} />
          <meshStandardMaterial color="#4a5562" metalness={0.68} roughness={0.34} />
        </mesh>

        {/* Fixed Revolute Joint Servo Turret Housing at [0, PIVOT_Y, 0] */}
        <mesh position={[0, PIVOT_Y, -0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.32, 0.36, 0.4, 32]} />
          <meshStandardMaterial color="#2b323b" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[0, PIVOT_Y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.06, 28]} />
          <meshStandardMaterial color="#7b8794" metalness={0.82} roughness={0.24} />
        </mesh>

        {/* Compact Status LEDs & Thermal Bar on Robot Pedestal */}
        <group position={[-0.38, 0.86, -0.15]}>
          <mesh>
            <boxGeometry args={[0.28, 0.78, 0.08]} />
            <meshStandardMaterial color="#252c35" metalness={0.65} roughness={0.35} />
          </mesh>
          <mesh position={[-0.065, -0.04, 0.045]}>
            <boxGeometry args={[0.05, 0.5, 0.02]} />
            <meshStandardMaterial color="#1b222a" />
          </mesh>
          <group ref={thermalBarGroupRef} position={[-0.065, -0.29, 0.055]}>
            <mesh position={[0, 0.25, 0]}>
              <boxGeometry args={[0.042, 0.5, 0.02]} />
              <meshStandardMaterial
                ref={thermalBarMatRef}
                color="#38a169"
                emissive="#276749"
                emissiveIntensity={0.65}
              />
            </mesh>
          </group>
          <mesh position={[0.055, 0.16, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={tempLedMatRef} color="#38a169" emissive="#276749" emissiveIntensity={0.8} />
          </mesh>
          <mesh position={[0.055, 0.02, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={coolingLedMatRef} color="#3e4752" emissive="#1f262e" emissiveIntensity={0.05} />
          </mesh>
          <mesh position={[0.055, -0.12, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={estopLedMatRef} color="#3e4752" emissive="#1f262e" emissiveIntensity={0.05} />
          </mesh>
          <group ref={coolingFanRef} position={[0.055, -0.26, 0.05]}>
            {[0, 1, 2].map(b => (
              <mesh key={b} rotation={[0, 0, (b * Math.PI) / 3]}>
                <boxGeometry args={[0.085, 0.02, 0.01]} />
                <meshStandardMaterial color="#718096" metalness={0.7} roughness={0.3} />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      {/* =====================================================================
          2. COMPACT INDUSTRIAL ROTARY ENCODER RING ON JOINT HOUSING (r = 0.52)
         ===================================================================== */}
      <group position={[0, PIVOT_Y, -0.11]}>
        <mesh>
          <ringGeometry args={[0.48, 0.51, 48, 1, -Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#64748b" transparent opacity={0.42} side={THREE.DoubleSide} />
        </mesh>
        {DEGREE_TICKS.map(deg => {
          const rad = (deg * Math.PI) / 180
          const tickLen = 0.065
          const rMid = 0.495 - tickLen * 0.5
          return (
            <group key={deg} position={[rMid * Math.cos(rad), rMid * Math.sin(rad), 0]} rotation={[0, 0, rad]}>
              <mesh>
                <boxGeometry args={[tickLen, 0.015, 0.004]} />
                <meshBasicMaterial color={deg === 30 ? '#48bb78' : '#94a3b8'} />
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
          color="#c53030"
          transparent
          opacity={0.34}
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
            color="#38a169"
            emissive="#276749"
            emissiveIntensity={0.35}
            transparent
            opacity={0.24}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.16, 0.08]} />
          <meshStandardMaterial
            color="#38a169"
            emissive="#276749"
            emissiveIntensity={0.35}
            transparent
            opacity={0.24}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.045]}>
          <boxGeometry args={[ARM_LENGTH, 0.022, 0.01]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.65} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0]}>
          <ringGeometry args={[0.13, 0.18, 28]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.72} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* =====================================================================
          5. REQUIREMENT 8 — ACTUAL CONTROLLED 1-DOF RIGID ARM
          Pivoting about +Z at [0, PIVOT_Y, 0], extending along +X to L = 1.62
         ===================================================================== */}
      <group ref={armGroupRef} position={[0, PIVOT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.2, 32]} />
          <meshStandardMaterial color={accentColor} metalness={0.62} roughness={0.32} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.11]}>
          <cylinderGeometry args={[0.1, 0.1, 0.04, 20]} />
          <meshStandardMaterial color="#252c35" metalness={0.82} roughness={0.26} />
        </mesh>
        <mesh position={[-0.2, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.24, 0.16]} />
          <meshStandardMaterial color="#3b4450" metalness={0.75} roughness={0.32} />
        </mesh>

        {/* Main 1-DOF Rigid Structural Arm Boom */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARM_LENGTH, 0.19, 0.15]} />
          <meshStandardMaterial
            color={primaryColor}
            emissive={accentColor}
            emissiveIntensity={0.12}
            metalness={0.58}
            roughness={0.32}
          />
        </mesh>
        {/* Brushed aluminum side stiffener rail */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.08]}>
          <boxGeometry args={[ARM_LENGTH - 0.28, 0.062, 0.014]} />
          <meshStandardMaterial color="#9aa5b1" metalness={0.78} roughness={0.28} />
        </mesh>

        {/* Endpoint Magnetic/Vacuum Transfer Head at x = ARM_LENGTH */}
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.18, 28]} />
          <meshStandardMaterial color="#2b323b" metalness={0.82} roughness={0.26} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.078, 0.078, 0.024, 20]} />
          <meshStandardMaterial ref={gripperTipMatRef} color="#38a169" emissive="#276749" emissiveIntensity={0.9} />
        </mesh>

        {/* ===================================================================
            6. REQUIREMENT 10 — ENDPOINT PAYLOAD MASS AT x = ARM_LENGTH
           =================================================================== */}
        <group ref={payloadRef} position={[ARM_LENGTH - 0.2, -0.22, 0]} visible={false}>
          <mesh position={[0, 0.1, 0]} castShadow>
            <boxGeometry args={[0.08, 0.12, 0.1]} />
            <meshStandardMaterial color="#64707d" metalness={0.8} roughness={0.28} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.28, 24]} />
            <meshStandardMaterial color="#2b323b" metalness={0.78} roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.196, 0.196, 0.1, 24]} />
            <meshStandardMaterial color="#c25929" metalness={0.5} roughness={0.35} />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          7. GROUNDED 2-TIER INDUSTRIAL CONVEYOR MACHINE (x = 1.58 .. 3.48)
             Color-matched in brushed steel, aluminum, and dark slate to blend
             naturally into the factory cells of factory-bg.jpg!
         ===================================================================== */}
      <group>
        {/* Subtle Transfer Alignment Bridge between 30.0° Arm Tip and Upper Conveyor Entrance */}
        <mesh ref={transferPulseRef} position={[CONV_X_START - 0.09, TARGET_TIP_Y, 0]}>
          <boxGeometry args={[0.18, 0.04, 0.18]} />
          <meshBasicMaterial color="#48bb78" transparent opacity={0.55} />
        </mesh>

        {/* --- SOLID GROUNDED MACHINE BASE CABINET UNDER CONVEYOR (y = 0 .. LOWER_DECK_Y = 1.02) --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y * 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, LOWER_DECK_Y * 0.96, 0.56]} />
          <meshStandardMaterial color="#3e4752" metalness={0.68} roughness={0.36} />
        </mesh>
        {/* Brushed steel access doors on conveyor base cabinet */}
        {[CONV_X_START + 0.48, CONV_X_END - 0.48].map((dx, idx) => (
          <mesh key={idx} position={[dx, LOWER_DECK_Y * 0.48, 0.285]}>
            <boxGeometry args={[0.72, LOWER_DECK_Y * 0.72, 0.015]} />
            <meshStandardMaterial color="#525d6b" metalness={0.62} roughness={0.36} />
          </mesh>
        ))}
        {/* Weathered yellow floor kickplate along bottom of conveyor machine */}
        <mesh position={[CONV_X_MID, 0.045, 0.29]}>
          <boxGeometry args={[CONV_X_SPAN + 0.1, 0.065, 0.015]} />
          <meshBasicMaterial color="#b88c28" />
        </mesh>

        {/* --- A. UPPER 30.0° TARGET PASS CONVEYOR (x = 1.58 .. 3.48, y = 2.16) --- */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN, 0.11, 0.58]} />
          <meshStandardMaterial color="#2d3540" metalness={0.72} roughness={0.34} />
        </mesh>
        {/* Brushed aluminum side rails with subtle emerald indicator trim */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, 0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.05, 0.03]} />
          <meshStandardMaterial color="#7b8794" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, -0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.05, 0.03]} />
          <meshStandardMaterial color="#7b8794" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.05, 0.318]}>
          <boxGeometry args={[CONV_X_SPAN - 0.08, 0.018, 0.008]} />
          <meshStandardMaterial color="#38a169" emissive="#276749" emissiveIntensity={0.45} />
        </mesh>
        {[CONV_X_START + 0.04, CONV_X_END - 0.04].map((rx, idx) => (
          <mesh key={idx} position={[rx, UPPER_DECK_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.56, 18]} />
            <meshStandardMaterial color="#687482" metalness={0.82} roughness={0.26} />
          </mesh>
        ))}

        {/* Laser Photo-Eye Scanner Arch at Left Entrance of Upper Conveyor */}
        <group position={[CONV_X_START, UPPER_DECK_Y + 0.21, 0]}>
          <mesh position={[0, 0, -0.28]}>
            <boxGeometry args={[0.055, 0.4, 0.045]} />
            <meshStandardMaterial color="#687482" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.19, 0]}>
            <boxGeometry args={[0.065, 0.045, 0.6]} />
            <meshStandardMaterial ref={gateBeaconMatRef} color="#38a169" emissive="#276749" emissiveIntensity={0.9} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.012, 0.36, 0.52]} />
            <meshBasicMaterial ref={gateLaserMatRef} color="#48bb78" transparent opacity={0.2} />
          </mesh>
        </group>

        {/* Upper Pass Outfeed Tunnel ("FINISHED GOODS BAY") at Right End */}
        <group position={[CONV_X_END + 0.14, UPPER_DECK_Y + 0.21, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.46, 0.64]} />
            <meshStandardMaterial color="#343d48" metalness={0.72} roughness={0.32} />
          </mesh>
          <mesh position={[-0.165, 0.17, 0]}>
            <boxGeometry args={[0.02, 0.045, 0.58]} />
            <meshStandardMaterial color="#38a169" emissive="#276749" emissiveIntensity={0.75} />
          </mesh>
        </group>

        {/* --- B. LOWER WAIST-HIGH REJECT CONVEYOR DECK (y = 1.02) --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.11, 0.62]} />
          <meshStandardMaterial color="#2d3540" metalness={0.72} roughness={0.34} />
        </mesh>
        {/* Brushed aluminum side rails with subtle crimson reject trim */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, 0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.05, 0.03]} />
          <meshStandardMaterial color="#687482" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, -0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.05, 0.03]} />
          <meshStandardMaterial color="#687482" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.055, 0.338]}>
          <boxGeometry args={[CONV_X_SPAN, 0.018, 0.008]} />
          <meshStandardMaterial color="#c53030" emissive="#9b2c2c" emissiveIntensity={0.45} />
        </mesh>

        {/* Lower Reject Scrap Hopper Hood at Right End */}
        <group position={[CONV_X_END + 0.14, LOWER_DECK_Y + 0.2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.34, 0.42, 0.66]} />
            <meshStandardMaterial color="#343d48" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh position={[-0.175, 0.15, 0]}>
            <boxGeometry args={[0.02, 0.045, 0.6]} />
            <meshStandardMaterial color="#c53030" emissive="#9b2c2c" emissiveIntensity={0.75} />
          </mesh>
        </group>

        {/* Brushed Steel Frame Columns connecting Lower Base (y = 1.02) to Upper Deck (y = 2.16) */}
        {[CONV_X_START + 0.12, CONV_X_MID, CONV_X_END - 0.12].map((sx, idx) => (
          <mesh key={idx} position={[sx, (LOWER_DECK_Y + UPPER_DECK_Y) * 0.5, -0.27]} castShadow>
            <boxGeometry args={[0.085, UPPER_DECK_Y - LOWER_DECK_Y, 0.085]} />
            <meshStandardMaterial color="#687482" metalness={0.78} roughness={0.28} />
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
              <meshStandardMaterial color="#525d6b" metalness={0.65} roughness={0.35} />
            </mesh>
            <mesh
              ref={el => {
                lowerSlatsRefs.current[i] = el
              }}
              position={[CONV_X_START + (i / NUM_BELT_SLATS) * CONV_X_SPAN, LOWER_DECK_Y + 0.06, 0]}
            >
              <boxGeometry args={[0.04, 0.014, 0.54]} />
              <meshStandardMaterial color="#525d6b" metalness={0.65} roughness={0.35} />
            </mesh>
          </group>
        ))}

        {/* 3 Cycling Industrial Workpiece Totes */}
        {Array.from({ length: NUM_WORKPIECES }).map((_, i) => (
          <group
            key={i}
            ref={el => {
              workpieceGroupRefs.current[i] = el
            }}
            position={[CONV_X_START + (i / NUM_WORKPIECES) * CONV_X_SPAN, UPPER_BOX_Y, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.23, 0.19, 0.24]} />
              <meshStandardMaterial
                ref={el => {
                  workpieceBodyMatRefs.current[i] = el
                }}
                color="#374151"
                emissive="#1e3a2f"
                emissiveIntensity={0.35}
                metalness={0.55}
                roughness={0.32}
              />
            </mesh>
            <mesh position={[0, 0.1, 0]}>
              <boxGeometry args={[0.19, 0.025, 0.2]} />
              <meshStandardMaterial
                ref={el => {
                  workpieceStripeMatRefs.current[i] = el
                }}
                color="#38a169"
                emissive="#276749"
                emissiveIntensity={0.55}
                metalness={0.5}
                roughness={0.28}
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
