import dynamic from 'next/dynamic'
import { fetchProject } from '@/lib/api'

const UploadDropzone = dynamic(() => import('@/components/upload/UploadDropzone'), { ssr: false })
const ThreePreview = dynamic(() => import('@/components/three/ThreePreview'), {
  ssr: false,
  loading: () => <div className="h-64 bg-muted rounded-lg animate-pulse" />,
})

export default async function UploadPage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Upload 3D Model</h1>
        <p className="text-muted-foreground mt-1">
          Supported formats: GLB, GLTF, OBJ, STL, IFC
        </p>
      </div>

      <UploadDropzone projectId={params.id} />

      {project.model_id && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Model Preview</h2>
          <div className="h-96 rounded-lg overflow-hidden border">
            <ThreePreview projectId={params.id} modelId={project.model_id} />
          </div>
        </div>
      )}
    </div>
  )
}