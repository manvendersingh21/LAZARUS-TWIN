import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Suspense, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import PlcChassis3D from './PlcChassis3D'
import TwinPhysicsArena from './TwinPhysicsArena'
import { type Frame, type Terminal } from './types'

const HONEST_DEFAULT_NOTE =
  'Heuristic demo topology mapping; static objdump provides instruction evidence without a CFG.'

const defaultPins: Terminal[] = [
  {
    id: '%IW0',
    label: 'Target angle',
    slot: 1,
    state: 'INFERRED',
    confidence: 0.65,
    provenance: 'heuristic_demo_topology',
    offset: '0x11c0',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%IW1',
    label: 'Joint angle',
    slot: 1,
    state: 'INFERRED',
    confidence: 0.65,
    provenance: 'heuristic_demo_topology',
    offset: '0x11c8',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%IW2',
    label: 'Angular velocity',
    slot: 1,
    state: 'INFERRED',
    confidence: 0.65,
    provenance: 'heuristic_demo_topology',
    offset: '0x11d0',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%IW3',
    label: 'Core temperature',
    slot: 1,
    state: 'UNKNOWN',
    confidence: 0.0,
    provenance: 'heuristic_demo_topology',
    offset: '0x11e2',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%QW0',
    label: 'Motor PWM',
    slot: 2,
    state: 'INFERRED',
    confidence: 0.65,
    provenance: 'heuristic_demo_topology',
    offset: '0x1204',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%QX0.0',
    label: 'Emergency relay',
    slot: 3,
    state: 'UNKNOWN',
    confidence: 0.0,
    provenance: 'heuristic_demo_topology',
    offset: '0x11ea',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
  {
    id: '%QX0.1',
    label: 'Cooling relay',
    slot: 3,
    state: 'UNKNOWN',
    confidence: 0.0,
    provenance: 'heuristic_demo_topology',
    offset: '0x11f4',
    governor_function: 'step(int256,int256,int256,int256)',
    note: HONEST_DEFAULT_NOTE,
  },
]

function WorkcellBayArchitecture({ frame }: { frame: MutableRefObject<Frame> }) {
  const sweepRef = useRef<THREE.Group>(null)
  const sweepMatRef = useRef<THREE.MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    if (sweepRef.current) {
      const z = Math.sin(clock.elapsedTime * 0.55) * 1.65
      sweepRef.current.position.z = z
    }
    if (sweepMatRef.current) {
      const fault = !!frame.current.sabotage_active
      sweepMatRef.current.color.set(fault ? '#ea580c' : '#0284c7')
    }
  })

  return (
    <group>
      {/* Polished epoxy cleanroom floor */}
      <mesh position={[0, -0.11, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#e8eef5" roughness={0.28} metalness={0.06} />
      </mesh>

      {/* Subtle architectural back wall datum */}
      <mesh position={[0, 4.2, -3.2]} receiveShadow>
        <planeGeometry args={[26, 10]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.65} metalness={0.04} />
      </mesh>

      {/* Vertical steel gantry columns */}
      {[-6.15, 6.15].map(x => (
        <group key={x} position={[x, 3.85, -0.55]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.24, 7.9, 0.24]} />
            <meshStandardMaterial color="#475569" metalness={0.75} roughness={0.32} />
          </mesh>
          <mesh position={[0, -3.85, 0]}>
            <boxGeometry args={[0.56, 0.16, 0.56]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ))}

      {/* Overhead steel gantry cross-beam & linear bay lights */}
      <mesh position={[0, 7.76, -0.55]} castShadow>
        <boxGeometry args={[12.8, 0.22, 0.34]} />
        <meshStandardMaterial color="#334155" metalness={0.78} roughness={0.3} />
      </mesh>
      {[-3.35, 0, 3.35].map(x => (
        <group key={x} position={[x, 7.62, -0.45]}>
          <mesh>
            <boxGeometry args={[1.9, 0.06, 0.22]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, -0.035, 0]}>
            <boxGeometry args={[1.76, 0.015, 0.14]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}

      {/* Central cable riser & floor conduit trays from PLC cabinet to Left/Right workcells */}
      <mesh position={[0, 2.5, -0.28]}>
        <boxGeometry args={[0.36, 5.2, 0.14]} />
        <meshStandardMaterial color="#64748b" metalness={0.68} roughness={0.38} />
      </mesh>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[7.4, 0.05, 0.38]} />
        <meshStandardMaterial color="#475569" metalness={0.75} roughness={0.35} />
      </mesh>

      {/* Safety perimeter markings around Cell 01 (-3.35) and Cell 02 (3.35) */}
      {[-3.35, 3.35].map((cx, idx) => (
        <group key={cx} position={[cx, -0.085, 0]}>
          {/* Outer safety border */}
          <mesh position={[0, 0, 1.68]}>
            <boxGeometry args={[5.05, 0.015, 0.09]} />
            <meshBasicMaterial color={idx === 0 ? '#d97706' : '#0284c7'} />
          </mesh>
          <mesh position={[0, 0, -1.68]}>
            <boxGeometry args={[5.05, 0.015, 0.09]} />
            <meshBasicMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[-2.48, 0, 0]}>
            <boxGeometry args={[0.09, 0.015, 3.45]} />
            <meshBasicMaterial color="#94a3b8" />
          </mesh>
          <mesh position={[2.48, 0, 0]}>
            <boxGeometry args={[0.09, 0.015, 3.45]} />
            <meshBasicMaterial color="#94a3b8" />
          </mesh>
        </group>
      ))}

      {/* Moving optical floor datum sweep line */}
      <group ref={sweepRef} position={[0, -0.075, 0]}>
        <mesh>
          <boxGeometry args={[11.4, 0.008, 0.025]} />
          <meshBasicMaterial ref={sweepMatRef} color="#0284c7" transparent opacity={0.45} />
        </mesh>
      </group>
    </group>
  )
}

export default function WorkbenchScene({
  terminals,
  frame,
  selected,
  evmPassed,
  onSelect,
  onHover,
}: {
  terminals?: Terminal[]
  frame: MutableRefObject<Frame>
  selected: string | null
  evmPassed?: boolean
  onSelect: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 5.1, 13.4], fov: 40, near: 0.1, far: 100 }}
      onCreated={({ camera }) => camera.lookAt(0, 3.45, 0)}
    >
      <color attach="background" args={['#f3f6f9']} />
      <fog attach="fog" args={['#f3f6f9', 22, 48]} />
      <ambientLight color="#f8fafc" intensity={1.45} />
      <hemisphereLight args={['#ffffff', '#cbd5e1', 0.95]} />
      <directionalLight
        castShadow
        position={[5, 13, 9]}
        intensity={2.1}
        color="#ffffff"
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-7, 10, -5]} intensity={0.85} color="#e0f2fe" />
      <pointLight position={[-3.5, 4.5, 3.5]} color="#0284c7" intensity={8} distance={14} />
      <pointLight position={[3.5, 4.5, 3.5]} color="#059669" intensity={8} distance={14} />

      <Suspense fallback={null}>
        <WorkcellBayArchitecture frame={frame} />
        <Grid
          position={[0, -0.09, 0]}
          args={[36, 36]}
          cellSize={0.5}
          cellThickness={0.55}
          cellColor="#cbd5e1"
          sectionSize={2}
          sectionThickness={0.9}
          sectionColor="#94a3b8"
          fadeDistance={26}
          fadeStrength={1}
          infiniteGrid
        />
        <PlcChassis3D
          terminals={terminals?.length ? terminals : defaultPins}
          frame={frame}
          selected={selected}
          evmPassed={evmPassed}
          onSelect={onSelect}
          onHover={onHover}
        />
        <TwinPhysicsArena frame={frame} />
      </Suspense>
      <OrbitControls
        makeDefault
        target={[0, 3.45, 0]}
        enablePan={false}
        minDistance={8.8}
        maxDistance={22}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.52}
      />
    </Canvas>
  )
}
