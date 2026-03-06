import { create } from 'zustand'
import { Placement } from '@/lib/types'

interface PlacementStore extends Placement {
  setPlacement: (partial: Partial<Placement>) => void
  reset: () => void
}

const DEFAULT: Placement = {
  latitude: 51.5,
  longitude: 0,
  rotation_deg: 0,
  scale: 1,
  elevation_m: 0,
}

export const usePlacementStore = create<PlacementStore>((set) => ({
  ...DEFAULT,
  setPlacement: (partial) => set((s) => ({ ...s, ...partial })),
  reset: () => set(DEFAULT),
}))
