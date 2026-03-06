import Link from 'next/link'
import { fetchProject, fetchNearbyStations } from '@/lib/api'
import { AnalysisForm } from '@/components/analysis/AnalysisForm'
import { Button } from '@/components/ui/button'

export default async function AnalyzePage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)
  const hasPlacement =
    project.placement &&
    typeof project.placement.latitude === 'number' &&
    typeof project.placement.longitude === 'number' &&
    !Number.isNaN(project.placement.latitude) &&
    !Number.isNaN(project.placement.longitude)

  let stations: any[] = []
  if (hasPlacement) {
    try {
      stations = await fetchNearbyStations(project.placement!.latitude, project.placement!.longitude)
    } catch {
      // non-fatal
    }
  }

  if (!hasPlacement) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center space-y-4 pt-16">
        <h1 className="text-2xl font-bold">Place your model first</h1>
        <p className="text-muted-foreground">
          We need the building location to find nearby weather stations and compute solar angles.
        </p>
        <Link href={`/projects/${params.id}/place`}>
          <Button size="lg">Go to Map Placement →</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Configure Analysis</h1>
      <p className="text-muted-foreground mb-6">
        Select a weather station and set analysis parameters.
      </p>
      <AnalysisForm
        projectId={params.id}
        stations={stations}
        placementLat={project.placement!.latitude}
        placementLng={project.placement!.longitude}
      />
    </div>
  )
}
