'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WeatherStation } from '@/lib/types'

interface StationPickerProps {
  stations: WeatherStation[]
  value: string
  onChange: (id: string) => void
}

export function StationPicker({ stations, value, onChange }: StationPickerProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select a weather station" />
      </SelectTrigger>
      <SelectContent>
        {stations.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <div>
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground ml-2 text-xs">
                {s.country} · {s.distance_km.toFixed(0)} km away
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
