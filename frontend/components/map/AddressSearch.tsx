'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { usePlacementStore } from '@/stores/placementStore'
import { toast } from 'sonner'

export function AddressSearch() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const { setPlacement } = usePlacementStore()
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

  const search = async () => {
    if (!query.trim() || !token) return
    setLoading(true)
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&limit=1`
      )
      const data = await res.json()
      const [lng, lat] = data.features?.[0]?.center ?? []
      if (lat && lng) {
        setPlacement({ latitude: lat, longitude: lng })
      } else {
        toast.error('Location not found')
      }
    } catch {
      toast.error('Geocoding failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Search address..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && search()}
      />
      <Button variant="outline" size="icon" onClick={search} disabled={loading}>
        <Search className="h-4 w-4" />
      </Button>
    </div>
  )
}
