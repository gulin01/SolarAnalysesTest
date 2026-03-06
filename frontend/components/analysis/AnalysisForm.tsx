'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { WeatherStation } from '@/lib/types'
import { apiClient } from '@/lib/api'
import { useAnalysisStore } from '@/stores/analysisStore'
import { ProgressTracker } from './ProgressTracker'
import { toast } from 'sonner'
import { DEFAULT_GRID_RESOLUTION, DEFAULT_GROUND_REFLECTANCE, MIN_GRID_RESOLUTION, MAX_GRID_RESOLUTION } from '@/lib/constants'

type Mode = 'annual' | 'hourly'
type SurfaceFilter = 'all' | 'roofs' | 'walls'

interface AnalysisFormProps {
  projectId: string
  stations: WeatherStation[]
  placementLat: number
  placementLng: number
}

export function AnalysisForm({ projectId, stations, placementLat, placementLng }: AnalysisFormProps) {
  const router = useRouter()
  const { jobId, status, setJobId, setStatus } = useAnalysisStore()

  const [mode, setMode] = useState<Mode>('annual')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [stationId, setStationId] = useState(stations[0]?.id ?? '')
  const [gridRes, setGridRes] = useState(DEFAULT_GRID_RESOLUTION)
  const [reflectance, setReflectance] = useState(DEFAULT_GROUND_REFLECTANCE)
  const [analysisDate, setAnalysisDate] = useState('2024-06-21')
  const [analysisHour, setAnalysisHour] = useState(12)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Pre-select first (nearest) station when stations load
  useEffect(() => {
    if (stations.length > 0 && !stationId) setStationId(stations[0].id)
  }, [stations])

  // Navigate to results after job completes — must be in useEffect, never during render.
  useEffect(() => {
    if (status === 'completed') {
      router.push(`/projects/${projectId}/results`)
    }
  }, [status, projectId, router])

  const handleSubmit = async () => {
    if (!stationId) { toast.error('Please select a weather station'); return }

    setIsSubmitting(true)
    setStatus('queued')
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        epw_station_id: stationId,
        mode,
        grid_resolution: gridRes,
        ground_reflectance: reflectance,
        surface_filter: surfaceFilter,
      }
      if (mode === 'hourly') {
        body.analysis_date = analysisDate
        body.analysis_hour = analysisHour
      }

      const job = await apiClient.post<{ id: string }>('/analysis/run', body)
      setJobId(job.id)
      setStatus('running')
    } catch {
      toast.error('Failed to start analysis')
      setStatus('idle')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (jobId && (status === 'running' || status === 'queued')) {
    return <ProgressTracker projectId={projectId} jobId={jobId} />
  }

  const submitLabel = isSubmitting
    ? 'Starting...'
    : mode === 'annual'
      ? 'Run Annual Analysis (~2-5 min)'
      : `Analyze ${analysisDate} at ${String(analysisHour).padStart(2, '0')}:00 (~10 sec)`

  return (
    <div className="space-y-6">
      {/* Weather Station */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <Label>Weather station</Label>
          {stations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No nearby EPW stations found. Analysis may use synthetic weather data.
            </p>
          ) : (
            <Select value={stationId} onValueChange={setStationId}>
              <SelectTrigger>
                <SelectValue placeholder="Select nearest EPW station" />
              </SelectTrigger>
              <SelectContent>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}, {s.country} ({s.distance_km.toFixed(0)} km away)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Mode Selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode('annual')}
          className={`rounded-lg border-2 p-4 text-left transition-colors ${
            mode === 'annual' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
          }`}
        >
          <div className="font-semibold text-sm mb-1">📊 Annual Analysis</div>
          <div className="text-xs text-muted-foreground mb-3">
            Total solar radiation over a full year. Best for finding optimal panel spots.
          </div>
          <div className="text-xs font-medium text-muted-foreground">~2-5 min · kWh/m²</div>
        </button>

        <button
          type="button"
          onClick={() => setMode('hourly')}
          className={`rounded-lg border-2 p-4 text-left transition-colors ${
            mode === 'hourly' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
          }`}
        >
          <div className="font-semibold text-sm mb-1">☀️ Hourly Snapshot</div>
          <div className="text-xs text-muted-foreground mb-3">
            Solar exposure at a specific date &amp; hour. See shadow patterns in real time.
          </div>
          <div className="text-xs font-medium text-muted-foreground">~5-30 sec · W/m²</div>
        </button>
      </div>

      {/* Surface filter */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <Label>Analyze surfaces</Label>
          <div className="grid grid-cols-3 gap-2">
            {(['all', 'roofs', 'walls'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSurfaceFilter(f)}
                className={`rounded-md border py-2 text-sm capitalize transition-colors ${
                  surfaceFilter === f
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                {f === 'all' ? 'All surfaces' : f === 'roofs' ? 'Roofs only' : 'Walls only'}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {surfaceFilter === 'all'
              ? 'Simulates all exterior faces (roofs + walls).'
              : surfaceFilter === 'roofs'
                ? 'Simulates only upward-facing roof surfaces.'
                : 'Simulates only vertical wall/facade surfaces.'}
          </p>
        </CardContent>
      </Card>

      {/* Hourly controls */}
      {mode === 'hourly' && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <h3 className="font-medium text-sm">Date &amp; Hour</h3>

            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={analysisDate}
                onChange={(e) => setAnalysisDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Hour: {String(analysisHour).padStart(2, '0')}:00</Label>
              <Slider
                min={0}
                max={23}
                step={1}
                value={[analysisHour]}
                onValueChange={([v]) => setAnalysisHour(v)}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advanced settings */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <h3 className="font-medium text-sm">Advanced settings</h3>

          <div className="space-y-2">
            <Label>Grid resolution: {gridRes} m</Label>
            <Slider
              min={MIN_GRID_RESOLUTION}
              max={MAX_GRID_RESOLUTION}
              step={0.05}
              value={[gridRes]}
              onValueChange={([v]) => setGridRes(v)}
            />
            <p className="text-xs text-muted-foreground">Smaller = more accurate but slower</p>
          </div>

          <div className="space-y-2">
            <Label>Ground reflectance: {reflectance.toFixed(2)}</Label>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[reflectance]}
              onValueChange={([v]) => setReflectance(v)}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} className="w-full" size="lg" disabled={isSubmitting || status === 'queued'}>
        {submitLabel}
      </Button>
    </div>
  )
}
