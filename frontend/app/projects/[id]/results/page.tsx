import dynamic from 'next/dynamic'
import Link from 'next/link'
import { fetchProject } from '@/lib/api'
import { Button } from '@/components/ui/button'

const HeatmapViewer = dynamic(() => import('@/components/three/HeatmapViewer'), {
  ssr: false,
  loading: () => <div className="h-full bg-muted animate-pulse" />,
})

function absoluteModelUrl(url: string | undefined): string | null {
  if (!url) return null
  if (url.startsWith('http')) return url
  const base = process.env.NEXT_PUBLIC_FASTAPI_URL || ''
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url
}

export default async function ResultsPage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)
  const modelGlbUrl = absoluteModelUrl(project.model?.normalized_glb_url) ?? null
  const hasModel = !!modelGlbUrl

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b">
        <h1 className="font-semibold">Analysis Results</h1>
        <p className="text-sm text-muted-foreground">
          Irradiance heatmap and optimal panel placement zones.
        </p>
      </div>
      <div className="flex-1">
        {!hasModel ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
            <h2 className="text-xl font-semibold">No model available</h2>
            <p className="text-muted-foreground max-w-md">
              Upload a 3D model first to run analysis and view results here.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href={`/projects/${params.id}/upload`}>
                <Button size="lg">Upload model</Button>
              </Link>
              <Link href={`/projects/${params.id}`}>
                <Button variant="outline" size="lg">Back to project</Button>
              </Link>
            </div>
          </div>
        ) : (
          <HeatmapViewer
            projectId={params.id}
            modelGlbUrl={modelGlbUrl}
            latestJobId={project.latest_job_id ?? null}
          />
        )}
      </div>
    </div>
  )
}