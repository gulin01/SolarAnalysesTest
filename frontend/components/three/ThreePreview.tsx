'use client'

import { Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Center, Bounds } from '@react-three/drei'
import * as THREE from 'three'
import { useModelStore } from '@/stores/modelStore'

interface ThreePreviewProps {
  projectId: string
  modelId: string
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  
  // Ensure all meshes have proper lighting-compatible materials
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Don't replace if material is already good, but ensure it's not pure black
      if (!child.material || (child.material instanceof THREE.Material && !(child.material instanceof THREE.MeshStandardMaterial) && !(child.material instanceof THREE.MeshPhongMaterial))) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xbbbbbb,  // Light gray — visible with lighting
          roughness: 0.65,
          metalness: 0.05,
          side: THREE.DoubleSide,
        })
      }
    }
  })
  
  return <primitive object={scene} />
}

export default function ThreePreview({ projectId, modelId }: ThreePreviewProps) {
  const { modelUrl } = useModelStore()
  const url = modelUrl ?? `${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/models/${modelId}/download`

  return (
    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} shadows gl={{ antialias: true }}>
      {/* Lighting setup — CRITICAL for preventing black rendering */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 30, 20]} intensity={1.0} castShadow />
      <directionalLight position={[-15, 20, -10]} intensity={0.4} castShadow />
      <hemisphereLight args={["#b1e1ff", "#444444", 0.3]} />
      
      <Suspense fallback={null}>
        <Bounds fit clip observe>
          <Center>
            <Model url={url} />
          </Center>
        </Bounds>
      </Suspense>
      <OrbitControls makeDefault />
      <gridHelper args={[20, 20]} />
    </Canvas>
  )
}
