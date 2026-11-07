import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Suspense, type MutableRefObject } from 'react'
import PlcChassis3D from './PlcChassis3D'
import TwinPhysicsArena from './TwinPhysicsArena'
import { type Frame, type Terminal } from './types'

const defaultPins: Terminal[] = [
  { id: '%IW0', label: 'Target angle', slot: 1, state: 'INFERRED', offset: '0x11c0', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%IW1', label: 'Joint angle', slot: 1, state: 'INFERRED', offset: '0x11c8', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%IW2', label: 'Angular velocity', slot: 1, state: 'INFERRED', offset: '0x11d0', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%IW3', label: 'Core temperature', slot: 1, state: 'UNKNOWN', offset: '0x11e2', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%QW0', label: 'Motor PWM', slot: 2, state: 'INFERRED', offset: '0x1204', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%QX0.0', label: 'Emergency relay', slot: 3, state: 'UNKNOWN', offset: '0x11ea', governor_function: 'step(int256,int256,int256,int256)' },
  { id: '%QX0.1', label: 'Cooling relay', slot: 3, state: 'UNKNOWN', offset: '0x11f4', governor_function: 'step(int256,int256,int256,int256)' },
]

export default function WorkbenchScene({
  terminals,
  frame,
  selected,
  onSelect,
  onHover,
}: {
  terminals?: Terminal[]
  frame: MutableRefObject<Frame>
  selected: string | null
  onSelect: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [0, 5.2, 13.5], fov: 40, near: 0.1, far: 100 }} onCreated={({ camera }) => camera.lookAt(0, 3.5, 0)}>
      <color attach="background" args={['#0a1217']} />
      <fog attach="fog" args={['#0a1217', 20, 43]} />
      <ambientLight intensity={1.1} />
      <directionalLight castShadow position={[3, 10, 8]} intensity={2.2} shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-6, 5, 3]} color="#68c9ff" intensity={25} distance={15} />
      <pointLight position={[6, 5, 3]} color="#6effc5" intensity={22} distance={15} />
      <Suspense fallback={null}>
        <Grid
          position={[0, -0.09, 0]}
          args={[36, 36]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#365655"
          sectionSize={2}
          sectionThickness={0.8}
          sectionColor="#42615d"
          fadeDistance={22}
          fadeStrength={1}
          infiniteGrid
        />
        <PlcChassis3D terminals={terminals?.length ? terminals : defaultPins} frame={frame} selected={selected} onSelect={onSelect} onHover={onHover} />
        <TwinPhysicsArena frame={frame} />
      </Suspense>
      <OrbitControls makeDefault target={[0, 3.5, 0]} enablePan={false} minDistance={9} maxDistance={23} minPolarAngle={Math.PI * 0.22} maxPolarAngle={Math.PI * 0.53} />
    </Canvas>
  )
}
