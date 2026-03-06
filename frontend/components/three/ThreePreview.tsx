'use client'

import { Suspense, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Center, Bounds } from '@react-three/drei'
import { useModelStore } from '@/stores/modelStore'

interface ThreePreviewProps {
  projectId: string
  modelId: string
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} />
}

export default function ThreePreview({ projectId, modelId }: ThreePreviewProps) {
  const { modelUrl } = useModelStore()
  const url = modelUrl ?? `${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/models/${modelId}/download`

  return (
    <Canvas camera={{ position: [5, 5, 5], fov: 50 }} shadows>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
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
