'use client'

import { AnalysisResult } from '@/lib/types'
import { formatKwh, formatArea } from '@/lib/utils'
import { useViewerStore } from '@/stores/viewerStore'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Download, FileText } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { toast } from 'sonner'

interface ResultsDashboardProps {
  results: AnalysisResult
  projectId: string
  jobId: string
}

export function ResultsDashboard({ results, projectId, jobId }: ResultsDashboardProps) {
  const { threshold, setThreshold } = useViewerStore()
  const { statistics, panel_zones, mode, unit, sun_position, weather_at_hour, analysis_date, analysis_hour } = results
  const isHourly = mode === 'hourly'
  // For hourly (W/m²), threshold in store may be from annual (kWh/m²); cap to stats.max so slider makes sense
  const effectiveThreshold = unit === 'W/m²' && threshold > statistics.max ? statistics.max : threshold

  const visibleZones = panel_zones.filter((z) => z.avg_irradiance >= effectiveThreshold)
  const totalYield = visibleZones.reduce((sum, z) => sum + z.estimated_annual_yield_kwh, 0)
  const totalArea = visibleZones.reduce((sum, z) => sum + z.area_m2, 0)
  const totalPanels = visibleZones.reduce((sum, z) => sum + z.panel_count_estimate, 0)

  const handleExportCSV = async () => {
    try {
      const csvRows = [
        ['x', 'y', 'z', 'irradiance_kwh_m2'].join(','),
        ...results.grid_points.map((pt, i) =>
          [...pt, results.irradiance_values[i]].join(',')
        ),
      ]
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `solarsight_results_${jobId}.csv`
      a.click()
    } catch {
      toast.error('CSV export failed')
    }
  }

  const handleGenerateReport = async () => {
    try {
      const report = await apiClient.post<{ id: string }>('/reports/generate', {
        analysis_job_id: jobId,
      })
      window.open(`${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/reports/${report.id}/download`)
    } catch {
      toast.error('Report generation failed')
    }
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h2 className="font-semibold mb-3">Irradiance Statistics</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <StatCard label="Max" value={`${Math.round(statistics.max)} ${unit}`} />
          <StatCard label="Avg" value={`${Math.round(statistics.avg)} ${unit}`} />
          <StatCard label="Min" value={`${Math.round(statistics.min)} ${unit}`} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Min irradiance threshold: {effectiveThreshold} {unit}</Label>
        <Slider
          min={0}
          max={Math.max(Math.round(statistics.max), 1)}
          step={unit === 'W/m²' ? 5 : 10}
          value={[Math.min(effectiveThreshold, Math.round(statistics.max))]}
          onValueChange={([v]) => setThreshold(v)}
        />
      </div>

      {isHourly && sun_position && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1">
          <h3 className="font-medium text-sm">Sun position</h3>
          <p className="text-xs text-muted-foreground">
            Altitude {Math.round(sun_position.altitude_deg)}°, Azimuth {Math.round(sun_position.azimuth_deg)}°
            {sun_position.is_above_horizon ? ' (above horizon)' : ' (below horizon)'}
          </p>
        </div>
      )}

      {isHourly && weather_at_hour && analysis_date != null && analysis_hour != null && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1">
          <h3 className="font-medium text-sm">Weather at {analysis_date} {String(analysis_hour).padStart(2, '0')}:00</h3>
          <p className="text-xs text-muted-foreground">
            {weather_at_hour.temperature_c.toFixed(0)}°C · DNI {Math.round(weather_at_hour.dni)} W/m² · DHI {Math.round(weather_at_hour.dhi)} W/m² · Wind {weather_at_hour.wind_speed.toFixed(1)} m/s
          </p>
        </div>
      )}

      {!isHourly && (
        <div>
          <h2 className="font-semibold mb-3">Panel Zones ({visibleZones.length})</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatCard label="Est. yield" value={formatKwh(totalYield) + '/yr'} highlight />
            <StatCard label="Total area" value={formatArea(totalArea)} />
            <StatCard label="Panels" value={`~${totalPanels}`} />
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t">
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleExportCSV}>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
        {!isHourly && (
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleGenerateReport}>
            <FileText className="h-3.5 w-3.5" />
            Generate PDF report
          </Button>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${highlight ? 'bg-primary/10 col-span-2' : 'bg-muted/50'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-semibold text-sm ${highlight ? 'text-primary' : ''}`}>{value}</p>
    </div>
  )
}
