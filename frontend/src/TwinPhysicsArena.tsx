import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, twinValue } from './types'

export const PIVOT_Y = 2.2
export const ARM_LENGTH = 1.85
const ERROR_ARC_SEGMENTS = 32
const ERROR_ARC_INNER_R = 0.75
const ERROR_ARC_OUTER_R = 1.35

const DEGREE_TICKS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90]

export function SingleArmScene({
  side,
  frame,
  showPayload,
}: {
  side: 'left' | 'right'
  frame: MutableRefObject<Frame>
  showPayload?: boolean
}) {
  const armGroupRef = useRef<THREE.Group>(null)
  const ghostGroupRef = useRef<THREE.Group>(null)
  const payloadRef = useRef<THREE.Group>(null)
  const errorArcMeshRef = useRef<THREE.Mesh>(null)
  const errorArcMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const errorLabelGroupRef = useRef<THREE.Group>(null)
  const errorLabelTextRef = useRef<HTMLDivElement>(null)
  const targetLabelTextRef = useRef<HTMLDivElement>(null)
  const actualAngleBadgeRef = useRef<HTMLDivElement>(null)

  // Fixed base status LEDs & thermal column refs
  const tempLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const coolingLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const estopLedMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const coolingFanRef = useRef<THREE.Group>(null)
  const thermalBarGroupRef = useRef<THREE.Group>(null)
  const thermalBarMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const baseStatusTextRef = useRef<HTMLDivElement>(null)

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

    // Direct physics state from backend Arm.step() — NO artificial damping or freeze
    const angle = twin ? (twinValue(twin, 'angle', 'angle_deg', 'current_angle') ?? 0) : 30
    const target = twinValue(twin, 'target', 'target_angle') ?? 30
    const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c') ?? 30
    const estop = (twinValue(twin, 'estop') ?? 0) > 0
    const cooling = (twinValue(twin, 'cooling') ?? 0) > 0 || temp >= 72
    const sabotage = showPayload ?? Boolean(f.sabotage_active || twin?.sabotage_active)
    const signedErr = target - angle
    const absErr = Math.abs(signedErr)

    // Coordinate convention: X-Y plane, rotating about +Z, 0° = +X horizontal, CCW positive
    const thetaRad = (angle * Math.PI) / 180
    const targetRad = (target * Math.PI) / 180

    if (armGroupRef.current) {
      armGroupRef.current.rotation.z = thetaRad
    }

    if (ghostGroupRef.current) {
      ghostGroupRef.current.rotation.z = targetRad
    }

    if (targetLabelTextRef.current) {
      targetLabelTextRef.current.textContent = `TARGET ${target.toFixed(1)}°`
    }

    if (actualAngleBadgeRef.current) {
      actualAngleBadgeRef.current.textContent = `θ = ${angle.toFixed(1)}°`
      actualAngleBadgeRef.current.style.backgroundColor = estop
        ? '#dc2626'
        : absErr > 4.5
          ? '#ea580c'
          : side === 'left'
            ? '#ea580c'
            : '#0284c7'
    }

    // Requirement 9: Dynamically update angular error sector between thetaRad and targetRad (r = 0.75..1.35)
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
      errorArcMatRef.current.color.set(absErr > 4.5 ? '#ef4444' : '#f59e0b')
      errorArcMatRef.current.opacity = 0.38
    }

    if (errorLabelGroupRef.current && errorLabelTextRef.current) {
      const midRad = (thetaRad + targetRad) * 0.5
      const labelR = 1.08
      errorLabelGroupRef.current.position.set(
        labelR * Math.cos(midRad),
        PIVOT_Y + labelR * Math.sin(midRad),
        0.04
      )
      const showLabel = absErr >= 0.8
      errorLabelTextRef.current.style.display = showLabel ? 'block' : 'none'
      errorLabelTextRef.current.textContent = `Δθ ${signedErr >= 0 ? '+' : ''}${signedErr.toFixed(1)}°`
      errorLabelTextRef.current.style.backgroundColor = absErr > 4.5 ? '#ef4444' : '#d97706'
    }

    // Requirement 10: Endpoint payload mass visible when scenario models additional load
    if (payloadRef.current) {
      payloadRef.current.visible = sabotage
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
      thermalBarMatRef.current.emissiveIntensity = temp >= 88 ? 1.4 : 0.7
    }
    if (tempLedMatRef.current) {
      tempLedMatRef.current.color.set(tempHex)
      tempLedMatRef.current.emissive.set(tempHex)
      tempLedMatRef.current.emissiveIntensity = temp >= 88 ? 1.8 : 0.9
    }
    if (coolingLedMatRef.current) {
      const coolHex = cooling ? '#06b6d4' : '#475569'
      coolingLedMatRef.current.color.set(coolHex)
      coolingLedMatRef.current.emissive.set(cooling ? '#0284c7' : '#0f172a')
      coolingLedMatRef.current.emissiveIntensity = cooling ? 1.5 : 0.1
    }
    if (estopLedMatRef.current) {
      const pulse = 1.4 + 0.9 * Math.abs(Math.sin(clock.elapsedTime * 10))
      const estopHex = estop ? '#ef4444' : '#475569'
      estopLedMatRef.current.color.set(estopHex)
      estopLedMatRef.current.emissive.set(estop ? '#dc2626' : '#0f172a')
      estopLedMatRef.current.emissiveIntensity = estop ? pulse : 0.1
    }
    if (coolingFanRef.current) {
      coolingFanRef.current.rotation.z += delta * (cooling ? 18 : 0.8)
    }
    if (baseStatusTextRef.current) {
      baseStatusTextRef.current.textContent = `${temp.toFixed(0)}°C · ${cooling ? 'COOL ON' : 'COOL OFF'} · ${estop ? 'E-STOP' : 'RUN'}`
      baseStatusTextRef.current.style.color = estop ? '#fca5a5' : cooling ? '#67e8f9' : '#cbd5e1'
    }
  })

  return (
    <group>
      {/* =====================================================================
          1. FIXED INDUSTRIAL BASE PEDESTAL (y = 0 to PIVOT_Y = 2.2)
          Column is set at z = -0.34 behind the X-Y swing plane (z = 0) so the
          arm of length L = 1.85 swings freely all the way down to -90° (y = 0.35)
         ===================================================================== */}
      <group>
        {/* Heavy bolted steel floor baseplate at y = 0..0.12 */}
        <mesh position={[0, 0.06, -0.22]} receiveShadow castShadow>
          <boxGeometry args={[1.65, 0.12, 1.35]} />
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.34} />
        </mesh>
        {/* Machined top anchor plate */}
        <mesh position={[0, 0.13, -0.24]} receiveShadow>
          <boxGeometry args={[1.42, 0.03, 1.12]} />
          <meshStandardMaterial color="#475569" metalness={0.68} roughness={0.3} />
        </mesh>
        {/* 4 Anchor bolts on floor flange */}
        {[
          [-0.64, -0.72],
          [0.64, -0.72],
          [-0.64, 0.24],
          [0.64, 0.24],
        ].map(([bx, bz], idx) => (
          <mesh key={idx} position={[bx, 0.14, bz]} castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.05, 12]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.22} />
          </mesh>
        ))}

        {/* Vertical industrial stanchion column behind swing plane (z = -0.36) */}
        <mesh position={[0, 1.24, -0.36]} castShadow receiveShadow>
          <boxGeometry args={[0.52, 2.24, 0.44]} />
          <meshStandardMaterial color="#334155" metalness={0.74} roughness={0.32} />
        </mesh>
        {/* Structural side gusset ribs */}
        {[-0.28, 0.28].map(gx => (
          <mesh key={gx} position={[gx, 0.55, -0.28]} castShadow>
            <boxGeometry args={[0.05, 0.85, 0.52]} />
            <meshStandardMaterial color="#475569" metalness={0.72} roughness={0.35} />
          </mesh>
        ))}

        {/* Fixed Revolute Joint Servo Housing projecting forward to [0, PIVOT_Y, 0] */}
        <mesh position={[0, PIVOT_Y, -0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.34, 0.38, 0.42, 32]} />
          <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.26} />
        </mesh>
        {/* Fixed stator collar ring around Z-axis revolute spindle */}
        <mesh position={[0, PIVOT_Y, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.06, 28]} />
          <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.22} />
        </mesh>

        {/* Mechanical -90° Lower Physical Stop Bumper (matches Arm.step() clamp at -90°) */}
        <group position={[-0.14, PIVOT_Y - 0.72, -0.08]}>
          <mesh>
            <boxGeometry args={[0.16, 0.1, 0.22]} />
            <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.35} />
          </mesh>
          <mesh position={[0.08, 0, 0.06]}>
            <cylinderGeometry args={[0.035, 0.035, 0.12, 12]} />
            <meshStandardMaterial color="#dc2626" roughness={0.5} />
          </mesh>
        </group>

        {/* Compact Status LEDs & Thermal Indicator on Fixed Base Stanchion */}
        <group position={[-0.44, 1.25, -0.18]}>
          {/* Instrument Bezel */}
          <mesh>
            <boxGeometry args={[0.34, 0.96, 0.08]} />
            <meshStandardMaterial color="#0f172a" metalness={0.65} roughness={0.35} />
          </mesh>
          {/* Vertical Thermal Bar Track */}
          <mesh position={[-0.08, -0.04, 0.045]}>
            <boxGeometry args={[0.06, 0.62, 0.02]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <group ref={thermalBarGroupRef} position={[-0.08, -0.35, 0.055]}>
            <mesh position={[0, 0.31, 0]}>
              <boxGeometry args={[0.048, 0.62, 0.02]} />
              <meshStandardMaterial
                ref={thermalBarMatRef}
                color="#10b981"
                emissive="#10b981"
                emissiveIntensity={0.7}
              />
            </mesh>
          </group>

          {/* 3 Status LEDs: TEMP, COOLING (>=72°C), E-STOP (>=88°C or |err|>45°) */}
          <mesh position={[0.07, 0.2, 0.05]}>
            <sphereGeometry args={[0.038, 14, 14]} />
            <meshStandardMaterial ref={tempLedMatRef} color="#10b981" emissive="#10b981" emissiveIntensity={0.9} />
          </mesh>
          <mesh position={[0.07, 0.02, 0.05]}>
            <sphereGeometry args={[0.038, 14, 14]} />
            <meshStandardMaterial ref={coolingLedMatRef} color="#475569" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>
          <mesh position={[0.07, -0.16, 0.05]}>
            <sphereGeometry args={[0.038, 14, 14]} />
            <meshStandardMaterial ref={estopLedMatRef} color="#475569" emissive="#0f172a" emissiveIntensity={0.1} />
          </mesh>

          {/* Mini Cooling Fan Rotor on Base */}
          <group ref={coolingFanRef} position={[0.07, -0.34, 0.05]}>
            {[0, 1, 2].map(b => (
              <mesh key={b} rotation={[0, 0, (b * Math.PI) / 3]}>
                <boxGeometry args={[0.11, 0.024, 0.01]} />
                <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.4} />
              </mesh>
            ))}
          </group>

          <Html position={[0, -0.58, 0.06]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
            <div
              ref={baseStatusTextRef}
              style={{
                background: 'rgba(15, 23, 42, 0.92)',
                color: '#cbd5e1',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: '3px',
                border: '1px solid #334155',
                whiteSpace: 'nowrap',
              }}
            >
              30°C · COOL OFF · RUN
            </div>
          </Html>
        </group>
      </group>

      {/* =====================================================================
          2. PROTRACTOR REFERENCE DIAL IN X-Y PLANE (z = -0.14)
          Centered at [0, PIVOT_Y, -0.14] with -90°..+90° arc, 0° horizontal
          datum along +X, -90° vertical downward stop line, 15° ticks, and g ↓
         ===================================================================== */}
      <group position={[0, PIVOT_Y, -0.14]}>
        {/* Outer degree arc (-90° to +90°) at radius L = 1.85 */}
        <mesh>
          <ringGeometry args={[ARM_LENGTH - 0.02, ARM_LENGTH + 0.02, 64, 1, -Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#64748b" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
        {/* Inner reference arc at radius 0.75 */}
        <mesh>
          <ringGeometry args={[ERROR_ARC_INNER_R - 0.012, ERROR_ARC_INNER_R + 0.012, 48, 1, -Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>

        {/* Horizontal 0° datum line along +X */}
        <mesh position={[ARM_LENGTH * 0.52, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH * 1.04, 0.018, 0.005]} />
          <meshBasicMaterial color="#64748b" transparent opacity={0.65} />
        </mesh>
        <Html position={[ARM_LENGTH + 0.34, 0, 0]} center distanceFactor={9.5} style={{ pointerEvents: 'none' }}>
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '8.5px',
              fontWeight: 700,
              color: '#475569',
              background: 'rgba(248, 250, 252, 0.9)',
              border: '1px solid #cbd5e1',
              padding: '1px 4px',
              borderRadius: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            0° (+X)
          </span>
        </Html>

        {/* Vertical -90° downward mechanical stop line along -Y & +90° upward line */}
        <mesh position={[0, -ARM_LENGTH * 0.5, 0]}>
          <boxGeometry args={[0.02, ARM_LENGTH, 0.005]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0.45} />
        </mesh>
        <mesh position={[0, ARM_LENGTH * 0.5, 0]}>
          <boxGeometry args={[0.016, ARM_LENGTH, 0.005]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.38} />
        </mesh>
        <Html position={[0.28, -ARM_LENGTH + 0.04, 0]} center distanceFactor={9.5} style={{ pointerEvents: 'none' }}>
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '8px',
              fontWeight: 700,
              color: '#b91c1c',
              background: 'rgba(254, 242, 242, 0.92)',
              border: '1px solid #fecaca',
              padding: '1px 4px',
              borderRadius: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            -90° STOP
          </span>
        </Html>

        {/* Degree tick marks every 15° from -90° to +90° */}
        {DEGREE_TICKS.map(deg => {
          const rad = (deg * Math.PI) / 180
          const isMajor = deg % 30 === 0
          const tickLen = isMajor ? 0.14 : 0.07
          const rMid = ARM_LENGTH - tickLen * 0.5
          return (
            <group key={deg} position={[rMid * Math.cos(rad), rMid * Math.sin(rad), 0]} rotation={[0, 0, rad]}>
              <mesh>
                <boxGeometry args={[tickLen, isMajor ? 0.022 : 0.012, 0.006]} />
                <meshBasicMaterial color={deg === 30 ? '#059669' : isMajor ? '#475569' : '#94a3b8'} />
              </mesh>
            </group>
          )
        })}

        {/* Downward Gravity Indicator (g ↓) showing gravity acting along -Y */}
        <group position={[-0.85, 0.72, 0]}>
          <mesh position={[0, -0.26, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.48, 12]} />
            <meshBasicMaterial color="#475569" />
          </mesh>
          <mesh position={[0, -0.54, 0]} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[0.055, 0.13, 14]} />
            <meshBasicMaterial color="#475569" />
          </mesh>
          <Html position={[0, 0.08, 0]} center distanceFactor={9.5} style={{ pointerEvents: 'none' }}>
            <span
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '8.5px',
                fontWeight: 800,
                color: '#334155',
                background: 'rgba(241, 245, 249, 0.94)',
                border: '1px solid #94a3b8',
                padding: '1px 5px',
                borderRadius: '2px',
                whiteSpace: 'nowrap',
              }}
            >
              g ↓ (-Y)
            </span>
          </Html>
        </group>
      </group>

      {/* =====================================================================
          3. REQUIREMENT 9 — VISIBLE ANGULAR ERROR ARC (r = 0.75..1.35)
          Spans exact angular sector between thetaRad and targetRad in X-Y plane
         ===================================================================== */}
      <mesh ref={errorArcMeshRef} position={[0, PIVOT_Y, -0.09]} geometry={errorArcGeometry}>
        <meshBasicMaterial
          ref={errorArcMatRef}
          color="#ef4444"
          transparent
          opacity={0.38}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <group ref={errorLabelGroupRef} position={[1.0, PIVOT_Y + 0.3, 0.04]}>
        <Html center distanceFactor={9} style={{ pointerEvents: 'none' }}>
          <div
            ref={errorLabelTextRef}
            style={{
              display: 'none',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '9px',
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: '3px',
              boxShadow: '0 2px 6px rgba(15, 23, 42, 0.2)',
              whiteSpace: 'nowrap',
            }}
          >
            Δθ +0.0°
          </div>
        </Html>
      </group>

      {/* =====================================================================
          4. REQUIREMENT 7 — TRANSLUCENT GREEN GHOST ARM AT TARGET ANGLE (30.0°)
          Complete ghost silhouette (#10b981, opacity = 0.32) + endpoint ring
         ===================================================================== */}
      <group ref={ghostGroupRef} position={[0, PIVOT_Y, -0.05]} rotation={[0, 0, (30 * Math.PI) / 180]}>
        {/* Ghost hub collar */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.23, 0.23, 0.12, 24]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} />
        </mesh>
        {/* Ghost rigid arm beam along +X from 0 to L = 1.85 */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]}>
          <boxGeometry args={[ARM_LENGTH, 0.2, 0.1]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.35} transparent opacity={0.32} depthWrite={false} />
        </mesh>
        {/* Crisp dashed/solid target centerline along +X */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.055]}>
          <boxGeometry args={[ARM_LENGTH, 0.028, 0.01]} />
          <meshBasicMaterial color="#059669" transparent opacity={0.75} />
        </mesh>
        {/* Green target endpoint ring at x = L = 1.85 */}
        <mesh position={[ARM_LENGTH, 0, 0]}>
          <ringGeometry args={[0.14, 0.21, 28]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.1, 24]} />
          <meshStandardMaterial color="#10b981" emissive="#059669" emissiveIntensity={0.4} transparent opacity={0.32} depthWrite={false} />
        </mesh>
        <Html position={[ARM_LENGTH + 0.36, 0.14, 0]} center distanceFactor={9.2} style={{ pointerEvents: 'none' }}>
          <div
            ref={targetLabelTextRef}
            style={{
              background: '#059669',
              color: '#ffffff',
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '9px',
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: '3px',
              border: '1px solid #064e3b',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(5, 150, 105, 0.25)',
            }}
          >
            TARGET 30.0°
          </div>
        </Html>
      </group>

      {/* =====================================================================
          5. REQUIREMENT 8 — ACTUAL CONTROLLED 1-DOF RIGID ARM
          Pivoting about +Z at [0, PIVOT_Y, 0], extending along +X to L = 1.85
          Left = Solid Industrial Orange (#f97316), Right = Solid Cyan (#06b6d4)
         ===================================================================== */}
      <group ref={armGroupRef} position={[0, PIVOT_Y, 0]}>
        {/* Revolving Hub Collar at [0, 0, 0] */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.25, 0.22, 32]} />
          <meshStandardMaterial color={accentColor} metalness={0.62} roughness={0.28} />
        </mesh>
        {/* Center spindle cap */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.12]}>
          <cylinderGeometry args={[0.11, 0.11, 0.04, 20]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Counterweight heel opposite +X */}
        <mesh position={[-0.22, 0, 0]} castShadow>
          <boxGeometry args={[0.28, 0.26, 0.18]} />
          <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.3} />
        </mesh>

        {/* Main 1-DOF Rigid Structural Arm Beam extending along +X from 0 to L = 1.85 */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[ARM_LENGTH, 0.21, 0.16]} />
          <meshStandardMaterial color={primaryColor} metalness={0.52} roughness={0.28} />
        </mesh>
        {/* Machined high-contrast side stiffener rails */}
        <mesh position={[ARM_LENGTH * 0.5, 0, 0.085]}>
          <boxGeometry args={[ARM_LENGTH - 0.32, 0.075, 0.015]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.22} />
        </mesh>
        <mesh position={[ARM_LENGTH * 0.5, 0, -0.085]}>
          <boxGeometry args={[ARM_LENGTH - 0.32, 0.075, 0.015]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.22} />
        </mesh>

        {/* Endpoint Flange at x = L = 1.85 */}
        <mesh position={[ARM_LENGTH, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.2, 28]} />
          <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.25} />
        </mesh>
        <mesh position={[ARM_LENGTH, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.02, 20]} />
          <meshStandardMaterial color={primaryColor} emissive={accentColor} emissiveIntensity={0.35} />
        </mesh>

        {/* Live Actual Angle Readout Pill on Arm Tip */}
        <Html position={[ARM_LENGTH, -0.28, 0.08]} center distanceFactor={9.2} style={{ pointerEvents: 'none' }}>
          <div
            ref={actualAngleBadgeRef}
            style={{
              backgroundColor: accentColor,
              color: '#ffffff',
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: '9px',
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: '3px',
              border: '1px solid #0f172a',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(15, 23, 42, 0.22)',
            }}
          >
            θ = 30.0°
          </div>
        </Html>

        {/* ===================================================================
            6. REQUIREMENT 10 — ENDPOINT PAYLOAD MASS AT x = L = 1.85
            Visible whenever sabotage_active is true (or world models extra load)
           =================================================================== */}
        <group ref={payloadRef} position={[ARM_LENGTH, 0, 0]} visible={false}>
          {/* Steel mounting collar & clevis at endpoint */}
          <mesh position={[0.14, 0, 0]} castShadow>
            <boxGeometry args={[0.18, 0.14, 0.16]} />
            <meshStandardMaterial color="#475569" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Heavy metallic payload mass block/cylinder assembly */}
          <mesh position={[0.3, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.24, 0.24, 0.34, 24]} />
            <meshStandardMaterial color="#1e293b" metalness={0.82} roughness={0.28} />
          </mesh>
          {/* High-visibility orange load hazard band */}
          <mesh position={[0.3, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.246, 0.246, 0.14, 24]} />
            <meshStandardMaterial color="#ea580c" metalness={0.45} roughness={0.35} />
          </mesh>
          <Html position={[0.32, 0.34, 0]} center distanceFactor={9.2} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                background: '#ea580c',
                color: '#ffffff',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '8.5px',
                fontWeight: 800,
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1.5px solid #0f172a',
                whiteSpace: 'nowrap',
                boxShadow: '0 3px 8px rgba(234, 88, 12, 0.38)',
              }}
            >
              PAYLOAD MASS (g=25)
            </div>
          </Html>
        </group>
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
