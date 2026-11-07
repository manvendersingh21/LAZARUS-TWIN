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

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [1.35, 1.62, 5.15]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [1.35, 1.32, 0]

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
        background: '#222a34',
      }}
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: initialPos, fov: 36, near: 0.1, far: 100 }}
        onCreated={({ camera }) => {
          camera.lookAt(...initialTarget)
        }}
      >
        {/* Warm-cool industrial studio lighting matched to factory-bg.jpg high-bay LEDs */}
        <color attach="background" args={['#222a34']} />
        <fog attach="fog" args={['#242c37', 7.8, 17.5]} />
        <ambientLight color="#dce3ec" intensity={1.45} />
        <hemisphereLight args={['#f4f6f8', '#2a333e', 1.15]} />
        <directionalLight
          castShadow
          position={[3.8, 8.5, 6.5]}
          intensity={2.1}
          color="#fffaf0"
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-4.2, 5.5, -2.5]} intensity={0.95} color="#90cdf4" />
        <pointLight position={[1.5, 3.0, 2.0]} intensity={1.25} color="#fefcbf" distance={11} />

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
          minDistance={3.2}
          maxDistance={8.5}
          minPolarAngle={Math.PI * 0.28}
          maxPolarAngle={Math.PI * 0.48}
          minAzimuthAngle={-Math.PI * 0.18}
          maxAzimuthAngle={Math.PI * 0.18}
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
            background: 'rgba(26, 32, 44, 0.86)',
            backdropFilter: 'blur(6px)',
            color: '#edf2f7',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '10.5px',
            fontWeight: 700,
            padding: '4px 9px',
            borderRadius: '4px',
            border: '1px solid rgba(113, 128, 150, 0.4)',
            borderLeft: `3.5px solid ${side === 'left' ? '#c25929' : '#2b7c94'}`,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.32)',
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
            backgroundColor: 'rgba(39, 103, 73, 0.92)',
            backdropFilter: 'blur(6px)',
            color: '#f0fff4',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '10px',
            fontWeight: 800,
            padding: '4px 9px',
            borderRadius: '4px',
            border: '1px solid rgba(72, 187, 120, 0.35)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.32)',
          }}
        >
          ✓ PASSING TO UPPER BELT (θ = 30.0°)
        </div>
        <div
          ref={conveyorYieldRef}
          style={{
            background: 'rgba(26, 32, 44, 0.86)',
            backdropFilter: 'blur(6px)',
            color: '#cbd5e1',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '9.5px',
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: '4px',
            border: '1px solid rgba(113, 128, 150, 0.4)',
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
            background: 'rgba(26, 32, 44, 0.86)',
            backdropFilter: 'blur(6px)',
            color: '#cbd5e1',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: '9.5px',
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: '4px',
            border: '1px solid rgba(113, 128, 150, 0.4)',
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
        background: '#222a34',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRight: '2px solid #3e4752',
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
