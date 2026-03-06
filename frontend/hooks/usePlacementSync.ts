'use client'

import { useEffect, useRef } from 'react'
import { usePlacementStore } from '@/stores/placementStore'
import { apiClient } from '@/lib/api'

const DEBOUNCE_MS = 800

export function usePlacementSync(projectId: string) {
  const placement = usePlacementStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  // Keep a ref to the latest placement so the beforeunload handler can read it
  const placementRef = useRef(placement)
  placementRef.current = placement

  // Debounced save on every change
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      apiClient.patch(`/projects/${projectId}/placement`, {
        latitude: placementRef.current.latitude,
        longitude: placementRef.current.longitude,
        rotation_deg: placementRef.current.rotation_deg,
        scale: placementRef.current.scale,
        elevation_m: placementRef.current.elevation_m,
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

  // Flush immediately when the user navigates away (closes tab or goes to next step).
  // sendBeacon survives page unload so the PATCH completes even after navigation.
  useEffect(() => {
    const handleUnload = () => {
      if (!mountedRef.current) return
      if (timerRef.current) clearTimeout(timerRef.current)
      const body = JSON.stringify({
        latitude: placementRef.current.latitude,
        longitude: placementRef.current.longitude,
        rotation_deg: placementRef.current.rotation_deg,
        scale: placementRef.current.scale,
        elevation_m: placementRef.current.elevation_m,
      })
      navigator.sendBeacon(
        `/api/projects/${projectId}/placement`,
        new Blob([body], { type: 'application/json' }),
      )
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [projectId])
}
