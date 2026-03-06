import { create } from 'zustand'
import { Project } from '@/lib/types'

interface ProjectStore {
  currentProject: Project | null
  setProject: (p: Project | null) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProject: null,
  setProject: (p) => set({ currentProject: p }),
}))
