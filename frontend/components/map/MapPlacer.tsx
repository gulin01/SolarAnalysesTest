'use client'

import { useCallback, useEffect } from 'react'
import Map from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { usePlacementStore } from '@/stores/placementStore'
import { usePlacementSync } from '@/hooks/usePlacementSync'
import { PlacementControls } from './PlacementControls'
import { MapSearch } from './MapSearch'
import { Placement } from '@/lib/types'
import { MAPBOX_INITIAL_ZOOM } from '@/lib/constants'

interface MapPlacerProps {
  projectId: string
  modelGlbUrl: string | null
  initialPlacement: Placement | null
}

export default function MapPlacer({ projectId, modelGlbUrl, initialPlacement }: MapPlacerProps) {
  const { setPlacement, latitude, longitude } = usePlacementStore()
  usePlacementSync(projectId)

  useEffect(() => {
    if (initialPlacement) setPlacement(initialPlacement)
  }, []) // only on mount

  const handleMapClick = useCallback(
    (e: mapboxgl.MapMouseEvent) => {
      setPlacement({ latitude: e.lngLat.lat, longitude: e.lngLat.lng })
    },
    [setPlacement]
  )

  return (
    <div className="h-full flex">
      <div className="flex-1 relative">
        <Map
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          initialViewState={{
            longitude: initialPlacement?.longitude ?? longitude,
            latitude: initialPlacement?.latitude ?? latitude,
            zoom: MAPBOX_INITIAL_ZOOM,
          }}
          mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          <MapSearch />
          {latitude && longitude && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#f59e0b',
                border: '2px solid white',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          )}
        </Map>
      </div>
      <div className="w-72 border-l p-4 overflow-y-auto">
        <PlacementControls />
      </div>
    </div>
  )
}
