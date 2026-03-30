import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import './App.css'

const OBJ_URL = '/WebSample.obj'

const KEYPAD_KEYS = new Set([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '#',
  '*',
])

const PULSE_MS = 200
/** 모델 단위: 키가 판 안으로 들어가지 않게 카메라 쪽으로만 살짝 돌출 */
const OUT_PUSH = 0.065
const FLASH_EMISSIVE = 0xa8f5c8
const FLASH_EMISSIVE_PEAK = 0.42
const _camWorldPos = new THREE.Vector3()
const _meshWorldPos = new THREE.Vector3()
const _worldToCam = new THREE.Vector3()
const _invMeshWorld = new THREE.Matrix4()
const _localPush = new THREE.Vector3()

function outwardPushInLocalSpace(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  distance: number,
) {
  mesh.updateWorldMatrix(true, false)
  mesh.getWorldPosition(_meshWorldPos)
  camera.getWorldPosition(_camWorldPos)
  _worldToCam.subVectors(_camWorldPos, _meshWorldPos).normalize()
  _invMeshWorld.copy(mesh.matrixWorld).invert()
  _localPush.copy(_worldToCam).transformDirection(_invMeshWorld).normalize()
  return _localPush.multiplyScalar(distance)
}

function isKeypadKey(name: string) {
  return KEYPAD_KEYS.has(name)
}

/**
 * 레이가 먼저 맞는 `Cube.15_*`는 C4D에서 보통 전화 키패드 순(행·열)으로 0…11 부여됨.
 * 파일 안 `o` 나열 순서(#, 0, *…)와 동일하지 않을 수 있어, 3×4 그리드로 고정.
 *   1 2 3 / 4 5 6 / 7 8 9 / * 0 #
 */
const CUBE15_LABELS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '*',
  '0',
  '#',
] as const

function resolveKeyLabel(obj: THREE.Object3D): string | null {
  if (obj instanceof THREE.Mesh && isKeypadKey(obj.name)) return obj.name
  const m = /^Cube\.15_(\d+)$/.exec(obj.name)
  if (!m) return null
  const i = Number.parseInt(m[1], 10)
  if (i < 0 || i >= CUBE15_LABELS.length) return null
  return CUBE15_LABELS[i]
}

function findMeshByName(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((c) => {
    if (found) return
    if (c instanceof THREE.Mesh && c.name === name) found = c
  })
  return found
}

let audioCtx: AudioContext | null = null

function playKeyBeep() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  if (!audioCtx) audioCtx = new AC()
  const ctx = audioCtx
  if (ctx.state === 'suspended') void ctx.resume()
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(880, t0)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.06, t0 + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + 0.08)
}

function normalizeMaterials(root: THREE.Group) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    const src = child.material
    const list = Array.isArray(src) ? src : [src]
    const next = list.map((m) => {
      if (!m) {
        return new THREE.MeshStandardMaterial({
          color: '#b8b8c0',
          metalness: 0.15,
          roughness: 0.55,
        })
      }
      if (m instanceof THREE.MeshStandardMaterial) return m
      const mat = new THREE.MeshStandardMaterial({
        color:
          'color' in m && m.color
            ? (m.color as THREE.Color).clone()
            : new THREE.Color('#b8b8c0'),
        map: 'map' in m ? m.map ?? undefined : undefined,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        metalness: 0.15,
        roughness: 0.55,
      })
      mat.needsUpdate = true
      return mat
    })
    child.material = next.length === 1 ? next[0] : next
  })
}

type PulseState = {
  mesh: THREE.Mesh
  basePosition: THREE.Vector3
  push: THREE.Vector3
  start: number
  materials: THREE.MeshStandardMaterial[]
}

function KeypadPressFX({ root }: { root: THREE.Group }) {
  const { camera, gl, controls } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const pulseRef = useRef<PulseState | null>(null)
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null)

  const fireKeyEffect = useCallback((mesh: THREE.Mesh, cam: THREE.Camera) => {
    const mats: THREE.MeshStandardMaterial[] = []
    const raw = mesh.material
    const list = Array.isArray(raw) ? raw : [raw]
    for (const m of list) {
      if (m instanceof THREE.MeshStandardMaterial) mats.push(m)
    }
    const push = outwardPushInLocalSpace(mesh, cam, OUT_PUSH).clone()
    const basePosition = mesh.position.clone()
    pulseRef.current = {
      mesh,
      basePosition,
      push,
      start: performance.now(),
      materials: mats,
    }
    mesh.position.copy(basePosition).add(push)
    for (const mat of mats) {
      mat.emissive.setHex(FLASH_EMISSIVE)
      mat.emissiveIntensity = FLASH_EMISSIVE_PEAK
    }
  }, [])

  useFrame(() => {
    const p = pulseRef.current
    if (!p) return
    const t = performance.now() - p.start
    if (t >= PULSE_MS) {
      p.mesh.position.copy(p.basePosition)
      for (const mat of p.materials) {
        mat.emissive.setHex(0)
        mat.emissiveIntensity = 0
      }
      pulseRef.current = null
      return
    }
    const k = t / PULSE_MS
    const ease = 1 - (1 - k) ** 2
    p.mesh.position
      .copy(p.basePosition)
      .addScaledVector(p.push, 1 - ease)
    for (const mat of p.materials) {
      mat.emissiveIntensity = FLASH_EMISSIVE_PEAK * (1 - ease)
    }
  })

  useEffect(() => {
    const el = gl.domElement
    const orbit = controls as { enabled?: boolean } | null

    const inCanvas = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      return (
        cx >= r.left &&
        cx <= r.right &&
        cy >= r.top &&
        cy <= r.bottom
      )
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!inCanvas(e.clientX, e.clientY)) return
      pointerDownRef.current = { x: e.clientX, y: e.clientY }
    }

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      const start = pointerDownRef.current
      pointerDownRef.current = null
      if (!start) return
      if (!inCanvas(e.clientX, e.clientY)) return
      const moved =
        Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y)
      if (moved > 8) return

      const r = el.getBoundingClientRect()
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(root, true)

      let key: string | null = null
      for (const hit of hits) {
        key = resolveKeyLabel(hit.object)
        if (key) break
      }
      if (!key) return

      const target = findMeshByName(root, key)
      if (!target) return

      playKeyBeep()

      if (orbit && 'enabled' in orbit) orbit.enabled = false
      fireKeyEffect(target, camera)
      requestAnimationFrame(() => {
        if (orbit && 'enabled' in orbit) orbit.enabled = true
      })
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [camera, gl, root, raycaster, ndc, fireKeyEffect, controls])

  return null
}

function ObjModel() {
  const group = useLoader(OBJLoader, OBJ_URL)

  useLayoutEffect(() => {
    normalizeMaterials(group)
  }, [group])

  return (
    <>
      <primitive object={group} />
      <KeypadPressFX root={group} />
    </>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={['#121218']} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-6, 4, -4]} intensity={0.35} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.15}>
          <ObjModel />
        </Bounds>
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </>
  )
}

function App() {
  return (
    <div className="viewer">
      <Canvas
        shadows
        camera={{ position: [4, 3, 6], fov: 45, near: 0.01, far: 5000 }}
        gl={{ antialias: true }}
      >
        <Scene />
      </Canvas>
    </div>
  )
}

export default App
