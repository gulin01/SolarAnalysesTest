import { create } from 'zustand'
import * as THREE from 'three'
import { PanelZone } from '@/lib/types'

type ViewMode = 'model' | 'heatmap' | 'panels'

export interface InspectionPoint {
  id: string
  position: THREE.Vector3
  value: number
  unit: string
}

interface ViewerStore {
  viewMode: ViewMode
  threshold: number
  hoveredFace: number | null
  selectedZone: PanelZone | null
  inspectionPoints: InspectionPoint[]
  setViewMode: (m: ViewMode) => void
  setThreshold: (t: number) => void
  setHoveredFace: (f: number | null) => void
  setSelectedZone: (z: PanelZone | null) => void
  addInspectionPoint: (p: InspectionPoint) => void
  removeInspectionPoint: (id: string) => void
  clearInspectionPoints: () => void
}

export const useViewerStore = create<ViewerStore>((set) => ({
  viewMode: 'model',
  threshold: 800,
  hoveredFace: null,
  selectedZone: null,
  inspectionPoints: [],
  setViewMode: (viewMode) => set({ viewMode }),
  setThreshold: (threshold) => set({ threshold }),
  setHoveredFace: (hoveredFace) => set({ hoveredFace }),
  setSelectedZone: (selectedZone) => set({ selectedZone }),
  addInspectionPoint: (p) => set((s) => ({ inspectionPoints: [...s.inspectionPoints, p] })),
  removeInspectionPoint: (id) => set((s) => ({ inspectionPoints: s.inspectionPoints.filter((p) => p.id !== id) })),
  clearInspectionPoints: () => set({ inspectionPoints: [] }),
}))
