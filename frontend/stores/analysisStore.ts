import { create } from 'zustand'
import { AnalysisResult, AnalysisStatus } from '@/lib/types'

interface AnalysisStore {
  jobId: string | null
  status: AnalysisStatus | 'idle'
  progress: number
  progressMessage: string
  results: AnalysisResult | null
  setJobId: (id: string | null) => void
  setStatus: (s: AnalysisStatus | 'idle') => void
  setProgress: (n: number, msg?: string) => void
  setResults: (r: AnalysisResult | null) => void
  reset: () => void
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  jobId: null,
  status: 'idle',
  progress: 0,
  progressMessage: '',
  results: null,
  setJobId: (jobId) => set({ jobId }),
  setStatus: (status) => set({ status }),
  setProgress: (progress, progressMessage = '') => set({ progress, progressMessage }),
  setResults: (results) => set({ results }),
  reset: () => set({ jobId: null, status: 'idle', progress: 0, progressMessage: '', results: null }),
}))
