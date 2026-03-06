import { create } from 'zustand'
import { ModelMeta } from '@/lib/types'

interface ModelStore {
  modelUrl: string | null
  metadata: ModelMeta | null
  uploadProgress: number
  setModelUrl: (url: string | null) => void
  setMetadata: (m: ModelMeta | null) => void
  setUploadProgress: (p: number) => void
}

export const useModelStore = create<ModelStore>((set) => ({
  modelUrl: null,
  metadata: null,
  uploadProgress: 0,
  setModelUrl: (url) => set({ modelUrl: url }),
  setMetadata: (m) => set({ metadata: m }),
  setUploadProgress: (uploadProgress) => set({ uploadProgress }),
}))
