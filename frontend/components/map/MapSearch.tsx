'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useMap } from 'react-map-gl'
import { Input } from '@/components/ui/input'
import { usePlacementStore } from '@/stores/placementStore'

const MAPBOX_GEOCODING = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

interface GeocodeFeature {
  id: string
  place_name: string
  center: [number, number] // [lng, lat]
}

interface GeocodeResponse {
  features: GeocodeFeature[]
}

export function MapSearch() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodeFeature[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setPlacement } = usePlacementStore()
  const { current: mapRef } = useMap()

  const search = useCallback(async (q: string) => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token || !q.trim()) {
      setSuggestions([])
      return
    }
    setLoading(true)
    try {
      const url = `${MAPBOX_GEOCODING}/${encodeURIComponent(q.trim())}.json?access_token=${token}&language=ko&limit=5`
      const res = await fetch(url)
      const data: GeocodeResponse = await res.json()
      setSuggestions(data.features ?? [])
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setQuery(v)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (v.trim().length >= 2) {
        debounceRef.current = setTimeout(() => search(v), 300)
      } else {
        setSuggestions([])
      }
    },
    [search]
  )

  const handleSelect = useCallback(
    (feature: GeocodeFeature) => {
      const [lng, lat] = feature.center
      setPlacement({ latitude: lat, longitude: lng })
      setQuery(feature.place_name)
      setSuggestions([])
      if (mapRef?.getMap()) {
        const map = mapRef.getMap()
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 1000 })
      }
    },
    [setPlacement, mapRef]
  )

  return (
    <div className="absolute top-3 left-3 right-3 z-10 max-w-sm">
      <div className="relative">
        <Input
          type="search"
          placeholder="Search address (e.g. Seoul, Busan, Korean address)"
          value={query}
          onChange={handleChange}
          className="bg-background/95 shadow-md border"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            Searching…
          </span>
        )}
        {suggestions.length > 0 && (
          <ul className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-20">
            {suggestions.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => handleSelect(f)}
                >
                  {f.place_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
