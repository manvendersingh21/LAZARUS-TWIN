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

export function FactoryHallEnvironment() {
  const texture = useLoader(THREE.TextureLoader, '/factory-bg.jpg')

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
  }, [texture])

  // Smooth alpha-fade floor canvas texture so the 3D floor dissolves seamlessly into factory-bg.jpg & dark grid
  const floorFadeTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256)
      grad.addColorStop(0.0, 'rgba(10, 18, 23, 0.0)')
      grad.addColorStop(0.35, 'rgba(13, 24, 30, 0.52)')
      grad.addColorStop(0.7, 'rgba(12, 22, 27, 0.82)')
      grad.addColorStop(1.0, 'rgba(10, 18, 23, 0.92)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 64, 256)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [])

  return (
    <group>
      {/* 1. Dark Cyber-Graded 3D Factory Hall Backdrop aligned with the horizon */}
      <mesh position={[0, 3.35, -4.8]}>
        <planeGeometry args={[28.0, 12.2]} />
        <meshBasicMaterial map={texture} color="#586c78" transparent opacity={0.78} />
      </mesh>

      {/* 2. Seamlessly Feathered 3D Concrete Floor Pad */}
      <mesh position={[0, -0.004, -0.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24.0, 8.5]} />
        <meshStandardMaterial
          map={floorFadeTexture}
          transparent
          roughness={0.34}
          metalness={0.4}
          depthWrite={false}
        />
      </mesh>

      {/* 3. Weathered Industrial Traffic-Yellow Safety Aisle Line */}
      <mesh position={[0, 0.003, 1.35]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14.8, 0.055]} />
        <meshBasicMaterial color="#c7a138" transparent opacity={0.55} />
      </mesh>

      {/* 4. Brushed Aluminum Tubular Safety Guardrail in Rear Aisle */}
      <group position={[0, 0, -1.35]}>
        {[-6.0, -3.0, 0, 3.0, 6.0].map(px => (
          <mesh key={px} position={[px, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.024, 0.024, 0.88, 12]} />
            <meshStandardMaterial color="#5c747c" metalness={0.78} roughness={0.32} />
          </mesh>
        ))}
        <mesh position={[0, 0.84, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.022, 13.2, 12]} />
          <meshStandardMaterial color="#6e8991" metalness={0.82} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.46, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.018, 0.018, 13.2, 12]} />
          <meshStandardMaterial color="#536b73" metalness={0.78} roughness={0.32} />
        </mesh>
      </group>

      {/* 5. Soft Grounding Contact Shadows under the PLC Cabinet, Both Robots, and Conveyors */}
      <ContactShadows
        position={[0, 0.005, 0.2]}
        opacity={0.75}
        scale={16.5}
        blur={2.0}
        far={3.6}
        resolution={512}
        color="#04080b"
      />
    </group>
  )
}

export function SingleArmScene({
  side,
  frame,
  showPayload,
  hudRefs,
  includeEnvironment = false,
}: {
  side: 'left' | 'right'
  frame: MutableRefObject<Frame>
  showPayload?: boolean
  hudRefs?: ViewportHudRefs
  includeEnvironment?: boolean
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

  // Left (Legacy PLC): Industrial Copper-Orange (#d96b38 / #a64b22)
  // Right (Recovered Evolved Twin): Cyber Emerald-Teal (#38b2ac / #2c7a7b)
  const primaryColor = side === 'left' ? '#d96b38' : '#38b2ac'
  const accentColor = side === 'left' ? '#a64b22' : '#285e61'

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

    // Direct physics state from backend Arm.step()
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

    const thetaRad = (angle * Math.PI) / 180
    const targetRad = (target * Math.PI) / 180

    if (armGroupRef.current) {
      armGroupRef.current.rotation.z = thetaRad
    }
    if (ghostGroupRef.current) {
      ghostGroupRef.current.rotation.z = targetRad
    }

    // Dynamically update angular error sector between thetaRad and targetRad
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
      errorArcMatRef.current.color.set(absErr > 3.2 ? '#ff4d5e' : '#f5a623')
      errorArcMatRef.current.opacity = 0.36
    }

    if (payloadRef.current) {
      payloadRef.current.visible = sabotage
    }

    // =========================================================================
    // LEFT-TO-RIGHT (+X) DUAL CONVEYOR BELT & WORKPIECE TRANSFER / DROP LOGIC
    // =========================================================================
    const beltRunning = !f.paused && !estop
    if (beltRunning) {
      beltPhaseRef.current = (beltPhaseRef.current + delta * 0.42) % 1
    }

    for (let i = 0; i < NUM_BELT_SLATS; i++) {
      const u = (beltPhaseRef.current * 2.5 + i / NUM_BELT_SLATS) % 1
      const xPos = CONV_X_START + 0.08 + u * (CONV_X_SPAN - 0.16)
      const upSlat = upperSlatsRefs.current[i]
      if (upSlat) upSlat.position.x = xPos
      const lowSlat = lowerSlatsRefs.current[i]
      if (lowSlat) lowSlat.position.x = xPos
    }

    const currentTipY = Math.max(LOWER_BOX_Y + 0.15, PIVOT_Y + ARM_LENGTH * Math.sin(thetaRad))

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
          group.position.set(x, UPPER_BOX_Y, 0)
          group.rotation.set(0, 0, 0)
          bodyMat.color.set('#283b36')
          bodyMat.emissive.set('#1b4332')
          bodyMat.emissiveIntensity = 0.45
          stripeMat.color.set('#6effc5')
          stripeMat.emissive.set('#38a169')
          stripeMat.emissiveIntensity = 0.85
        } else {
          const startY = itemDropStartYRef.current[i] ?? currentTipY
          const fallPhase = Math.min(1, u * 2.8)
          const y = startY - (startY - LOWER_BOX_Y) * (fallPhase * fallPhase)
          const tiltZ = fallPhase < 1 ? -fallPhase * 0.55 : -0.14
          group.position.set(x, y, 0)
          group.rotation.set(0, 0, tiltZ)
          bodyMat.color.set('#3f2327')
          bodyMat.emissive.set('#5c1922')
          bodyMat.emissiveIntensity = 0.5
          stripeMat.color.set('#ff4d5e')
          stripeMat.emissive.set('#e11d48')
          stripeMat.emissiveIntensity = 0.9
        }
      }
    }

    if (transferPulseRef.current) {
      transferPulseRef.current.visible = pickSuccess && nearGate
    }

    if (gateBeaconMatRef.current) {
      gateBeaconMatRef.current.color.set(pickSuccess ? '#6effc5' : '#ff4d5e')
      gateBeaconMatRef.current.emissive.set(pickSuccess ? '#38a169' : '#e11d48')
      gateBeaconMatRef.current.emissiveIntensity = pickSuccess ? 1.0 : 1.4
    }
    if (gateLaserMatRef.current) {
      gateLaserMatRef.current.color.set(pickSuccess ? '#6effc5' : '#ff4d5e')
      gateLaserMatRef.current.opacity = nearGate ? 0.38 : 0.16
    }
    if (gripperTipMatRef.current) {
      gripperTipMatRef.current.color.set(pickSuccess ? '#6effc5' : '#ff4d5e')
      gripperTipMatRef.current.emissive.set(pickSuccess ? '#38a169' : '#e11d48')
      gripperTipMatRef.current.emissiveIntensity = 1.1
    }

    const flash = 0.6 + 0.8 * Math.abs(Math.sin(clock.elapsedTime * 8))
    if (andonRedMatRef.current) {
      const redOn = estop || !pickSuccess
      andonRedMatRef.current.color.set(redOn ? '#ff4d5e' : '#2d3748')
      andonRedMatRef.current.emissive.set(redOn ? '#e11d48' : '#1a202c')
      andonRedMatRef.current.emissiveIntensity = redOn ? flash * 1.4 : 0.05
    }
    if (andonAmberMatRef.current) {
      const amberOn = cooling || (absErr > 1.5 && absErr <= 3.2)
      andonAmberMatRef.current.color.set(amberOn ? '#f5a623' : '#2d3748')
      andonAmberMatRef.current.emissive.set(amberOn ? '#d97706' : '#1a202c')
      andonAmberMatRef.current.emissiveIntensity = amberOn ? 1.1 : 0.05
    }
    if (andonGreenMatRef.current) {
      const greenOn = pickSuccess
      andonGreenMatRef.current.color.set(greenOn ? '#6effc5' : '#2d3748')
      andonGreenMatRef.current.emissive.set(greenOn ? '#38a169' : '#1a202c')
      andonGreenMatRef.current.emissiveIntensity = greenOn ? 1.15 : 0.05
    }

    const tempRatio = THREE.MathUtils.clamp((temp - 20) / 80, 0.08, 1.0)
    const tempHex = temp >= 88 ? '#ff4d5e' : temp >= 72 ? '#f5a623' : '#6effc5'
    if (thermalBarGroupRef.current) {
      thermalBarGroupRef.current.scale.y = tempRatio
    }
    if (thermalBarMatRef.current) {
      thermalBarMatRef.current.color.set(tempHex)
      thermalBarMatRef.current.emissive.set(tempHex)
      thermalBarMatRef.current.emissiveIntensity = temp >= 88 ? 1.3 : 0.75
    }
    if (tempLedMatRef.current) {
      tempLedMatRef.current.color.set(tempHex)
      tempLedMatRef.current.emissive.set(tempHex)
      tempLedMatRef.current.emissiveIntensity = temp >= 88 ? 1.5 : 0.85
    }
    if (coolingLedMatRef.current) {
      const coolHex = cooling ? '#68c9ff' : '#2d3748'
      coolingLedMatRef.current.color.set(coolHex)
      coolingLedMatRef.current.emissive.set(cooling ? '#0284c7' : '#1a202c')
      coolingLedMatRef.current.emissiveIntensity = cooling ? 1.25 : 0.05
    }
    if (estopLedMatRef.current) {
      const estopHex = estop ? '#ff4d5e' : '#2d3748'
      estopLedMatRef.current.color.set(estopHex)
      estopLedMatRef.current.emissive.set(estop ? '#e11d48' : '#1a202c')
      estopLedMatRef.current.emissiveIntensity = estop ? flash * 1.4 : 0.05
    }
    if (coolingFanRef.current) {
      coolingFanRef.current.rotation.z += delta * (cooling ? 18 : 0.8)
    }

    if (hudRefs?.topTelemetryRef.current) {
      hudRefs.topTelemetryRef.current.textContent = `θ: ${angle.toFixed(1)}° / ${target.toFixed(1)}°  ·  Δθ: ${signedErr >= 0 ? '+' : ''}${signedErr.toFixed(1)}°  ·  PWM: ${pwm.toFixed(0)}%`
    }
    if (hudRefs?.conveyorStatusRef.current) {
      if (estop) {
        hudRefs.conveyorStatusRef.current.textContent = '✗ E-STOP LATCHED — BELT HALTED'
        hudRefs.conveyorStatusRef.current.className = 'workcell-conveyor-pill fault'
      } else if (pickSuccess) {
        hudRefs.conveyorStatusRef.current.textContent = `✓ PICKING ON UPPER BELT (${pickedCountRef.current} PASS)`
        hudRefs.conveyorStatusRef.current.className = 'workcell-conveyor-pill pass'
      } else {
        hudRefs.conveyorStatusRef.current.textContent = `✗ SAGGED (${angle.toFixed(1)}°) — DROPPING TO REJECT (${missedCountRef.current} MISS)`
        hudRefs.conveyorStatusRef.current.className = 'workcell-conveyor-pill fault'
      }
    }
    if (hudRefs?.conveyorYieldRef.current) {
      hudRefs.conveyorYieldRef.current.textContent = `PASS: ${pickedCountRef.current} · REJECT: ${missedCountRef.current}`
    }
    if (hudRefs?.bottomSafetyRef.current) {
      hudRefs.bottomSafetyRef.current.textContent = `ω: ${vel.toFixed(1)}°/s · TEMP: ${temp.toFixed(1)}°C · COOLING: ${cooling ? 'ON' : 'OFF'} · E-STOP: ${estop ? 'LATCHED' : 'OPEN'}`
    }
  })

  return (
    <group>
      {includeEnvironment && <FactoryHallEnvironment />}

      {/* =====================================================================
          1. INDUSTRIAL PLC JUNCTION CABINET & FIXED ROBOT PEDESTAL AT x = -0.98 .. 0.0
         ===================================================================== */}
      <group>
        {/* Local Junction Cabinet & Andon Stack Tower on Left (x = -0.98, z = -0.28) */}
        <group position={[-0.98, 0, -0.28]}>
          <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.56, 1.64, 0.46]} />
            <meshStandardMaterial color="#24343b" metalness={0.68} roughness={0.36} />
          </mesh>
          <mesh position={[0, 0.85, 0.235]}>
            <boxGeometry args={[0.46, 1.44, 0.015]} />
            <meshStandardMaterial color="#32464f" metalness={0.62} roughness={0.34} />
          </mesh>
          {/* Industrial HMI Panel */}
          <mesh position={[0, 1.15, 0.248]}>
            <boxGeometry args={[0.34, 0.22, 0.01]} />
            <meshStandardMaterial color="#0d181c" metalness={0.4} roughness={0.25} />
          </mesh>
          <mesh position={[0, 1.15, 0.254]}>
            <boxGeometry args={[0.28, 0.14, 0.005]} />
            <meshStandardMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.65} />
          </mesh>
          {/* 3-Light Industrial Andon Stack Tower (Red / Amber / Green) */}
          <group position={[0, 1.64, 0]}>
            <mesh position={[0, 0.18, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.36, 12]} />
              <meshStandardMaterial color="#7b969c" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonGreenMatRef} color="#6effc5" emissive="#38a169" emissiveIntensity={1.15} />
            </mesh>
            <mesh position={[0, 0.485, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonAmberMatRef} color="#2d3748" emissive="#1a202c" emissiveIntensity={0.05} />
            </mesh>
            <mesh position={[0, 0.59, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.095, 18]} />
              <meshStandardMaterial ref={andonRedMatRef} color="#2d3748" emissive="#1a202c" emissiveIntensity={0.05} />
            </mesh>
          </group>
        </group>

        {/* Heavy Cast-Iron & Brushed-Steel Robot Base Bolted to Factory Floor at x = 0 */}
        <mesh position={[0, 0.07, -0.18]} receiveShadow castShadow>
          <boxGeometry args={[1.18, 0.14, 0.98]} />
          <meshStandardMaterial color="#18262c" metalness={0.75} roughness={0.34} />
        </mesh>
        <mesh position={[0, 0.15, -0.2]} receiveShadow>
          <boxGeometry args={[0.96, 0.04, 0.82]} />
          <meshStandardMaterial color="#344a53" metalness={0.72} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.86, -0.32]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 1.46, 0.42]} />
          <meshStandardMaterial color="#253840" metalness={0.7} roughness={0.34} />
        </mesh>

        {/* Fixed Revolute Joint Servo Turret Housing at [0, PIVOT_Y, 0] */}
        <mesh position={[0, PIVOT_Y, -0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.32, 0.36, 0.4, 32]} />
          <meshStandardMaterial color="#142126" metalness={0.8} roughness={0.28} />
        </mesh>
        <mesh position={[0, PIVOT_Y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.06, 28]} />
          <meshStandardMaterial color="#5c7982" metalness={0.84} roughness={0.22} />
        </mesh>

        {/* Compact Status LEDs & Thermal Bar on Robot Pedestal */}
        <group position={[-0.38, 0.86, -0.15]}>
          <mesh>
            <boxGeometry args={[0.28, 0.78, 0.08]} />
            <meshStandardMaterial color="#142126" metalness={0.68} roughness={0.35} />
          </mesh>
          <mesh position={[-0.065, -0.04, 0.045]}>
            <boxGeometry args={[0.05, 0.5, 0.02]} />
            <meshStandardMaterial color="#0b1317" />
          </mesh>
          <group ref={thermalBarGroupRef} position={[-0.065, -0.29, 0.055]}>
            <mesh position={[0, 0.25, 0]}>
              <boxGeometry args={[0.042, 0.5, 0.02]} />
              <meshStandardMaterial
                ref={thermalBarMatRef}
                color="#6effc5"
                emissive="#38a169"
                emissiveIntensity={0.75}
              />
            </mesh>
          </group>
          <mesh position={[0.055, 0.16, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={tempLedMatRef} color="#6effc5" emissive="#38a169" emissiveIntensity={0.85} />
          </mesh>
          <mesh position={[0.055, 0.02, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={coolingLedMatRef} color="#2d3748" emissive="#1a202c" emissiveIntensity={0.05} />
          </mesh>
          <mesh position={[0.055, -0.12, 0.05]}>
            <sphereGeometry args={[0.032, 14, 14]} />
            <meshStandardMaterial ref={estopLedMatRef} color="#2d3748" emissive="#1a202c" emissiveIntensity={0.05} />
          </mesh>
          <group ref={coolingFanRef} position={[0.055, -0.26, 0.05]}>
            {[0, 1, 2].map(b => (
              <mesh key={b} rotation={[0, 0, (b * Math.PI) / 3]}>
                <boxGeometry args={[0.085, 0.02, 0.01]} />
                <meshStandardMaterial color="#68868f" metalness={0.7} roughness={0.3} />
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
          <meshBasicMaterial color="#52737a" transparent opacity={0.48} side={THREE.DoubleSide} />
        </mesh>
        {DEGREE_TICKS.map(deg => {
          const rad = (deg * Math.PI) / 180
          const tickLen = 0.065
          const rMid = 0.495 - tickLen * 0.5
          return (
            <group key={deg} position={[rMid * Math.cos(rad), rMid * Math.sin(rad), 0]} rotation={[0, 0, rad]}>
              <mesh>
                <boxGeometry args={[tickLen, 0.015, 0.004]} />
                <meshBasicMaterial color={deg === 30 ? '#6effc5' : '#85a3ab'} />
              </mesh>
            </group>
          )
        })}
      </group>

      {/* =====================================================================
          3. VISIBLE ANGULAR ERROR ARC (r = 0.52..1.08)
         ===================================================================== */}
      <mesh ref={errorArcMeshRef} position={[0, PIVOT_Y, -0.08]} geometry={errorArcGeometry}>
        <meshBasicMaterial
          ref={errorArcMatRef}
          color="#ff4d5e"
          transparent
          opacity={0.36}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* =====================================================================
          4. TRANSLUCENT GREEN GHOST ARM AT TARGET ANGLE (30.0°)
         ===================================================================== */}
      <group ref={ghostGroupRef} position={[0, PIVOT_Y, -0.05]} rotation={[0, 0, TARGET_RAD_DEFAULT]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.19, 0.19, 0.09, 24]} />
          <meshStandardMaterial
            color="#6effc5"
            emissive="#38a169"
            emissiveIntensity={0.45}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.16, 0.08]} />
          <meshStandardMaterial
            color="#6effc5"
            emissive="#38a169"
            emissiveIntensity={0.45}
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.045]}>
          <boxGeometry args={[ARM_LENGTH, 0.022, 0.01]} />
          <meshBasicMaterial color="#6effc5" transparent opacity={0.7} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0]}>
          <ringGeometry args={[0.13, 0.18, 28]} />
          <meshBasicMaterial color="#6effc5" transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* =====================================================================
          5. ACTUAL CONTROLLED 1-DOF RIGID ARM
         ===================================================================== */}
      <group ref={armGroupRef} position={[0, PIVOT_Y, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.2, 32]} />
          <meshStandardMaterial color={accentColor} metalness={0.65} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.11]}>
          <cylinderGeometry args={[0.1, 0.1, 0.04, 20]} />
          <meshStandardMaterial color="#142126" metalness={0.84} roughness={0.24} />
        </mesh>
        <mesh position={[-0.2, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.24, 0.16]} />
          <meshStandardMaterial color="#283c44" metalness={0.75} roughness={0.32} />
        </mesh>

        {/* Main 1-DOF Rigid Structural Arm Boom */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARM_LENGTH, 0.19, 0.15]} />
          <meshStandardMaterial
            color={primaryColor}
            emissive={accentColor}
            emissiveIntensity={0.2}
            metalness={0.58}
            roughness={0.3}
          />
        </mesh>
        {/* Brushed aluminum side stiffener rail */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.08]}>
          <boxGeometry args={[ARM_LENGTH - 0.28, 0.062, 0.014]} />
          <meshStandardMaterial color="#9bb5bd" metalness={0.8} roughness={0.26} />
        </mesh>

        {/* Endpoint Magnetic/Vacuum Transfer Head at x = ARM_LENGTH */}
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.18, 28]} />
          <meshStandardMaterial color="#18262c" metalness={0.82} roughness={0.26} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.078, 0.078, 0.024, 20]} />
          <meshStandardMaterial ref={gripperTipMatRef} color="#6effc5" emissive="#38a169" emissiveIntensity={1.1} />
        </mesh>

        {/* ===================================================================
            6. ENDPOINT PAYLOAD MASS AT x = ARM_LENGTH
           =================================================================== */}
        <group ref={payloadRef} position={[ARM_LENGTH - 0.2, -0.22, 0]} visible={false}>
          <mesh position={[0, 0.1, 0]} castShadow>
            <boxGeometry args={[0.08, 0.12, 0.1]} />
            <meshStandardMaterial color="#68868f" metalness={0.8} roughness={0.28} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.28, 24]} />
            <meshStandardMaterial color="#18262c" metalness={0.78} roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.196, 0.196, 0.1, 24]} />
            <meshStandardMaterial color="#f5a623" emissive="#d97706" emissiveIntensity={0.4} metalness={0.5} roughness={0.35} />
          </mesh>
        </group>
      </group>

      {/* =====================================================================
          7. GROUNDED 2-TIER INDUSTRIAL CONVEYOR MACHINE (x = 1.58 .. 3.48)
         ===================================================================== */}
      <group>
        <mesh ref={transferPulseRef} position={[CONV_X_START - 0.09, TARGET_TIP_Y, 0]}>
          <boxGeometry args={[0.18, 0.04, 0.18]} />
          <meshBasicMaterial color="#6effc5" transparent opacity={0.65} />
        </mesh>

        {/* --- SOLID GROUNDED MACHINE BASE CABINET UNDER CONVEYOR --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y * 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, LOWER_DECK_Y * 0.96, 0.56]} />
          <meshStandardMaterial color="#1f3138" metalness={0.7} roughness={0.36} />
        </mesh>
        {[CONV_X_START + 0.48, CONV_X_END - 0.48].map((dx, idx) => (
          <mesh key={idx} position={[dx, LOWER_DECK_Y * 0.48, 0.285]}>
            <boxGeometry args={[0.72, LOWER_DECK_Y * 0.72, 0.015]} />
            <meshStandardMaterial color="#2b414a" metalness={0.65} roughness={0.36} />
          </mesh>
        ))}
        <mesh position={[CONV_X_MID, 0.045, 0.29]}>
          <boxGeometry args={[CONV_X_SPAN + 0.1, 0.065, 0.015]} />
          <meshBasicMaterial color="#c7a138" />
        </mesh>

        {/* --- A. UPPER 30.0° TARGET PASS CONVEYOR (y = 2.16) --- */}
        <mesh position={[CONV_X_MID, UPPER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN, 0.11, 0.58]} />
          <meshStandardMaterial color="#18262c" metalness={0.75} roughness={0.34} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, 0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.05, 0.03]} />
          <meshStandardMaterial color="#5c7982" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.045, -0.3]}>
          <boxGeometry args={[CONV_X_SPAN, 0.05, 0.03]} />
          <meshStandardMaterial color="#5c7982" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[CONV_X_MID, UPPER_DECK_Y + 0.05, 0.318]}>
          <boxGeometry args={[CONV_X_SPAN - 0.08, 0.018, 0.008]} />
          <meshStandardMaterial color="#6effc5" emissive="#38a169" emissiveIntensity={0.65} />
        </mesh>
        {[CONV_X_START + 0.04, CONV_X_END - 0.04].map((rx, idx) => (
          <mesh key={idx} position={[rx, UPPER_DECK_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.56, 18]} />
            <meshStandardMaterial color="#5c7982" metalness={0.82} roughness={0.26} />
          </mesh>
        ))}

        {/* Laser Photo-Eye Scanner Arch at Left Entrance of Upper Conveyor */}
        <group position={[CONV_X_START, UPPER_DECK_Y + 0.21, 0]}>
          <mesh position={[0, 0, -0.28]}>
            <boxGeometry args={[0.055, 0.4, 0.045]} />
            <meshStandardMaterial color="#5c7982" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.19, 0]}>
            <boxGeometry args={[0.065, 0.045, 0.6]} />
            <meshStandardMaterial ref={gateBeaconMatRef} color="#6effc5" emissive="#38a169" emissiveIntensity={1.0} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.012, 0.36, 0.52]} />
            <meshBasicMaterial ref={gateLaserMatRef} color="#6effc5" transparent opacity={0.22} />
          </mesh>
        </group>

        {/* Upper Pass Outfeed Tunnel ("FINISHED GOODS BAY") at Right End */}
        <group position={[CONV_X_END + 0.14, UPPER_DECK_Y + 0.21, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.46, 0.64]} />
            <meshStandardMaterial color="#1f3138" metalness={0.72} roughness={0.32} />
          </mesh>
          <mesh position={[-0.165, 0.17, 0]}>
            <boxGeometry args={[0.02, 0.045, 0.58]} />
            <meshStandardMaterial color="#6effc5" emissive="#38a169" emissiveIntensity={0.85} />
          </mesh>
        </group>

        {/* --- B. LOWER WAIST-HIGH REJECT CONVEYOR DECK (y = 1.02) --- */}
        <mesh position={[CONV_X_MID, LOWER_DECK_Y, 0]} castShadow receiveShadow>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.11, 0.62]} />
          <meshStandardMaterial color="#18262c" metalness={0.75} roughness={0.34} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, 0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.05, 0.03]} />
          <meshStandardMaterial color="#5c7982" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.05, -0.32]}>
          <boxGeometry args={[CONV_X_SPAN + 0.08, 0.05, 0.03]} />
          <meshStandardMaterial color="#5c7982" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[CONV_X_MID, LOWER_DECK_Y + 0.055, 0.338]}>
          <boxGeometry args={[CONV_X_SPAN, 0.018, 0.008]} />
          <meshStandardMaterial color="#ff4d5e" emissive="#e11d48" emissiveIntensity={0.65} />
        </mesh>

        {/* Lower Reject Scrap Hopper Hood at Right End */}
        <group position={[CONV_X_END + 0.14, LOWER_DECK_Y + 0.2, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.34, 0.42, 0.66]} />
            <meshStandardMaterial color="#1f3138" metalness={0.72} roughness={0.35} />
          </mesh>
          <mesh position={[-0.175, 0.15, 0]}>
            <boxGeometry args={[0.02, 0.045, 0.6]} />
            <meshStandardMaterial color="#ff4d5e" emissive="#e11d48" emissiveIntensity={0.85} />
          </mesh>
        </group>

        {/* Brushed Steel Frame Columns connecting Lower Base to Upper Deck */}
        {[CONV_X_START + 0.12, CONV_X_MID, CONV_X_END - 0.12].map((sx, idx) => (
          <mesh key={idx} position={[sx, (LOWER_DECK_Y + UPPER_DECK_Y) * 0.5, -0.27]} castShadow>
            <boxGeometry args={[0.085, UPPER_DECK_Y - LOWER_DECK_Y, 0.085]} />
            <meshStandardMaterial color="#5c7982" metalness={0.78} roughness={0.28} />
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
              <meshStandardMaterial color="#37515c" metalness={0.65} roughness={0.35} />
            </mesh>
            <mesh
              ref={el => {
                lowerSlatsRefs.current[i] = el
              }}
              position={[CONV_X_START + (i / NUM_BELT_SLATS) * CONV_X_SPAN, LOWER_DECK_Y + 0.06, 0]}
            >
              <boxGeometry args={[0.04, 0.014, 0.54]} />
              <meshStandardMaterial color="#37515c" metalness={0.65} roughness={0.35} />
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
                color="#283b36"
                emissive="#1b4332"
                emissiveIntensity={0.45}
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
                color="#6effc5"
                emissive="#38a169"
                emissiveIntensity={0.85}
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

export default function TwinPhysicsArena({
  frame,
  leftHudRefs,
  rightHudRefs,
}: {
  frame: MutableRefObject<Frame>
  leftHudRefs?: ViewportHudRefs
  rightHudRefs?: ViewportHudRefs
}) {
  return (
    <group>
      <FactoryHallEnvironment />
      {/* Left Workcell (01 // Legacy Stripped Binary): spans x = -5.70 .. -1.39 */}
      <group position={[-4.6, 0, 0.35]} scale={0.88}>
        <SingleArmScene side="left" frame={frame} hudRefs={leftHudRefs} />
      </group>
      {/* Right Workcell (02 // Recovered & Evolved Twin): spans x = +1.40 .. +5.71 */}
      <group position={[2.5, 0, 0.35]} scale={0.88}>
        <SingleArmScene side="right" frame={frame} hudRefs={rightHudRefs} />
      </group>
    </group>
  )
}
