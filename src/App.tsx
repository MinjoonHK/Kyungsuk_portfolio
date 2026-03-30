import { Canvas, useLoader } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { Suspense, useLayoutEffect } from 'react'
import * as THREE from 'three'
import './App.css'

const OBJ_URL = '/WebSample.obj'

function ObjModel() {
  const group = useLoader(OBJLoader, OBJ_URL)

  useLayoutEffect(() => {
    group.traverse((child) => {
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
  }, [group])

  return <primitive object={group} />
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
