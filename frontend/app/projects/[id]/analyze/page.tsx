import Link from 'next/link'
import { fetchProject, fetchNearbyStations } from '@/lib/api'
import { AnalysisForm } from '@/components/analysis/AnalysisForm'
import { Button } from '@/components/ui/button'

// Seoul coordinates used as fallback when placement wasn't saved yet
const FALLBACK_LAT = 37.5665
const FALLBACK_LNG = 126.978

export default async function AnalyzePage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)
  const hasPlacement =
    project.placement &&
    typeof project.placement.latitude === 'number' &&
    typeof project.placement.longitude === 'number' &&
    !Number.isNaN(project.placement.latitude) &&
    !Number.isNaN(project.placement.longitude)

  const lat = hasPlacement ? project.placement!.latitude : FALLBACK_LAT
  const lng = hasPlacement ? project.placement!.longitude : FALLBACK_LNG

  let stations: any[] = []
  try {
    stations = await fetchNearbyStations(lat, lng)
  } catch {
    // non-fatal — form handles empty station list
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Configure Analysis</h1>
      <p className="text-muted-foreground mb-6">
        Select a weather station and set analysis parameters.
      </p>
      {!hasPlacement && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>Location not saved yet — using Seoul as default. For accurate results, set your location on the map first.</span>
          <Link href={`/projects/${params.id}/place`}>
            <Button size="sm" variant="outline">Set location</Button>
          </Link>
        </div>
      )}
      <AnalysisForm
        projectId={params.id}
        stations={stations}
        placementLat={lat}
        placementLng={lng}
      />
    </div>
  )
}

