import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useCallback, useRef, type MutableRefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SingleArmScene, type ViewportHudRefs } from './TwinPhysicsArena'
import { type Frame, type Terminal } from './types'

export type CameraFocusMode = 'both' | 'legacy' | 'evolved'

export type CameraSyncState = {
  position: [number, number, number]
  target: [number, number, number]
}

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [1.45, 1.78, 5.75]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [1.4, 1.42, 0]

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

  // Non-overlapping 2D HUD DOM refs (zero floating 3D <Html> tags inside Canvas!)
  const topTelemetryRef = useRef<HTMLDivElement | null>(null)
  const conveyorStatusRef = useRef<HTMLDivElement | null>(null)
  const conveyorYieldRef = useRef<HTMLDivElement | null>(null)
  const bottomSafetyRef = useRef<HTMLDivElement | null>(null)

  const hudRefs: ViewportHudRefs = {
    topTelemetryRef,
    conveyorStatusRef,
    conveyorYieldRef,
    bottomSafetyRef,
  }

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
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundImage:
          "linear-gradient(180deg, rgba(11, 17, 32, 0.25) 0%, rgba(11, 17, 32, 0.42) 100%), url('/factory-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center 55%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Canvas
        shadows
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 1.5]}
        camera={{ position: initialPos, fov: 38, near: 0.1, far: 100 }}
        onCreated={({ camera, gl }) => {
          gl.setClearColor(0x000000, 0)
          camera.lookAt(...initialTarget)
        }}
      >
        <ambientLight color="#f1f5f9" intensity={1.55} />
        <hemisphereLight args={['#ffffff', '#1e293b', 1.2]} />
        <directionalLight
          castShadow
          position={[4.5, 9.5, 7.5]}
          intensity={2.5}
          color="#ffffff"
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-4.5, 6.0, -4.0]} intensity={1.2} color="#38bdf8" />
        <pointLight position={[1.8, 3.6, 2.0]} intensity={1.8} color="#f8fafc" distance={14} />

        <Suspense fallback={null}>
          <SingleArmScene side={side} frame={frame} hudRefs={hudRefs} />
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

      {/* NON-OVERLAPPING 2D CORNER HUD OVERLAYS (Zero 3D label collisions!) */}
      {/* 1. Top-Left Angle & Error Readout */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div
          ref={topTelemetryRef}
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            backdropFilter: 'blur(6px)',
            color: '#f8fafc',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '10.5px',
            fontWeight: 700,
            padding: '4px 9px',
            borderRadius: '4px',
            border: '1px solid #334155',
            borderLeft: `3.5px solid ${side === 'left' ? '#f97316' : '#06b6d4'}`,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          TARGET: 30.0° · ACTUAL θ: 30.0° · ERROR Δθ: +0.0° · PWM: 0%
        </div>
      </div>

      {/* 2. Top-Right Conveyor Transfer Outcome & Yield Counter */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '4px',
        }}
      >
        <div
          ref={conveyorStatusRef}
          style={{
            backgroundColor: '#059669',
            color: '#ffffff',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '10px',
            fontWeight: 800,
            padding: '4px 9px',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          ✓ PASSING TO UPPER BELT (θ = 30.0°)
        </div>
        <div
          ref={conveyorYieldRef}
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            backdropFilter: 'blur(6px)',
            color: '#e2e8f0',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '9.5px',
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: '4px',
            border: '1px solid #334155',
          }}
        >
          PICKED (UPPER PASS): 0 · MISSED (LOWER REJECT): 0
        </div>
      </div>

      {/* 3. Bottom-Left Plant Physics & Safety Status */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '10px',
          pointerEvents: 'none',
        }}
      >
        <div
          ref={bottomSafetyRef}
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            backdropFilter: 'blur(6px)',
            color: '#cbd5e1',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '9.5px',
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: '4px',
            border: '1px solid #334155',
          }}
        >
          g ↓ (-Y) · ω: 0.0°/s · TEMP: 30.0°C · COOLING: OFF · E-STOP: OK (RUN)
        </div>
      </div>
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
        background: '#0b1120',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRight: '2px solid #334155',
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
