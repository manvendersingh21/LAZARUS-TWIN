import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei'
import { Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { Suspense, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { type Frame, type Terminal, twinValue } from './types'

const palette = { SEEN: '#54e6a2', INFERRED: '#ffba5b', UNKNOWN: '#f4505a' }
const modules = [
  { code: 'PS 24V', tag: 'POWER', hue: '#5e717b' }, { code: 'AI 16', tag: 'ANALOG IN', hue: '#2e5961' },
  { code: 'PWM 01', tag: 'SERVO', hue: '#48695a' }, { code: 'SR 02', tag: 'SAFETY', hue: '#807452' },
  { code: 'EVM 01', tag: 'BRIDGE', hue: '#4a5973' },
]
const slotX = (slot: number) => (slot - 2) * 1.65
const pinX = (pin: Terminal, i: number) => slotX(pin.slot) + (pin.slot === 1 ? (i - 1.5) * 0.27 : pin.slot === 3 ? (i - .5) * .4 : 0)
const signal = (pin: Terminal, frame: Frame): number => {
  const t = frame.right_evolved
  switch (pin.id) {
    case '%IW0': return Math.abs(twinValue(t, 'target', 'target_angle') ?? 0) / 90
    case '%IW1': return Math.abs(twinValue(t, 'angle', 'angle_deg', 'current_angle') ?? 0) / 90
    case '%IW2': return Math.abs(twinValue(t, 'velocity', 'angular_velocity') ?? 0) / 100
    case '%IW3': return Math.abs(twinValue(t, 'temperature', 'temp', 'core_temp_c') ?? 0) / 100
    case '%QW0': return Math.abs(twinValue(t, 'pwm', 'motor_pwm') ?? 0) / 100
    case '%QX0.0': return twinValue(t, 'estop') ?? 0
    case '%QX0.1': return twinValue(t, 'cooling') ?? 0
    default: return 0
  }
}

function ScrewPin({ pin, x, frame, selected, onSelect }: { pin: Terminal; x: number; frame: MutableRefObject<Frame>; selected: boolean; onSelect: (terminal: Terminal) => void }) {
  const led = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => { if (led.current) led.current.emissiveIntensity = .35 + Math.min(1, signal(pin, frame.current)) * 1.6 + .18 * (1 + Math.sin(clock.elapsedTime * 3)) })
  const color = palette[pin.state] ?? palette.UNKNOWN
  return <group position={[x, 5.48, .8]} onClick={e => { e.stopPropagation(); onSelect(pin) }} onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = 'auto' }}>
    <mesh><cylinderGeometry args={[.1,.1,.08,20]} /><meshStandardMaterial color={selected ? '#f0fffd' : '#777d72'} metalness={.9} roughness={.28} /></mesh>
    <mesh position={[0,.07,.04]}><sphereGeometry args={[.065,12,12]} /><meshStandardMaterial ref={led} color={color} emissive={color} emissiveIntensity={1} /></mesh>
    <mesh position={[0,.115,.075]}><boxGeometry args={[.09,.018,.018]} /><meshBasicMaterial color="#dce5d9" /></mesh>
  </group>
}

function Cable({ pin, start, end, index }: { pin: Terminal; start: [number, number, number]; end: [number, number, number]; index: number }) {
  const color = palette[pin.state] ?? palette.UNKNOWN
  const curve = useMemo(() => new THREE.CubicBezierCurve3(new THREE.Vector3(...start), new THREE.Vector3(start[0], 4.55-index*.045, 1.15), new THREE.Vector3(end[0], 4.05-index*.11, .5), new THREE.Vector3(...end)), [start[0], start[1], start[2], end[0], end[1], end[2], index])
  const points = useMemo(() => curve.getPoints(40), [curve])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 48, .026, 5, false), [curve])
  if (pin.state === 'UNKNOWN') return <Line points={points} color={color} lineWidth={1.8} dashed dashSize={.14} gapSize={.1} transparent opacity={.9} />
  return <mesh geometry={tube}><meshStandardMaterial color={color} emissive={color} emissiveIntensity={pin.state === 'SEEN' ? .9 : .35} roughness={.3} /></mesh>
}

function Cabinet({ terminals, frame, selected, onSelect }: { terminals: Terminal[]; frame: MutableRefObject<Frame>; selected: string | null; onSelect: (terminal: Terminal) => void }) {
  const perSlot = new Map<number, number>()
  const pins = terminals.map(pin => { const i = perSlot.get(pin.slot) ?? 0; perSlot.set(pin.slot, i + 1); return { pin, x: pinX(pin, i) } })
  return <group>
    <RoundedBox args={[9.15,2.45,.42]} radius={.08} position={[0,6.06,-.12]}><meshStandardMaterial color="#1a292e" metalness={.72} roughness={.35} /></RoundedBox>
    <mesh position={[0,7.26,.1]}><boxGeometry args={[8.8,.07,.16]} /><meshStandardMaterial color="#839397" metalness={.85} roughness={.28} /></mesh>
    <mesh position={[0,5.12,.2]}><boxGeometry args={[8.8,.12,.18]} /><meshStandardMaterial color="#89999a" metalness={.9} roughness={.3} /></mesh>
    {[0,1,2,3,4].map(slot => <group position={[slotX(slot),6.13,.25]} key={slot}>
      <RoundedBox args={[1.44,1.74,.68]} radius={.045}><meshStandardMaterial color="#c3c4af" metalness={.3} roughness={.45} /></RoundedBox>
      <mesh position={[0,.58,.36]}><boxGeometry args={[1.3,.42,.06]} /><meshStandardMaterial color={modules[slot].hue} metalness={.3} roughness={.5} /></mesh>
      <mesh position={[0,-.39,.36]}><boxGeometry args={[1.3,.34,.07]} /><meshStandardMaterial color="#aeb7a9" metalness={.3} /></mesh>
      {[0,1,2,3,4].map(n=><mesh key={n} position={[-.52+n*.26,-.12,.363]}><boxGeometry args={[.055,.33,.025]} /><meshStandardMaterial color="#76897e" /></mesh>)}
      <mesh position={[-.5,.6,.405]}><sphereGeometry args={[.045,10,10]} /><meshStandardMaterial color="#9dff9e" emissive="#71ffab" emissiveIntensity={1.2} /></mesh>
      <Html position={[0,.57,.44]} center style={{ pointerEvents:'none' }}><div className="module-3d-label"><b>{modules[slot].code}</b><span>{modules[slot].tag}</span></div></Html>
      <Html position={[0,1.1,.1]} center style={{ pointerEvents:'none' }}><span className="module-slot">0{slot}</span></Html>
    </group>)}
    {pins.map(({pin,x})=><ScrewPin key={pin.id} pin={pin} x={x} frame={frame} selected={selected === pin.id} onSelect={onSelect} />)}
    {pins.map(({pin,x},i)=><Cable key={'wire-'+pin.id} pin={pin} index={i} start={[x,5.42,.72]} end={[i % 2 ? 3.4 : -3.4, 2.3 + i*.06, .15]} />)}
  </group>
}

function RobotArm({ side, frame }: { side: 'left'|'right'; frame: MutableRefObject<Frame> }) {
  const arm = useRef<RapierRigidBody>(null)
  const current = useRef(0)
  const warning = useRef<THREE.MeshStandardMaterial>(null)
  const x = side === 'left' ? -3.35 : 3.35
  const accent = side === 'left' ? '#7caec0' : '#60d9a1'
  useFrame((_, delta) => {
    const twin = side === 'left' ? frame.current.left_legacy : frame.current.right_evolved
    const angle = twinValue(twin, 'angle', 'angle_deg', 'current_angle') ?? 0
    current.current = THREE.MathUtils.damp(current.current, -angle * Math.PI/180, 8, delta)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), current.current)
    arm.current?.setNextKinematicRotation({ x:q.x, y:q.y, z:q.z, w:q.w })
    if (warning.current) {
      const temp = twinValue(twin, 'temperature', 'temp', 'core_temp_c') ?? 20
      warning.current.emissive.set(temp >= 88 ? '#ff4a39' : temp >= 72 ? '#f9a448' : side === 'left' ? '#3285aa' : '#3fb884')
      warning.current.emissiveIntensity = temp >= 88 ? 2 : .65
    }
  })
  return <group position={[x,0,0]}>
    <RigidBody type="fixed" colliders="cuboid"><mesh position={[0,.05,0]} receiveShadow><boxGeometry args={[4.7,.22,3]} /><meshStandardMaterial color="#1c2c30" metalness={.65} roughness={.42} /></mesh></RigidBody>
    <mesh position={[0,.18,0]}><boxGeometry args={[4.55,.04,2.85]} /><meshStandardMaterial color="#3b5557" metalness={.8} roughness={.35} /></mesh>
    {[-1,1].map(n => <mesh key={n} position={[n*1.9,.2,0]}><boxGeometry args={[.08,.04,2.5]} /><meshStandardMaterial color="#82a4a3" metalness={.8} /></mesh>)}
    <mesh position={[0,.52,0]}><cylinderGeometry args={[.66,.78,.65,28]} /><meshStandardMaterial color="#566768" metalness={.75} roughness={.3} /></mesh>
    <mesh position={[0,.87,0]}><cylinderGeometry args={[.46,.59,.17,28]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.2} metalness={.45} /></mesh>
    <RigidBody ref={arm} type="kinematicPosition" position={[0,1.04,0]} colliders="cuboid">
      <mesh position={[0,1.05,0]} castShadow><boxGeometry args={[.42,2.15,.44]} /><meshStandardMaterial color="#bcc4ae" metalness={.58} roughness={.32} /></mesh>
      <mesh position={[0,1.05,.24]}><boxGeometry args={[.21,1.7,.06]} /><meshStandardMaterial color={accent} metalness={.6} /></mesh>
      <mesh position={[0,2.15,0]}><cylinderGeometry args={[.34,.34,.5,24]} /><meshStandardMaterial color="#52696a" metalness={.75} /></mesh>
      <mesh position={[0,2.54,0]} castShadow><boxGeometry args={[.62,.55,.62]} /><meshStandardMaterial color="#d29e47" metalness={.58} roughness={.32} /></mesh>
      <mesh position={[0,2.54,.32]}><boxGeometry args={[.36,.12,.02]} /><meshStandardMaterial color="#3b3426" /></mesh>
    </RigidBody>
    <mesh position={[-1.65,.53,.8]}><sphereGeometry args={[.28,24,24]} /><meshStandardMaterial ref={warning} color="#49676b" emissive={accent} emissiveIntensity={.65} metalness={.65} roughness={.25} /></mesh>
    <mesh position={[0,2.7,-.34]}><ringGeometry args={[.72,.735,48]} /><meshBasicMaterial color={accent} transparent opacity={.3} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0,2.7,-.35]}><ringGeometry args={[.9,.908,48]} /><meshBasicMaterial color={accent} transparent opacity={.17} side={THREE.DoubleSide} /></mesh>
  </group>
}

const defaultPins: Terminal[] = [
  {id:'%IW0',label:'Target angle',slot:1,state:'UNKNOWN'}, {id:'%IW1',label:'Joint angle',slot:1,state:'UNKNOWN'},
  {id:'%IW2',label:'Angular velocity',slot:1,state:'UNKNOWN'}, {id:'%IW3',label:'Core temperature',slot:1,state:'UNKNOWN'},
  {id:'%QW0',label:'Motor PWM',slot:2,state:'UNKNOWN'}, {id:'%QX0.0',label:'Emergency relay',slot:3,state:'UNKNOWN'}, {id:'%QX0.1',label:'Cooling relay',slot:3,state:'UNKNOWN'},
]
export default function WorkbenchScene({ terminals, frame, selected, onSelect }: { terminals?: Terminal[]; frame: MutableRefObject<Frame>; selected: string | null; onSelect: (terminal: Terminal) => void }) {
  return <Canvas shadows dpr={[1,1.5]} camera={{ position:[0,5.2,13.5], fov:40, near:.1, far:100 }} onCreated={({camera}) => camera.lookAt(0,3.5,0)}>
    <color attach="background" args={['#0a1217']} />
    <fog attach="fog" args={['#0a1217', 20, 43]} />
    <ambientLight intensity={1.1} /><directionalLight castShadow position={[3,10,8]} intensity={2.2} shadow-mapSize={[1024,1024]} />
    <pointLight position={[-6,5,3]} color="#68c9ff" intensity={25} distance={15}/><pointLight position={[6,5,3]} color="#6effc5" intensity={22} distance={15}/>
    <Suspense fallback={null}>
      <Grid position={[0,-.09,0]} args={[36,36]} cellSize={.5} cellThickness={.5} cellColor="#365655" sectionSize={2} sectionThickness={.8} sectionColor="#42615d" fadeDistance={22} fadeStrength={1} infiniteGrid />
      <Cabinet terminals={terminals?.length ? terminals : defaultPins} frame={frame} selected={selected} onSelect={onSelect}/>
      <Physics gravity={[0,-9.81,0]} timeStep="vary"><RobotArm side="left" frame={frame}/><RobotArm side="right" frame={frame}/></Physics>
    </Suspense>
    <OrbitControls makeDefault target={[0,3.5,0]} enablePan={false} minDistance={9} maxDistance={23} minPolarAngle={Math.PI*.22} maxPolarAngle={Math.PI*.53} />
  </Canvas>
}
