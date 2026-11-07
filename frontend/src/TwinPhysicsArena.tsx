import { useFrame } from '@react-three/fiber'
import { Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, twinValue } from './types'

function RobotArm({ side, frame }: { side: 'left' | 'right'; frame: MutableRefObject<Frame> }) {
  const arm = useRef<RapierRigidBody>(null)
  const current = useRef(0)
  const warning = useRef<THREE.MeshStandardMaterial>(null)
  const x = side === 'left' ? -3.35 : 3.35
  const accent = side === 'left' ? '#7caec0' : '#60d9a1'
  useFrame((_, delta) => {
    const twin = side === 'left' ? frame.current.left_legacy : frame.current.right_evolved
    const angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle') ?? 0
    current.current = THREE.MathUtils.damp(current.current, (-angle * Math.PI) / 180, 8, delta)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), current.current)
    arm.current?.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    if (warning.current) {
      const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c') ?? 20
      warning.current.emissive.set(temp >= 88 ? '#ff4a39' : temp >= 72 ? '#f9a448' : side === 'left' ? '#3285aa' : '#3fb884')
      warning.current.emissiveIntensity = temp >= 88 ? 2 : 0.65
    }
  })
  return (
    <group position={[x, 0, 0]}>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, 0.05, 0]} receiveShadow>
          <boxGeometry args={[4.7, 0.22, 3]} />
          <meshStandardMaterial color="#1c2c30" metalness={0.65} roughness={0.42} />
        </mesh>
      </RigidBody>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[4.55, 0.04, 2.85]} />
        <meshStandardMaterial color="#3b5557" metalness={0.8} roughness={0.35} />
      </mesh>
      {[-1, 1].map(n => (
        <mesh key={n} position={[n * 1.9, 0.2, 0]}>
          <boxGeometry args={[0.08, 0.04, 2.5]} />
          <meshStandardMaterial color="#82a4a3" metalness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.66, 0.78, 0.65, 28]} />
        <meshStandardMaterial color="#566768" metalness={0.75} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.87, 0]}>
        <cylinderGeometry args={[0.46, 0.59, 0.17, 28]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.2} metalness={0.45} />
      </mesh>
      <RigidBody ref={arm} type="kinematicPosition" position={[0, 1.04, 0]} colliders="cuboid">
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[0.42, 2.15, 0.44]} />
          <meshStandardMaterial color="#bcc4ae" metalness={0.58} roughness={0.32} />
        </mesh>
        <mesh position={[0, 1.05, 0.24]}>
          <boxGeometry args={[0.21, 1.7, 0.06]} />
          <meshStandardMaterial color={accent} metalness={0.6} />
        </mesh>
        <mesh position={[0, 2.15, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.5, 24]} />
          <meshStandardMaterial color="#52696a" metalness={0.75} />
        </mesh>
        <mesh position={[0, 2.54, 0]} castShadow>
          <boxGeometry args={[0.62, 0.55, 0.62]} />
          <meshStandardMaterial color="#d29e47" metalness={0.58} roughness={0.32} />
        </mesh>
        <mesh position={[0, 2.54, 0.32]}>
          <boxGeometry args={[0.36, 0.12, 0.02]} />
          <meshStandardMaterial color="#3b3426" />
        </mesh>
      </RigidBody>
      <mesh position={[-1.65, 0.53, 0.8]}>
        <sphereGeometry args={[0.28, 24, 24]} />
        <meshStandardMaterial ref={warning} color="#49676b" emissive={accent} emissiveIntensity={0.65} metalness={0.65} roughness={0.25} />
      </mesh>
      <mesh position={[0, 2.7, -0.34]}>
        <ringGeometry args={[0.72, 0.735, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 2.7, -0.35]}>
        <ringGeometry args={[0.9, 0.908, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.17} side={THREE.DoubleSide} />
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
