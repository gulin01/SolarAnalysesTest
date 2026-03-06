'use client'

import { useRouter, usePathname } from 'next/navigation'
import { usePlacementStore } from '@/stores/placementStore'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'

export function PlacementControls() {
  const { latitude, longitude, rotation_deg, scale, elevation_m, setPlacement } = usePlacementStore()
  const router = useRouter()
  const pathname = usePathname()
  // pathname is like /projects/[id]/place — derive the analyze URL
  const analyzeUrl = pathname.replace('/place', '/analyze')

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-sm">Placement Controls</h2>

      <div className="space-y-1">
        <Label>Latitude</Label>
        <Input
          type="number"
          step="0.000001"
          value={latitude}
          onChange={(e) => setPlacement({ latitude: parseFloat(e.target.value) })}
        />
      </div>

      <div className="space-y-1">
        <Label>Longitude</Label>
        <Input
          type="number"
          step="0.000001"
          value={longitude}
          onChange={(e) => setPlacement({ longitude: parseFloat(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <Label>Rotation: {Math.round(rotation_deg)}°</Label>
        <Slider
          min={0}
          max={360}
          step={1}
          value={[rotation_deg]}
          onValueChange={([v]) => setPlacement({ rotation_deg: v })}
        />
      </div>

      <div className="space-y-2">
        <Label>Scale: {scale.toFixed(2)}×</Label>
        <Slider
          min={0.1}
          max={10}
          step={0.05}
          value={[scale]}
          onValueChange={([v]) => setPlacement({ scale: v })}
        />
      </div>

      <div className="space-y-1">
        <Label>Elevation offset (m)</Label>
        <Input
          type="number"
          step="0.1"
          value={elevation_m}
          onChange={(e) => setPlacement({ elevation_m: parseFloat(e.target.value) })}
        />
      </div>

      <Button
        className="w-full mt-4"
        disabled={!latitude || !longitude}
        onClick={() => router.push(analyzeUrl)}
      >
        Proceed to Analysis →
      </Button>
    </div>
  )
}
