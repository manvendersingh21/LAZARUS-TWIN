import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, twinValue } from './types'

const TARGET_RAD = (-30 * Math.PI) / 180

function RobotArm({ side, frame }: { side: 'left' | 'right'; frame: MutableRefObject<Frame> }) {
  const arm = useRef<RapierRigidBody>(null)
  const current = useRef(0)
  const warning = useRef<THREE.MeshStandardMaterial>(null)
  const loadBlockRef = useRef<THREE.Group>(null)
  const estopBarRef = useRef<THREE.Group>(null)
  const coolingRingRef = useRef<THREE.MeshStandardMaterial>(null)
  const errorArcRef = useRef<THREE.Mesh>(null)
  const errorArcMatRef = useRef<THREE.MeshBasicMaterial>(null)

  const x = side === 'left' ? -3.35 : 3.35
  const accent = side === 'left' ? '#d97706' : '#0284c7'

  useFrame(({ clock }, delta) => {
    const f = frame.current
    const twin = side === 'left' ? f.left_legacy : f.right_evolved
    const angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle') ?? 0
    const target = twinValue(twin, 'target', 'target_angle') ?? 30
    const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c') ?? 25
    const estop = (twinValue(twin, 'estop') ?? 0) > 0
    const cooling = (twinValue(twin, 'cooling') ?? 0) > 0 || temp >= 72
    const sabotage = !!f.sabotage_active

    current.current = THREE.MathUtils.damp(current.current, (-angle * Math.PI) / 180, 8, delta)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), current.current)
    arm.current?.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

    // Pedestal beacon LED
    if (warning.current) {
      if (estop || temp >= 88) {
        warning.current.color.set('#dc2626')
        warning.current.emissive.set('#dc2626')
        warning.current.emissiveIntensity = 1.8 + 1.4 * Math.abs(Math.sin(clock.elapsedTime * 12))
      } else if (cooling || sabotage) {
        warning.current.color.set('#ea580c')
        warning.current.emissive.set('#ea580c')
        warning.current.emissiveIntensity = 1.2 + 0.5 * Math.sin(clock.elapsedTime * 6)
      } else {
        warning.current.color.set(accent)
        warning.current.emissive.set(accent)
        warning.current.emissiveIntensity = 0.75
      }
    }

    // Heavy Load Mass Block visibility when sabotage_active is true
    if (loadBlockRef.current) {
      loadBlockRef.current.visible = sabotage
    }

    // Mechanical E-Stop Brake Bar clamp across joint when estop == 1
    if (estopBarRef.current) {
      estopBarRef.current.visible = estop
    }

    // Cryo Cooling Fins pulse when cooling == 1 (temp >= 72C)
    if (coolingRingRef.current) {
      if (cooling) {
        coolingRingRef.current.color.set('#06b6d4')
        coolingRingRef.current.emissive.set('#0284c7')
        coolingRingRef.current.emissiveIntensity = 1.4 + 0.7 * Math.sin(clock.elapsedTime * 8)
      } else {
        coolingRingRef.current.color.set('#64748b')
        coolingRingRef.current.emissive.set('#0f172a')
        coolingRingRef.current.emissiveIntensity = 0.1
      }
    }

    // Error divergence indicator visibility
    const errDeg = Math.abs(target - angle)
    if (errorArcRef.current && errorArcMatRef.current) {
      errorArcRef.current.visible = errDeg > 2.2
      errorArcMatRef.current.color.set(errDeg > 8 ? '#dc2626' : '#d97706')
      errorArcMatRef.current.opacity = Math.min(0.55, 0.15 + errDeg / 45)
    }
  })

  return (
    <group position={[x, 0, 0]}>
      {/* Heavy slate workcell plinth */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, 0.05, 0]} receiveShadow castShadow>
          <boxGeometry args={[4.7, 0.22, 3]} />
          <meshStandardMaterial color="#1e293b" metalness={0.68} roughness={0.4} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 0.18, 0]} receiveShadow>
        <boxGeometry args={[4.52, 0.04, 2.82]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.55} roughness={0.32} />
      </mesh>
      {[-1, 1].map(n => (
        <mesh key={n} position={[n * 1.9, 0.21, 0]}>
          <boxGeometry args={[0.08, 0.04, 2.5]} />
          <meshStandardMaterial color={accent} metalness={0.5} roughness={0.35} />
        </mesh>
      ))}

      {/* Turret base housing */}
      <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.66, 0.78, 0.65, 28]} />
        <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.32} />
      </mesh>

      {/* Cryo Cooling Fins around turret collar (pulses cyan when temp >= 72C) */}
      <mesh position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.71, 0.71, 0.12, 28]} />
        <meshStandardMaterial
          ref={coolingRingRef}
          color="#64748b"
          emissive="#0f172a"
          emissiveIntensity={0.1}
          metalness={0.65}
          roughness={0.28}
        />
      </mesh>

      <mesh position={[0, 0.87, 0]}>
        <cylinderGeometry args={[0.46, 0.59, 0.17, 28]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.25} metalness={0.45} />
      </mesh>

      {/* 30.0° Target Setpoint Calibration Ring & Reference Datum Ray centered at joint pivot (0, 1.04, -0.28) */}
      <group position={[0, 1.04, -0.28]}>
        {/* Outer degree calibration ring */}
        <mesh>
          <ringGeometry args={[2.32, 2.38, 64]} />
          <meshBasicMaterial color="#64748b" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <ringGeometry args={[1.65, 1.68, 48]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
        {/* 0° vertical reference tick */}
        <mesh position={[0, 1.2, 0]}>
          <boxGeometry args={[0.025, 2.4, 0.01]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.35} />
        </mesh>
        {/* 30.0° Target Setpoint Laser Reference Ray */}
        <group rotation={[0, 0, TARGET_RAD]}>
          <mesh position={[0, 1.25, 0.01]}>
            <boxGeometry args={[0.045, 2.5, 0.015]} />
            <meshBasicMaterial color="#059669" />
          </mesh>
          <mesh position={[0, 2.52, 0.02]}>
            <boxGeometry args={[0.24, 0.1, 0.02]} />
            <meshBasicMaterial color="#059669" />
          </mesh>
          <Html position={[0.42, 2.58, 0.05]} center style={{ pointerEvents: 'none' }}>
            <span className="setpoint-3d-tag">SETPOINT 30.0°</span>
          </Html>
        </group>
        {/* Error Divergence Sector between 16.6° and 30.0° when sagging */}
        <mesh ref={errorArcRef} rotation={[0, 0, TARGET_RAD]} visible={false}>
          <ringGeometry args={[1.85, 2.28, 32, 1, Math.PI / 2, 0.26]} />
          <meshBasicMaterial
            ref={errorArcMatRef}
            color="#dc2626"
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Kinematic Robot Arm pivoting at (0, 1.04, 0) */}
      <RigidBody ref={arm} type="kinematicPosition" position={[0, 1.04, 0]} colliders="cuboid">
        {/* Main brushed titanium/silver arm spar */}
        <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.42, 2.15, 0.44]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.62} roughness={0.26} />
        </mesh>
        {/* High-contrast accent stripe */}
        <mesh position={[0, 1.05, 0.24]}>
          <boxGeometry args={[0.21, 1.7, 0.06]} />
          <meshStandardMaterial color={accent} metalness={0.5} roughness={0.32} />
        </mesh>
        {/* Wrist servo actuator */}
        <mesh position={[0, 2.15, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.34, 0.5, 24]} />
          <meshStandardMaterial color="#1e293b" metalness={0.78} roughness={0.28} />
        </mesh>
        {/* End-effector tool head */}
        <mesh position={[0, 2.54, 0]} castShadow>
          <boxGeometry args={[0.62, 0.55, 0.62]} />
          <meshStandardMaterial color={side === 'left' ? '#d97706' : '#0284c7'} metalness={0.55} roughness={0.3} />
        </mesh>
        <mesh position={[0, 2.54, 0.32]}>
          <boxGeometry args={[0.36, 0.12, 0.02]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>

        {/* Heavy Sabotage Load Mass Block clamped onto arm tip when sabotage_active is true */}
        <group ref={loadBlockRef} position={[0, 3.04, 0]} visible={false}>
          <mesh castShadow>
            <boxGeometry args={[0.92, 0.42, 0.74]} />
            <meshStandardMaterial color="#ea580c" metalness={0.45} roughness={0.38} />
          </mesh>
          <mesh position={[0, 0, 0.38]}>
            <boxGeometry args={[0.76, 0.18, 0.02]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
        </group>
      </RigidBody>

      {/* Mechanical Red E-Stop Brake Bar across joint hub when estop == 1 */}
      <group ref={estopBarRef} position={[0, 1.04, 0.36]} visible={false}>
        <mesh>
          <boxGeometry args={[1.35, 0.24, 0.14]} />
          <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.85} roughness={0.3} />
        </mesh>
        <Html position={[0, 0.34, 0.1]} center style={{ pointerEvents: 'none' }}>
          <span className="estop-3d-tag">E-STOP BRAKE ENGAGED</span>
        </Html>
      </group>

      {/* Workcell Pedestal Status Beacon */}
      <mesh position={[-1.65, 0.53, 0.8]} castShadow>
        <sphereGeometry args={[0.26, 24, 24]} />
        <meshStandardMaterial
          ref={warning}
          color={accent}
          emissive={accent}
          emissiveIntensity={0.75}
          metalness={0.45}
          roughness={0.22}
        />
      </mesh>
    </group>
  )
}

export default function TwinPhysicsArena({ frame }: { frame: MutableRefObject<Frame> }) {
  return (
    <Physics gravity={[0, -9.81, 0]} timeStep="vary">
      <RobotArm side="left" frame={frame} />
      <RobotArm side="right" frame={frame} />
    </Physics>
  )
}
