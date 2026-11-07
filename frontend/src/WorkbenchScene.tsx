import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Suspense, useCallback, useRef, type MutableRefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SingleArmScene } from './TwinPhysicsArena'
import { type Frame, type Terminal } from './types'

export type CameraFocusMode = 'both' | 'legacy' | 'evolved'

export type CameraSyncState = {
  position: [number, number, number]
  target: [number, number, number]
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0.6, 2.3, 5.4]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0.6, 2.1, 0]

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

export function Viewport3D({
  side,
  frame,
  cameraSync,
  onCameraChange,
}: {
  side: 'left' | 'right'
  frame: MutableRefObject<Frame>
  cameraSync?: MutableRefObject<CameraSyncState>
  onCameraChange?: () => void
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const isApplyingSyncRef = useRef(false)

  const handleControlsChange = useCallback(() => {
    if (isApplyingSyncRef.current) return
    const controls = controlsRef.current
    if (!controls || !cameraSync) return
    const cam = controls.object
    cameraSync.current = {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    }
    onCameraChange?.()
  }, [cameraSync, onCameraChange])

  const initialPos = cameraSync?.current?.position ?? DEFAULT_CAMERA_POSITION
  const initialTarget = cameraSync?.current?.target ?? DEFAULT_CAMERA_TARGET

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: initialPos, fov: 38, near: 0.1, far: 100 }}
        onCreated={({ camera }) => camera.lookAt(...initialTarget)}
      >
        <color attach="background" args={['#f8fafc']} />
        <fog attach="fog" args={['#f8fafc', 18, 42]} />

        <ambientLight color="#f8fafc" intensity={1.5} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.95]} />
        <directionalLight
          castShadow
          position={[4.5, 9.5, 7.5]}
          intensity={2.0}
          color="#ffffff"
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-4.5, 6.0, -4.0]} intensity={0.75} color="#e0f2fe" />

        <Suspense fallback={null}>
          {/* Subtle floor plane at y = 0 receiving shadows */}
          <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.55} metalness={0.05} />
          </mesh>

          <Grid
            position={[0, 0, 0]}
            args={[28, 28]}
            cellSize={0.5}
            cellThickness={0.55}
            cellColor="#cbd5e1"
            sectionSize={2}
            sectionThickness={0.95}
            sectionColor="#94a3b8"
            fadeDistance={22}
            fadeStrength={1}
            infiniteGrid
          />

          <SingleArmScene side={side} frame={frame} />
        </Suspense>

        <SynchronizedCameraRig
          cameraSync={cameraSync}
          controlsRef={controlsRef}
          isApplyingSyncRef={isApplyingSyncRef}
        />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          target={initialTarget}
          enablePan={false}
          minDistance={3.0}
          maxDistance={12.0}
          minPolarAngle={Math.PI * 0.15}
          maxPolarAngle={Math.PI * 0.52}
          onChange={handleControlsChange}
        />
      </Canvas>
    </div>
  )
}

export default function WorkbenchScene({
  frame,
  cameraSync,
  onCameraChange,
}: {
  terminals?: Terminal[]
  frame: MutableRefObject<Frame>
  selected?: string | null
  evmPassed?: boolean
  focusMode?: CameraFocusMode
  cameraSync?: MutableRefObject<CameraSyncState>
  onCameraChange?: () => void
  onSelect?: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  const internalSyncRef = useRef<CameraSyncState>({
    position: [...DEFAULT_CAMERA_POSITION],
    target: [...DEFAULT_CAMERA_TARGET],
  })
  const activeSyncRef = cameraSync ?? internalSyncRef

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        width: '100%',
        height: '100%',
        position: 'relative',
        background: '#f8fafc',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRight: '2px solid #cbd5e1',
          overflow: 'hidden',
        }}
      >
        <Viewport3D
          side="left"
          frame={frame}
          cameraSync={activeSyncRef}
          onCameraChange={onCameraChange}
        />
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <Viewport3D
          side="right"
          frame={frame}
          cameraSync={activeSyncRef}
          onCameraChange={onCameraChange}
        />
      </div>
    </div>
  )
}
