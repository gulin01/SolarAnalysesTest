import { Project, ModelMeta, AnalysisJob, AnalysisResult, PanelZone, WeatherStation } from './types'

const BASE = process.env.NEXT_PUBLIC_FASTAPI_URL ?? 'http://localhost:8000'
const INTERNAL = process.env.FASTAPI_INTERNAL_URL ?? BASE

function serverBase() {
  // On server (no window), use internal Docker network URL
  if (typeof window === 'undefined') return INTERNAL
  return BASE
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverBase()}${path}`, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// Server-side helpers (used in Server Components)
export async function fetchProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects')
}

export async function fetchProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${id}`)
}

export interface StationsResponse {
  stations: WeatherStation[]
  location: { latitude: number; longitude: number }
}

export async function fetchNearbyStations(lat: number, lng: number): Promise<WeatherStation[]> {
  const res = await request<StationsResponse>(`/api/weather/stations?lat=${lat}&lng=${lng}&limit=5`)
  return res.stations
}

export async function fetchProjectAnalysisHistory(projectId: string): Promise<AnalysisJob[]> {
  return request<AnalysisJob[]>(`/api/analysis?project_id=${projectId}`)
}

// Client-side API client (used in Client Components via TanStack Query)
export const apiClient = {
  get: <T>(path: string) => request<T>(`/api${path}`),

  post: <T>(path: string, body?: unknown) =>
    request<T>(`/api${path}`, { method: 'POST', body: JSON.stringify(body) }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(`/api${path}`, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(`/api${path}`, { method: 'DELETE' }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${serverBase()}/api${path}`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type — let browser set multipart boundary
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Upload ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  },
}

// Typed query helpers used by TanStack Query hooks
export const queries = {
  project: (id: string) => ({
    queryKey: ['project', id],
    queryFn: () => apiClient.get<Project>(`/projects/${id}`),
  }),

  analysisStatus: (jobId: string) => ({
    queryKey: ['analysis', jobId, 'status'],
    queryFn: () => apiClient.get<AnalysisJob>(`/analysis/${jobId}/status`),
  }),

  analysisResults: (jobId: string) => ({
    queryKey: ['analysis', jobId, 'results'],
    queryFn: () => apiClient.get<AnalysisResult>(`/analysis/${jobId}/results`),
  }),

  panelZones: (jobId: string, params?: string) => ({
    queryKey: ['analysis', jobId, 'panels', params],
    queryFn: () => apiClient.get<PanelZone[]>(`/analysis/${jobId}/panels${params ? `?${params}` : ''}`),
  }),

  weatherStations: (lat: number, lng: number) => ({
    queryKey: ['weather', 'stations', lat, lng],
    queryFn: async () => {
      const res = await apiClient.get<StationsResponse>(`/weather/stations?lat=${lat}&lng=${lng}&limit=5`)
      return res.stations
    },
  }),
}
