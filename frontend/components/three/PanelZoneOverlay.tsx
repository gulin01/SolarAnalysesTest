'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PanelZone } from '@/lib/types'
import { useViewerStore } from '@/stores/viewerStore'

interface PanelZoneOverlayProps {
  zones: PanelZone[]
  threshold: number
}

export function PanelZoneOverlay({ zones, threshold }: PanelZoneOverlayProps) {
  const { setSelectedZone, selectedZone } = useViewerStore()

  const visibleZones = useMemo(
    () => zones.filter((z) => z.avg_irradiance >= threshold),
    [zones, threshold]
  )

  return (
    <>
      {visibleZones.map((zone) => (
        <mesh
          key={zone.id}
          position={zone.centroid}
          onClick={() => setSelectedZone(zone === selectedZone ? null : zone)}
        >
          <planeGeometry args={[Math.sqrt(zone.area_m2), Math.sqrt(zone.area_m2)]} />
          <meshBasicMaterial
            color={zone === selectedZone ? '#fbbf24' : '#22c55e'}
            transparent
            opacity={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  )
}
