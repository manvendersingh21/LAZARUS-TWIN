import { useFrame } from '@react-three/fiber'
import { Html, Line, RoundedBox } from '@react-three/drei'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type EvidenceState, type Frame, type Terminal, pinSignal, twinValue } from './types'

// Honest Tri-State Wire & Terminal Palette:
// SEEN = Signal Blue (#0284c7) - Probed Software I/O (0.90 conf, physical wiring unverified)
// INFERRED = Industrial Amber (#d97706) - Heuristic / Unswept (0.65 conf)
// UNKNOWN = Fault Crimson (#dc2626) - Unprobed Branch (0.00 conf)
const palette: Record<EvidenceState, string> = {
  SEEN: '#0284c7',
  INFERRED: '#d97706',
  UNKNOWN: '#dc2626',
}

const modules = [
  { code: 'PS 24V', tag: 'BUS POWER', hue: '#1e293b' },
  { code: 'AI 16', tag: 'ANALOG IN', hue: '#0f172a' },
  { code: 'PWM 01', tag: 'SERVO DRV', hue: '#1e293b' },
  { code: 'SR 02', tag: 'SAFETY RLY', hue: '#334155' },
  { code: 'EVM 01', tag: 'ANVIL BRG', hue: '#0f172a' },
]

const slotX = (slot: number) => (slot - 2) * 1.65
const pinX = (pin: Terminal, i: number) =>
  slotX(pin.slot) + (pin.slot === 1 ? (i - 1.5) * 0.27 : pin.slot === 3 ? (i - 0.5) * 0.4 : 0)

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
  const collar = useRef<THREE.MeshStandardMaterial>(null)
  const color = palette[pin.state] ?? palette.UNKNOWN

  useFrame(({ clock }) => {
    if (led.current) {
      const level = Math.min(1, pinSignal(pin, frame.current))
      const pulse =
        pin.state === 'UNKNOWN'
          ? 0.65 + 0.55 * Math.sin(clock.elapsedTime * 6.5)
          : 0.45 + level * 1.65 + 0.2 * (1 + Math.sin(clock.elapsedTime * 3.5))
      led.current.emissiveIntensity = pulse
    }
    if (collar.current) {
      collar.current.emissiveIntensity = selected ? 0.9 : 0.22
    }
  })

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
      {/* Terminal insulating collar colored by evidence state */}
      <mesh position={[0, -0.03, 0]}>
        <cylinderGeometry args={[0.125, 0.125, 0.05, 20]} />
        <meshStandardMaterial
          ref={collar}
          color={selected ? '#0f172a' : color}
          emissive={color}
          emissiveIntensity={0.25}
          roughness={0.35}
        />
      </mesh>
      {/* Metallic screw terminal head */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.095, 0.095, 0.075, 20]} />
        <meshStandardMaterial color={selected ? '#ffffff' : '#cbd5e1'} metalness={0.88} roughness={0.22} />
      </mesh>
      {/* Status jewel LED */}
      <mesh position={[0, 0.08, 0.045]}>
        <sphereGeometry args={[0.062, 14, 14]} />
        <meshStandardMaterial ref={led} color={color} emissive={color} emissiveIntensity={1.2} roughness={0.2} />
      </mesh>
      {/* Screw slot detail */}
      <mesh position={[0, 0.12, 0.075]}>
        <boxGeometry args={[0.09, 0.018, 0.018]} />
        <meshBasicMaterial color="#0f172a" />
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
  const points = useMemo(() => curve.getPoints(42), [curve])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 48, 0.028, 6, false), [curve])

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const duty = Math.min(1, pinSignal(pin, frame.current))
    if (pin.state === 'SEEN') {
      matRef.current.emissiveIntensity = 0.45 + duty * 1.25 + 0.12 * Math.sin(clock.elapsedTime * 6 + index)
    } else if (pin.state === 'INFERRED') {
      matRef.current.emissiveIntensity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3 + index))
    }
  })

  if (pin.state === 'UNKNOWN') {
    return (
      <Line
        points={points}
        color={color}
        lineWidth={2.2}
        dashed
        dashSize={0.14}
        gapSize={0.09}
        transparent
        opacity={0.95}
      />
    )
  }
  return (
    <mesh geometry={tube}>
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={color}
        emissiveIntensity={pin.state === 'SEEN' ? 0.75 : 0.4}
        roughness={0.32}
      />
    </mesh>
  )
}

function ModuleStatusLed({
  slot,
  terminals,
  evmPassed,
  frame,
}: {
  slot: number
  terminals: Terminal[]
  evmPassed?: boolean
  frame: MutableRefObject<Frame>
}) {
  const ledRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(({ clock }) => {
    if (!ledRef.current) return
    const f = frame.current
    const right = f.right_evolved
    const left = f.left_legacy
    const estop = (twinValue(right, 'estop') ?? 0) > 0 || (twinValue(left, 'estop') ?? 0) > 0
    const cooling = (twinValue(right, 'cooling') ?? 0) > 0 || (twinValue(left, 'cooling') ?? 0) > 0
    const pwmDuty = Math.abs(twinValue(right, 'pwm', 'motor_pwm') ?? 0) / 100
    const sabotage = !!f.sabotage_active

    let hex = '#059669'
    let intensity = 1.1

    if (slot === 0) {
      // PS 24V: Emerald normal, Amber when sabotage_active (-58% torque drop)
      if (sabotage) {
        hex = '#d97706'
        intensity = 1.2 + 0.5 * Math.sin(clock.elapsedTime * 6)
      } else {
        hex = '#059669'
        intensity = 1.1
      }
    } else if (slot === 1) {
      // AI 16: Crimson if %IW3 is UNKNOWN, Amber if %IW1 is INFERRED, Signal Blue if SEEN
      const iw3 = terminals.find(t => t.id === '%IW3')
      const iw1 = terminals.find(t => t.id === '%IW1')
      if (!iw3 || iw3.state === 'UNKNOWN') {
        hex = '#dc2626'
        intensity = 1.1 + 0.4 * Math.sin(clock.elapsedTime * 5)
      } else if (iw1?.state === 'INFERRED') {
        hex = '#d97706'
        intensity = 1.0
      } else {
        hex = '#0284c7'
        intensity = 1.3
      }
    } else if (slot === 2) {
      // PWM 01: Crimson when estop == 1, otherwise pulses with live PWM duty
      if (estop) {
        hex = '#dc2626'
        intensity = 1.6 + 0.8 * Math.sin(clock.elapsedTime * 10)
      } else {
        hex = '#0284c7'
        intensity = 0.6 + pwmDuty * 1.8
      }
    } else if (slot === 3) {
      // SR 02 Safety Relay: Flashing Crimson on estop, Amber when safety boundaries UNKNOWN, Signal Blue when cooling or probed
      const qx0 = terminals.find(t => t.id === '%QX0.0')
      const qx1 = terminals.find(t => t.id === '%QX0.1')
      const safetyUnknown = qx0?.state === 'UNKNOWN' || qx1?.state === 'UNKNOWN'
      if (estop) {
        hex = '#dc2626'
        intensity = 1.8 + 1.0 * Math.sin(clock.elapsedTime * 12)
      } else if (cooling) {
        hex = '#0284c7'
        intensity = 1.6
      } else if (safetyUnknown) {
        hex = '#d97706'
        intensity = 0.95 + 0.35 * Math.sin(clock.elapsedTime * 4)
      } else {
        hex = '#0284c7'
        intensity = 1.25
      }
    } else if (slot === 4) {
      // EVM 01: Amber until evm_probe passes, then Signal Blue
      if (evmPassed) {
        hex = '#0284c7'
        intensity = 1.35
      } else {
        hex = '#d97706'
        intensity = 0.85 + 0.25 * Math.sin(clock.elapsedTime * 3)
      }
    }

    ledRef.current.color.set(hex)
    ledRef.current.emissive.set(hex)
    ledRef.current.emissiveIntensity = intensity
  })

  return (
    <mesh position={[-0.5, 0.6, 0.405]}>
      <sphereGeometry args={[0.052, 12, 12]} />
      <meshStandardMaterial ref={ledRef} color="#d97706" emissive="#d97706" emissiveIntensity={1.1} />
    </mesh>
  )
}

function RotaryStrobeTower({
  terminals,
  frame,
}: {
  terminals: Terminal[]
  frame: MutableRefObject<Frame>
}) {
  const domeMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const rotorRef = useRef<THREE.Mesh>(null)
  const hasUnknown = terminals.some(t => t.state === 'UNKNOWN')

  useFrame(({ clock }, delta) => {
    const f = frame.current
    const right = f.right_evolved
    const left = f.left_legacy
    const estop = (twinValue(right, 'estop') ?? 0) > 0 || (twinValue(left, 'estop') ?? 0) > 0
    const temp = Math.max(
      twinValue(right, 'temperature', 'temp', 'core_temp_c') ?? 25,
      twinValue(left, 'temperature', 'temp', 'core_temp_c') ?? 25
    )
    const sabotage = !!f.sabotage_active

    const speed = estop || temp >= 88 ? 14 : sabotage || hasUnknown ? 6 : 2
    if (rotorRef.current) {
      rotorRef.current.rotation.y += delta * speed
    }
    if (domeMatRef.current) {
      let hex = '#0284c7'
      let intensity = 1.1
      if (estop || temp >= 88) {
        hex = '#dc2626'
        intensity = 1.8 + 1.4 * Math.abs(Math.sin(clock.elapsedTime * 10))
      } else if (sabotage || temp >= 72) {
        hex = '#ea580c'
        intensity = 1.3 + 0.8 * Math.abs(Math.sin(clock.elapsedTime * 5))
      } else if (hasUnknown) {
        hex = '#d97706'
        intensity = 0.95 + 0.45 * Math.abs(Math.sin(clock.elapsedTime * 3.5))
      } else {
        hex = '#0284c7'
        intensity = 1.25
      }
      domeMatRef.current.color.set(hex)
      domeMatRef.current.emissive.set(hex)
      domeMatRef.current.emissiveIntensity = intensity
    }
  })

  return (
    <group position={[4.15, 7.45, 0.05]}>
      {/* Base mount */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.14, 20]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Translucent beacon dome */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.14, 0.15, 0.28, 24]} />
        <meshStandardMaterial
          ref={domeMatRef}
          color="#d97706"
          emissive="#d97706"
          emissiveIntensity={1.2}
          transparent
          opacity={0.88}
          roughness={0.18}
        />
      </mesh>
      {/* Internal rotating reflector */}
      <mesh ref={rotorRef} position={[0, 0.08, 0]}>
        <boxGeometry args={[0.18, 0.18, 0.04]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Top cap */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.145, 0.145, 0.04, 20]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  )
}

export default function PlcChassis3D({
  terminals,
  frame,
  selected,
  evmPassed,
  onSelect,
  onHover,
}: {
  terminals: Terminal[]
  frame: MutableRefObject<Frame>
  selected: string | null
  evmPassed?: boolean
  onSelect: (terminal: Terminal) => void
  onHover?: (terminal: Terminal | null) => void
}) {
  const perSlot = new Map<number, number>()
  const pins = terminals.map(pin => {
    const i = perSlot.get(pin.slot) ?? 0
    perSlot.set(pin.slot, i + 1)
    return { pin, x: pinX(pin, i) }
  })

  const allSeen = terminals.length > 0 && terminals.every(t => t.state === 'SEEN')
  const anyUnknown = terminals.some(t => t.state === 'UNKNOWN')
  const headerBarColor = allSeen ? '#0284c7' : anyUnknown ? '#dc2626' : '#d97706'

  return (
    <group>
      {/* Dark charcoal DIN-rail PLC backplane */}
      <RoundedBox args={[9.25, 2.5, 0.44]} radius={0.07} position={[0, 6.06, -0.12]} castShadow receiveShadow>
        <meshStandardMaterial color="#1e293b" metalness={0.62} roughness={0.55} />
      </RoundedBox>
      {/* Top state indicator strip across PLC cabinet */}
      <mesh position={[0, 7.27, 0.11]}>
        <boxGeometry args={[8.9, 0.075, 0.16]} />
        <meshStandardMaterial
          color={headerBarColor}
          emissive={headerBarColor}
          emissiveIntensity={0.65}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>
      {/* Lower DIN rail */}
      <mesh position={[0, 5.12, 0.2]}>
        <boxGeometry args={[8.9, 0.12, 0.18]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.88} roughness={0.26} />
      </mesh>

      {/* Rotary Alarm Strobe Tower on top-right of PLC cabinet */}
      <RotaryStrobeTower terminals={terminals} frame={frame} />

      {[0, 1, 2, 3, 4].map(slot => (
        <group position={[slotX(slot), 6.13, 0.25]} key={slot}>
          {/* Clean industrial light-slate module body */}
          <RoundedBox args={[1.44, 1.74, 0.68]} radius={0.04} castShadow receiveShadow>
            <meshStandardMaterial color="#e2e8f0" metalness={0.22} roughness={0.42} />
          </RoundedBox>
          {/* High-contrast dark slate nameplate */}
          <mesh position={[0, 0.58, 0.36]}>
            <boxGeometry args={[1.3, 0.42, 0.06]} />
            <meshStandardMaterial color={modules[slot].hue} metalness={0.35} roughness={0.45} />
          </mesh>
          {/* Terminal block housing */}
          <mesh position={[0, -0.39, 0.36]}>
            <boxGeometry args={[1.3, 0.34, 0.07]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.35} roughness={0.4} />
          </mesh>
          {/* Cooling & bus slots */}
          {[0, 1, 2, 3, 4].map(n => (
            <mesh key={n} position={[-0.52 + n * 0.26, -0.12, 0.363]}>
              <boxGeometry args={[0.055, 0.33, 0.025]} />
              <meshStandardMaterial color="#64748b" />
            </mesh>
          ))}
          {/* Telemetry-driven Module Status LED */}
          <ModuleStatusLed slot={slot} terminals={terminals} evmPassed={evmPassed} frame={frame} />
          <Html position={[0, 0.57, 0.44]} center style={{ pointerEvents: 'none' }}>
            <div className="module-3d-label">
              <b>{modules[slot].code}</b>
              <span>{modules[slot].tag}</span>
            </div>
          </Html>
          <Html position={[0, 1.1, 0.1]} center style={{ pointerEvents: 'none' }}>
            <span className="module-slot">SLOT 0{slot}</span>
          </Html>
        </group>
      ))}
      {pins.map(({ pin, x }) => (
        <ScrewPin
          key={pin.id}
          pin={pin}
          x={x}
          frame={frame}
          selected={selected === pin.id}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      {pins.map(({ pin, x }, i) => (
        <Cable
          key={'wire-' + pin.id}
          pin={pin}
          index={i}
          start={[x, 5.42, 0.72]}
          end={[i % 2 ? 3.35 : -3.35, 2.3 + i * 0.06, 0.15]}
          frame={frame}
        />
      ))}
    </group>
  )
}
