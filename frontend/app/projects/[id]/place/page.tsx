import dynamic from 'next/dynamic'
import { fetchProject } from '@/lib/api'

const MapPlacer = dynamic(() => import('@/components/map/MapPlacer'), {
  ssr: false,
  loading: () => <div className="h-full bg-muted animate-pulse" />,
})

function absoluteModelUrl(url: string | undefined): string | null {
  if (!url) return null
  if (url.startsWith('http')) return url
  const base = process.env.NEXT_PUBLIC_FASTAPI_URL || ''
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url
}

export default async function PlacePage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b flex items-center gap-3">
        <div>
          <h1 className="font-semibold">Place on Map</h1>
          <p className="text-sm text-muted-foreground">
            Click the map to position your model, then adjust rotation and scale.
          </p>
        </div>
      </div>
      <div className="flex-1">
        <MapPlacer
          projectId={params.id}
          modelGlbUrl={absoluteModelUrl(project.model?.normalized_glb_url) ?? null}
          initialPlacement={project.placement}
        />
      </div>
    </div>
  )
}