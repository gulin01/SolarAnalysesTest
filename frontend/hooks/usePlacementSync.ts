'use client'

import { useEffect, useRef } from 'react'
import { usePlacementStore } from '@/stores/placementStore'
import { apiClient } from '@/lib/api'

const DEBOUNCE_MS = 800

export function usePlacementSync(projectId: string) {
  const placement = usePlacementStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      apiClient.patch(`/projects/${projectId}/placement`, {
        latitude: placement.latitude,
        longitude: placement.longitude,
        rotation_deg: placement.rotation_deg,
        scale: placement.scale,
        elevation_m: placement.elevation_m,
      }).catch(console.error)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [
    projectId,
    placement.latitude,
    placement.longitude,
    placement.rotation_deg,
    placement.scale,
    placement.elevation_m,
  ])
}
