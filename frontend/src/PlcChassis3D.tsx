import { useFrame } from '@react-three/fiber'
import { Html, Line, RoundedBox } from '@react-three/drei'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, type Terminal, pinSignal } from './types'

const palette = { SEEN: '#54e6a2', INFERRED: '#ffba5b', UNKNOWN: '#f4505a' }
const modules = [
  { code: 'PS 24V', tag: 'POWER', hue: '#5e717b' },
  { code: 'AI 16', tag: 'ANALOG IN', hue: '#2e5961' },
  { code: 'PWM 01', tag: 'SERVO', hue: '#48695a' },
  { code: 'SR 02', tag: 'SAFETY', hue: '#807452' },
  { code: 'EVM 01', tag: 'BRIDGE', hue: '#4a5973' },
]
const slotX = (slot: number) => (slot - 2) * 1.65
const pinX = (pin: Terminal, i: number) => slotX(pin.slot) + (pin.slot === 1 ? (i - 1.5) * 0.27 : pin.slot === 3 ? (i - 0.5) * 0.4 : 0)

function ScrewPin({
  pin,
  x,
  frame,
  selected,
  onSelect,
  onHover,
}: {
  pin: Terminal
  x: number
  frame: MutableRefObject<Frame>
  selected: boolean
  onSelect: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  const led = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (led.current) {
      const level = Math.min(1, pinSignal(pin, frame.current))
      led.current.emissiveIntensity = 0.35 + level * 1.6 + 0.18 * (1 + Math.sin(clock.elapsedTime * 3.5))
    }
  })
  const color = palette[pin.state] ?? palette.UNKNOWN
  return (
    <group
      position={[x, 5.48, 0.8]}
      onClick={e => {
        e.stopPropagation()
        onSelect(pin)
      }}
      onPointerOver={e => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
        onHover?.(pin)
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
        onHover?.(null)
      }}
    >
      <mesh>
        <cylinderGeometry args={[0.1, 0.1, 0.08, 20]} />
        <meshStandardMaterial color={selected ? '#f0fffd' : '#777d72'} metalness={0.9} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.07, 0.04]}>
        <sphereGeometry args={[0.065, 12, 12]} />
        <meshStandardMaterial ref={led} color={color} emissive={color} emissiveIntensity={1} />
      </mesh>
      <mesh position={[0, 0.115, 0.075]}>
        <boxGeometry args={[0.09, 0.018, 0.018]} />
        <meshBasicMaterial color="#dce5d9" />
      </mesh>
    </group>
  )
}

function Cable({
  pin,
  start,
  end,
  index,
  frame,
}: {
  pin: Terminal
  start: [number, number, number]
  end: [number, number, number]
  index: number
  frame: MutableRefObject<Frame>
}) {
  const color = palette[pin.state] ?? palette.UNKNOWN
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const curve = useMemo(
    () =>
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(...start),
        new THREE.Vector3(start[0], 4.55 - index * 0.045, 1.15),
        new THREE.Vector3(end[0], 4.05 - index * 0.11, 0.5),
        new THREE.Vector3(...end)
      ),
    [start[0], start[1], start[2], end[0], end[1], end[2], index]
  )
  const points = useMemo(() => curve.getPoints(40), [curve])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.026, 5, false), [curve])
  useFrame(({ clock }) => {
    if (!matRef.current) return
    const duty = Math.min(1, pinSignal(pin, frame.current))
    if (pin.state === 'SEEN') {
      matRef.current.emissiveIntensity = 0.55 + duty * 1.45 + 0.12 * Math.sin(clock.elapsedTime * 6 + index)
    } else if (pin.state === 'INFERRED') {
      matRef.current.emissiveIntensity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3 + index))
    }
  })
  if (pin.state === 'UNKNOWN') {
    return <Line points={points} color={color} lineWidth={1.8} dashed dashSize={0.14} gapSize={0.1} transparent opacity={0.9} />
  }
  return (
    <mesh geometry={tube}>
      <meshStandardMaterial ref={matRef} color={color} emissive={color} emissiveIntensity={pin.state === 'SEEN' ? 0.95 : 0.45} roughness={0.3} />
    </mesh>
  )
}

export default function PlcChassis3D({
  terminals,
  frame,
  selected,
  onSelect,
  onHover,
}: {
  terminals: Terminal[]
  frame: MutableRefObject<Frame>
  selected: string | null
  onSelect: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  const perSlot = new Map<number, number>()
  const pins = terminals.map(pin => {
    const i = perSlot.get(pin.slot) ?? 0
    perSlot.set(pin.slot, i + 1)
    return { pin, x: pinX(pin, i) }
  })
  return (
    <group>
      <RoundedBox args={[9.15, 2.45, 0.42]} radius={0.08} position={[0, 6.06, -0.12]}>
        <meshStandardMaterial color="#1a292e" metalness={0.72} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 7.26, 0.1]}>
        <boxGeometry args={[8.8, 0.07, 0.16]} />
        <meshStandardMaterial color="#839397" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0, 5.12, 0.2]}>
        <boxGeometry args={[8.8, 0.12, 0.18]} />
        <meshStandardMaterial color="#89999a" metalness={0.9} roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3, 4].map(slot => (
        <group position={[slotX(slot), 6.13, 0.25]} key={slot}>
          <RoundedBox args={[1.44, 1.74, 0.68]} radius={0.045}>
            <meshStandardMaterial color="#c3c4af" metalness={0.3} roughness={0.45} />
          </RoundedBox>
          <mesh position={[0, 0.58, 0.36]}>
            <boxGeometry args={[1.3, 0.42, 0.06]} />
            <meshStandardMaterial color={modules[slot].hue} metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.39, 0.36]}>
            <boxGeometry args={[1.3, 0.34, 0.07]} />
            <meshStandardMaterial color="#aeb7a9" metalness={0.3} />
          </mesh>
          {[0, 1, 2, 3, 4].map(n => (
            <mesh key={n} position={[-0.52 + n * 0.26, -0.12, 0.363]}>
              <boxGeometry args={[0.055, 0.33, 0.025]} />
              <meshStandardMaterial color="#76897e" />
            </mesh>
          ))}
          <mesh position={[-0.5, 0.6, 0.405]}>
            <sphereGeometry args={[0.045, 10, 10]} />
            <meshStandardMaterial color="#9dff9e" emissive="#71ffab" emissiveIntensity={1.2} />
          </mesh>
          <Html position={[0, 0.57, 0.44]} center style={{ pointerEvents: 'none' }}>
            <div className="module-3d-label">
              <b>{modules[slot].code}</b>
              <span>{modules[slot].tag}</span>
            </div>
          </Html>
          <Html position={[0, 1.1, 0.1]} center style={{ pointerEvents: 'none' }}>
            <span className="module-slot">0{slot}</span>
          </Html>
        </group>
      ))}
      {pins.map(({ pin, x }) => (
        <ScrewPin key={pin.id} pin={pin} x={x} frame={frame} selected={selected === pin.id} onSelect={onSelect} onHover={onHover} />
      ))}
      {pins.map(({ pin, x }, i) => (
        <Cable key={'wire-' + pin.id} pin={pin} index={i} start={[x, 5.42, 0.72]} end={[i % 2 ? 3.4 : -3.4, 2.3 + i * 0.06, 0.15]} frame={frame} />
      ))}
    </group>
  )
}
