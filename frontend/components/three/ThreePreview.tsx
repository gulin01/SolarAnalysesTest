'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Center, Bounds } from '@react-three/drei'
import * as THREE from 'three'
import { useModelStore } from '@/stores/modelStore'

interface ThreePreviewProps {
  projectId: string
  modelId: string
}

const PREVIEW_MATERIAL = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.72, 0.72, 0.75),
  roughness: 0.65,
  metalness: 0.05,
  side: THREE.DoubleSide,
})

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.material = PREVIEW_MATERIAL
    })
    return clone
  }, [scene])
  return <primitive object={cloned} />
}

export default function ThreePreview({ projectId, modelId }: ThreePreviewProps) {
  const { modelUrl } = useModelStore()
  const url = modelUrl ?? `${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/models/${modelId}/download`

  return (
    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} shadows>
      {/* Three.js r155+ uses physically-correct lighting (lux/candela) */}
      <ambientLight intensity={1.0} />
      <hemisphereLight args={['#c8d8f0', '#444450', 2.5]} />
      <directionalLight position={[10, 10, 5]} intensity={3.5} castShadow />
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
