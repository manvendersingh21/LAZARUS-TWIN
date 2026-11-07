import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Suspense, useCallback, useRef, type MutableRefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import PlcChassis3D from './PlcChassis3D'
import TwinPhysicsArena, { type ViewportHudRefs } from './TwinPhysicsArena'
import { type Frame, type Terminal } from './types'

export type CameraFocusMode = 'both' | 'plc' | 'legacy' | 'evolved'

export type CameraSyncState = {
  position: [number, number, number]
  target: [number, number, number]
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 3.35, 11.4]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 2.35, 0]

export const CAMERA_PRESETS: Record<CameraFocusMode, CameraSyncState> = {
  both: {
    position: [0, 3.35, 11.4],
    target: [0, 2.35, 0],
  },
  plc: {
    position: [0, 4.45, 5.8],
    target: [0, 4.25, -0.4],
  },
  legacy: {
    position: [-3.45, 2.05, 5.4],
    target: [-3.45, 1.45, 0.25],
  },
  evolved: {
    position: [3.65, 2.05, 5.4],
    target: [3.65, 1.45, 0.25],
  },
}

export const defaultPins: Terminal[] = [
  {
    id: '%IW0',
    label: 'Target angle',
    slot: 1,
    state: 'INFERRED',
    offset: '0x11c0',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%IW1',
    label: 'Joint angle',
    slot: 1,
    state: 'INFERRED',
    offset: '0x11c8',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%IW2',
    label: 'Angular velocity',
    slot: 1,
    state: 'INFERRED',
    offset: '0x11d0',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%IW3',
    label: 'Core temperature',
    slot: 1,
    state: 'UNKNOWN',
    offset: '0x11e2',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%QW0',
    label: 'Motor PWM',
    slot: 2,
    state: 'INFERRED',
    offset: '0x1204',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%QX0.0',
    label: 'Emergency relay',
    slot: 3,
    state: 'UNKNOWN',
    offset: '0x11ea',
    governor_function: 'step(int256,int256,int256,int256)',
  },
  {
    id: '%QX0.1',
    label: 'Cooling relay',
    slot: 3,
    state: 'UNKNOWN',
    offset: '0x11f4',
    governor_function: 'step(int256,int256,int256,int256)',
  },
]

function SynchronizedCameraRig({
  cameraSync,
  controlsRef,
  isApplyingSyncRef,
}: {
  cameraSync?: MutableRefObject<CameraSyncState>
  controlsRef: MutableRefObject<OrbitControlsImpl | null>
  isApplyingSyncRef: MutableRefObject<boolean>
}) {
  const { camera } = useThree()

  useFrame(() => {
    if (!cameraSync?.current) return
    const [px, py, pz] = cameraSync.current.position
    const [tx, ty, tz] = cameraSync.current.target
    const controls = controlsRef.current

    const posDiff =
      Math.abs(camera.position.x - px) +
      Math.abs(camera.position.y - py) +
      Math.abs(camera.position.z - pz)

    const targetDiff = controls
      ? Math.abs(controls.target.x - tx) +
        Math.abs(controls.target.y - ty) +
        Math.abs(controls.target.z - tz)
      : 0

    if (posDiff > 1e-4 || targetDiff > 1e-4) {
      isApplyingSyncRef.current = true
      camera.position.set(px, py, pz)
      if (controls) {
        controls.target.set(tx, ty, tz)
        controls.update()
      } else {
        camera.lookAt(tx, ty, tz)
      }
      isApplyingSyncRef.current = false
    }
  })

  return null
}

export default function WorkbenchScene({
  terminals,
  frame,
  selected,
  evmPassed,
  cameraSync,
  leftHudRefs,
  rightHudRefs,
  onCameraChange,
  onSelect,
  onHover,
}: {
  terminals?: Terminal[]
  frame: MutableRefObject<Frame>
  selected?: string | null
  evmPassed?: boolean
  focusMode?: CameraFocusMode
  cameraSync?: MutableRefObject<CameraSyncState>
  leftHudRefs?: ViewportHudRefs
  rightHudRefs?: ViewportHudRefs
  onCameraChange?: () => void
  onSelect?: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const isApplyingSyncRef = useRef(false)
  const internalSyncRef = useRef<CameraSyncState>({
    position: [...DEFAULT_CAMERA_POSITION],
    target: [...DEFAULT_CAMERA_TARGET],
  })
  const activeSyncRef = cameraSync ?? internalSyncRef

  const handleControlsChange = useCallback(() => {
    if (isApplyingSyncRef.current) return
    const controls = controlsRef.current
    if (!controls) return
    const cam = controls.object
    activeSyncRef.current = {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    }
    onCameraChange?.()
  }, [activeSyncRef, onCameraChange])

  const initialPos = activeSyncRef.current.position
  const initialTarget = activeSyncRef.current.target

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: initialPos, fov: 38, near: 0.1, far: 100 }}
      onCreated={({ camera }) => {
        camera.lookAt(...initialTarget)
      }}
    >
      <color attach="background" args={['#0a1217']} />
      <fog attach="fog" args={['#0a1217', 16, 36]} />
      <ambientLight intensity={1.35} color="#dce7ec" />
      <hemisphereLight args={['#e6f4f1', '#142329', 1.1]} />
      <directionalLight
        castShadow
        position={[3.5, 10.5, 8.5]}
        intensity={2.2}
        color="#fffaf0"
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-5.5, 4.5, 3.0]} color="#68c9ff" intensity={20} distance={15} />
      <pointLight position={[5.5, 4.5, 3.0]} color="#6effc5" intensity={20} distance={15} />

      <Suspense fallback={null}>
        <Grid
          position={[0, -0.02, 0]}
          args={[36, 36]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#264042"
          sectionSize={2}
          sectionThickness={0.85}
          sectionColor="#365c59"
          fadeDistance={22}
          fadeStrength={1}
          infiniteGrid
        />
        <PlcChassis3D
          terminals={terminals?.length ? terminals : defaultPins}
          frame={frame}
          selected={selected ?? null}
          evmPassed={evmPassed}
          onSelect={pin => onSelect?.(pin)}
          onHover={pin => onHover?.(pin)}
        />
        <TwinPhysicsArena frame={frame} leftHudRefs={leftHudRefs} rightHudRefs={rightHudRefs} />
      </Suspense>

      <SynchronizedCameraRig
        cameraSync={activeSyncRef}
        controlsRef={controlsRef}
        isApplyingSyncRef={isApplyingSyncRef}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={initialTarget}
        enablePan={false}
        minDistance={4.2}
        maxDistance={19}
        minPolarAngle={Math.PI * 0.22}
        maxPolarAngle={Math.PI * 0.51}
        onChange={handleControlsChange}
      />
    </Canvas>
  )
}
