'use client'

// Placeholder for deck.gl SimpleMeshLayer integration.
// This component will render the 3D model on top of the Mapbox map
// using @deck.gl/mapbox overlay in Phase 2.

import { useEffect, useRef } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { useMap } from 'react-map-gl'
import { usePlacementStore } from '@/stores/placementStore'

interface ModelLayerProps {
  modelUrl: string
}

export function ModelLayer({ modelUrl }: ModelLayerProps) {
  const { current: map } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const { latitude, longitude, rotation_deg, scale, elevation_m } = usePlacementStore()

  useEffect(() => {
    if (!map) return
    const mapInstance = map.getMap()

    const layer = new SimpleMeshLayer({
      id: 'model-layer',
      data: [{ position: [longitude, latitude, elevation_m] }],
      mesh: modelUrl,
      getPosition: (d: any) => d.position,
      getOrientation: [0, -rotation_deg, 90],
      getScale: [scale, scale, scale],
      getColor: [255, 255, 255],
      pickable: false,
    })

    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({ layers: [layer] })
      mapInstance.addControl(overlayRef.current as any)
    } else {
      overlayRef.current.setProps({ layers: [layer] })
    }

    return () => {
      if (overlayRef.current) {
        mapInstance.removeControl(overlayRef.current as any)
        overlayRef.current = null
      }
    }
  }, [map, modelUrl, latitude, longitude, rotation_deg, scale, elevation_m])

  return null
}
