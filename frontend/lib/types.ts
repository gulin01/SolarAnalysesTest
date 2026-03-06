export interface User {
  id: string
  name: string
  email: string
}

export interface Placement {
  latitude: number
  longitude: number
  rotation_deg: number
  scale: number
  elevation_m: number
}

export interface ModelMeta {
  id: string
  original_filename: string
  original_format: 'glb' | 'gltf' | 'obj' | 'stl' | 'ifc'
  normalized_glb_url: string
  face_count: number
  vertex_count: number
  surface_area_m2: number
  bounding_box: { min: [number, number, number]; max: [number, number, number] }
  ifc_metadata: Record<string, unknown> | null
}

export type ProjectStep = 'upload' | 'place' | 'analyze' | 'results'

export interface Project {
  id: string
  name: string
  created_at: string
  updated_at: string
  model_id: string | null
  model?: ModelMeta
  placement: Placement | null
  current_step: ProjectStep
  latest_job_id: string | null
}

export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface AnalysisJob {
  id: string
  project_id: string
  status: AnalysisStatus
  progress: number
  progress_message: string
  config: AnalysisConfig
  started_at: string
  completed_at: string | null
  error_message: string | null
}

export interface AnalysisConfig {
  project_id?: string
  epw_station_id: string
  grid_resolution: number
  ground_reflectance: number
  mode: 'annual' | 'hourly'
  analysis_date?: string   // ISO date, only for hourly
  analysis_hour?: number   // 0-23, only for hourly
  surface_filter?: 'all' | 'roofs' | 'walls'
  selected_face_ids?: number[]
}

export interface GridPoint {
  x: number
  y: number
  z: number
}

export interface SensorPoint {
  position: [number, number, number]
  normal: [number, number, number]
  value: number
}

export interface HeatmapCell {
  position: [number, number, number]
  normal: [number, number, number]
  value: number
  face_id: number
  corners: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
}

export interface PanelZone {
  id: number
  face_indices: number[]
  centroid: [number, number, number]
  avg_irradiance: number
  area_m2: number
  tilt_deg: number
  azimuth_deg: number
  estimated_annual_yield_kwh: number
  panel_count_estimate: number
}

export interface SunPosition {
  altitude_deg: number
  azimuth_deg: number
  is_above_horizon: boolean
}

export interface WeatherAtHour {
  temperature_c: number
  dni: number
  dhi: number
  wind_speed: number
}

export interface AnalysisResult {
  job_id: string
  mode?: 'annual' | 'hourly'
  grid_points: [number, number, number][]
  irradiance_values: number[]
  heatmap_cells: HeatmapCell[]
  sensor_points: SensorPoint[]
  statistics: {
    min: number
    max: number
    avg: number
    total: number
  }
  panel_zones: PanelZone[]
  unit: string
  surface_filter?: 'all' | 'roofs' | 'walls'
  sun_position?: SunPosition
  weather_at_hour?: WeatherAtHour
  analysis_date?: string
  analysis_hour?: number
}

export interface WeatherStation {
  id: string
  name: string
  country: string
  latitude: number
  longitude: number
  distance_km: number
}
