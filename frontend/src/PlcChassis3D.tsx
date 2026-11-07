import { useFrame } from '@react-three/fiber'
import { Html, Line, RoundedBox } from '@react-three/drei'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type EvidenceState, type Frame, type Terminal, pinSignal, twinValue } from './types'

// High-Contrast Cyber-Industrial Tri-State Wire & Terminal Palette:
// SEEN = Cyber Emerald (#6effc5) - Probed Software I/O (60Hz live signal modulation)
// INFERRED = Industrial Amber (#f5a623) - Static Disassembly / Heuristic
// UNKNOWN = Fault Crimson (#ff4d5e) - Unprobed Hidden Hardware Branch
const palette: Record<EvidenceState, string> = {
  SEEN: '#6effc5',
  INFERRED: '#f5a623',
  UNKNOWN: '#ff4d5e',
}

const modules = [
  { code: 'PS 24V', tag: 'BUS POWER', hue: '#14242b' },
  { code: 'AI 16', tag: 'ANALOG IN', hue: '#112229' },
  { code: 'PWM 01', tag: 'SERVO DRV', hue: '#14242b' },
  { code: 'SR 02', tag: 'SAFETY RLY', hue: '#1c2f36' },
  { code: 'EVM 01', tag: 'ANVIL BRG', hue: '#112229' },
]

const slotX = (slot: number) => (slot - 2) * 1.45
const pinX = (pin: Terminal, i: number) =>
  slotX(pin.slot) + (pin.slot === 1 ? (i - 1.5) * 0.25 : pin.slot === 3 ? (i - 0.5) * 0.36 : 0)

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
          ? 0.75 + 0.65 * Math.sin(clock.elapsedTime * 6.5)
          : 0.55 + level * 1.75 + 0.22 * (1 + Math.sin(clock.elapsedTime * 3.5))
      led.current.emissiveIntensity = pulse
    }
    if (collar.current) {
      collar.current.emissiveIntensity = selected ? 1.25 : 0.38
    }
  })

  return (
    <group
      position={[x, 3.74, 0.02]}
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
        <cylinderGeometry args={[0.13, 0.13, 0.055, 20]} />
        <meshStandardMaterial
          ref={collar}
          color={selected ? '#ffffff' : color}
          emissive={color}
          emissiveIntensity={0.38}
          roughness={0.3}
        />
      </mesh>
      {/* Metallic screw terminal head */}
      <mesh position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.098, 0.098, 0.075, 20]} />
        <meshStandardMaterial color={selected ? '#ffffff' : '#d8e4e8'} metalness={0.88} roughness={0.2} />
      </mesh>
      {/* Status jewel LED */}
      <mesh position={[0, 0.085, 0.048]}>
        <sphereGeometry args={[0.065, 14, 14]} />
        <meshStandardMaterial ref={led} color={color} emissive={color} emissiveIntensity={1.35} roughness={0.18} />
      </mesh>
      {/* Screw slot detail */}
      <mesh position={[0, 0.12, 0.075]}>
        <boxGeometry args={[0.09, 0.018, 0.018]} />
        <meshBasicMaterial color="#091318" />
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
        new THREE.Vector3(start[0] * 0.92, 2.95 - index * 0.035, 0.28),
        new THREE.Vector3(end[0] * 0.85, 2.15 - index * 0.04, 0.22),
        new THREE.Vector3(...end)
      ),
    [start[0], start[1], start[2], end[0], end[1], end[2], index]
  )
  const points = useMemo(() => curve.getPoints(42), [curve])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 44, 0.024, 6, false), [curve])

  useFrame(({ clock }) => {
    if (!matRef.current) return
    const duty = Math.min(1, pinSignal(pin, frame.current))
    if (pin.state === 'SEEN') {
      matRef.current.emissiveIntensity = 0.55 + duty * 1.35 + 0.16 * Math.sin(clock.elapsedTime * 6 + index)
    } else if (pin.state === 'INFERRED') {
      matRef.current.emissiveIntensity = 0.38 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3 + index))
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
        opacity={0.92}
      />
    )
  }
  return (
    <mesh geometry={tube}>
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={color}
        emissiveIntensity={pin.state === 'SEEN' ? 0.85 : 0.45}
        roughness={0.28}
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

    let hex = '#6effc5'
    let intensity = 1.2

    if (slot === 0) {
      if (sabotage) {
        hex = '#f5a623'
        intensity = 1.2 + 0.5 * Math.sin(clock.elapsedTime * 6)
      } else {
        hex = '#6effc5'
        intensity = 1.2
      }
    } else if (slot === 1) {
      const iw3 = terminals.find(t => t.id === '%IW3')
      const iw1 = terminals.find(t => t.id === '%IW1')
      if (!iw3 || iw3.state === 'UNKNOWN') {
        hex = '#ff4d5e'
        intensity = 1.2 + 0.4 * Math.sin(clock.elapsedTime * 5)
      } else if (iw1?.state === 'INFERRED') {
        hex = '#f5a623'
        intensity = 1.05
      } else {
        hex = '#6effc5'
        intensity = 1.35
      }
    } else if (slot === 2) {
      if (estop) {
        hex = '#ff4d5e'
        intensity = 1.6 + 0.8 * Math.sin(clock.elapsedTime * 10)
      } else {
        hex = '#68c9ff'
        intensity = 0.65 + pwmDuty * 1.8
      }
    } else if (slot === 3) {
      const qx0 = terminals.find(t => t.id === '%QX0.0')
      const qx1 = terminals.find(t => t.id === '%QX0.1')
      const safetyUnknown = qx0?.state === 'UNKNOWN' || qx1?.state === 'UNKNOWN'
      if (estop) {
        hex = '#ff4d5e'
        intensity = 1.8 + 1.0 * Math.sin(clock.elapsedTime * 12)
      } else if (cooling) {
        hex = '#68c9ff'
        intensity = 1.6
      } else if (safetyUnknown) {
        hex = '#f5a623'
        intensity = 0.95 + 0.35 * Math.sin(clock.elapsedTime * 4)
      } else {
        hex = '#6effc5'
        intensity = 1.3
      }
    } else if (slot === 4) {
      if (evmPassed) {
        hex = '#6effc5'
        intensity = 1.4
      } else {
        hex = '#f5a623'
        intensity = 0.9 + 0.25 * Math.sin(clock.elapsedTime * 3)
      }
    }

    ledRef.current.color.set(hex)
    ledRef.current.emissive.set(hex)
    ledRef.current.emissiveIntensity = intensity
  })

  return (
    <mesh position={[-0.45, 0.55, 0.38]}>
      <sphereGeometry args={[0.052, 12, 12]} />
      <meshStandardMaterial ref={ledRef} color="#f5a623" emissive="#f5a623" emissiveIntensity={1.1} />
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
      let hex = '#6effc5'
      let intensity = 1.15
      if (estop || temp >= 88) {
        hex = '#ff4d5e'
        intensity = 1.8 + 1.4 * Math.abs(Math.sin(clock.elapsedTime * 10))
      } else if (sabotage || temp >= 72) {
        hex = '#f5a623'
        intensity = 1.35 + 0.8 * Math.abs(Math.sin(clock.elapsedTime * 5))
      } else if (hasUnknown) {
        hex = '#f5a623'
        intensity = 0.95 + 0.45 * Math.abs(Math.sin(clock.elapsedTime * 3.5))
      } else {
        hex = '#6effc5'
        intensity = 1.25
      }
      domeMatRef.current.color.set(hex)
      domeMatRef.current.emissive.set(hex)
      domeMatRef.current.emissiveIntensity = intensity
    }
  })

  return (
    <group position={[3.55, 5.58, -0.68]}>
      {/* Base mount */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.14, 20]} />
        <meshStandardMaterial color="#1b2c33" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Translucent beacon dome */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.14, 0.15, 0.28, 24]} />
        <meshStandardMaterial
          ref={domeMatRef}
          color="#f5a623"
          emissive="#f5a623"
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
        <meshStandardMaterial color="#0d181d" metalness={0.7} roughness={0.35} />
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
  const headerBarColor = allSeen ? '#6effc5' : anyUnknown ? '#ff4d5e' : '#f5a623'

  return (
    <group position={[0, 0.15, -0.35]}>
      {/* Grounded Steel Control Cabinet Stand & Floor Plinth */}
      <mesh position={[0, 1.85, -0.82]} castShadow receiveShadow>
        <boxGeometry args={[1.55, 3.7, 0.34]} />
        <meshStandardMaterial color="#1b2b32" metalness={0.75} roughness={0.36} />
      </mesh>
      {/* Vertical wire duct trunk inside pedestal */}
      <mesh position={[0, 1.8, -0.62]}>
        <boxGeometry args={[0.56, 3.5, 0.06]} />
        <meshStandardMaterial color="#111d22" metalness={0.68} roughness={0.42} />
      </mesh>
      {/* Heavy floor baseplate */}
      <mesh position={[0, 0.05, -0.78]} receiveShadow>
        <boxGeometry args={[2.1, 0.12, 0.86]} />
        <meshStandardMaterial color="#0f1b20" metalness={0.82} roughness={0.3} />
      </mesh>

      {/* Dark cyber-industrial DIN-rail PLC backplane */}
      <RoundedBox args={[8.1, 2.22, 0.42]} radius={0.07} position={[0, 4.35, -0.75]} castShadow receiveShadow>
        <meshStandardMaterial color="#142329" metalness={0.68} roughness={0.48} />
      </RoundedBox>
      {/* Top state indicator strip across PLC cabinet */}
      <mesh position={[0, 5.44, -0.54]}>
        <boxGeometry args={[7.8, 0.075, 0.16]} />
        <meshStandardMaterial
          color={headerBarColor}
          emissive={headerBarColor}
          emissiveIntensity={0.85}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>
      {/* Brushed aluminum DIN rail */}
      <mesh position={[0, 3.42, -0.45]}>
        <boxGeometry args={[7.8, 0.12, 0.18]} />
        <meshStandardMaterial color="#7b969c" metalness={0.88} roughness={0.24} />
      </mesh>

      {/* Rotary Alarm Strobe Tower on top-right of PLC cabinet */}
      <RotaryStrobeTower terminals={terminals} frame={frame} />

      {[0, 1, 2, 3, 4].map(slot => (
        <group position={[slotX(slot), 4.4, -0.4]} key={slot}>
          {/* Anodized dark-gunmetal industrial PLC module body */}
          <RoundedBox args={[1.32, 1.62, 0.64]} radius={0.04} castShadow receiveShadow>
            <meshStandardMaterial color="#24373e" metalness={0.55} roughness={0.36} />
          </RoundedBox>
          {/* High-contrast obsidian nameplate */}
          <mesh position={[0, 0.54, 0.34]}>
            <boxGeometry args={[1.18, 0.38, 0.06]} />
            <meshStandardMaterial color={modules[slot].hue} metalness={0.4} roughness={0.4} />
          </mesh>
          {/* Terminal block housing */}
          <mesh position={[0, -0.36, 0.34]}>
            <boxGeometry args={[1.18, 0.32, 0.07]} />
            <meshStandardMaterial color="#314952" metalness={0.45} roughness={0.36} />
          </mesh>
          {/* Cooling & bus slots */}
          {[0, 1, 2, 3, 4].map(n => (
            <mesh key={n} position={[-0.46 + n * 0.23, -0.1, 0.34]}>
              <boxGeometry args={[0.05, 0.3, 0.025]} />
              <meshStandardMaterial color="#111d22" />
            </mesh>
          ))}
          {/* Telemetry-driven Module Status LED */}
          <ModuleStatusLed slot={slot} terminals={terminals} evmPassed={evmPassed} frame={frame} />
          <Html position={[0, 0.53, 0.42]} center style={{ pointerEvents: 'none' }}>
            <div className="module-3d-label">
              <b>{modules[slot].code}</b>
              <span>{modules[slot].tag}</span>
            </div>
          </Html>
        </group>
      ))}

      {/* 7 Interactive Screw Terminals */}
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

      {/* Dual-Branch 3D Tri-State Bezier Wire Harnesses to Left Legacy & Right Evolved Workcells */}
      {pins.map(({ pin, x }, i) => (
        <group key={'harness-' + pin.id}>
          <Cable
            pin={pin}
            index={i}
            start={[x, 3.68, 0.02]}
            end={[-5.46 + i * 0.04, 1.38 + (i % 3) * 0.04, 0.12]}
            frame={frame}
          />
          <Cable
            pin={pin}
            index={i + 7}
            start={[x, 3.68, 0.02]}
            end={[1.64 + i * 0.04, 1.38 + (i % 3) * 0.04, 0.12]}
            frame={frame}
          />
        </group>
      ))}
    </group>
  )
}
