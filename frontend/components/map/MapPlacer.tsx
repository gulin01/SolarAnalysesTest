'use client'

import { useCallback, useEffect } from 'react'
import Map, { Marker } from 'react-map-gl'
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
            <Marker latitude={latitude} longitude={longitude} anchor="center">
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#f59e0b',
                  border: '2px solid white',
                  boxShadow: '0 0 0 2px rgba(245,158,11,0.4)',
                  pointerEvents: 'none',
                }}
              />
            </Marker>
          )}
        </Map>
      </div>
      <div className="w-72 border-l p-4 overflow-y-auto">
        <PlacementControls />
      </div>
    </div>
  )
}
