'use client'

import { useMemo } from 'react'
import { valueToRgb, normalizeValues } from '@/lib/colorRamp'

export function useColorRamp(values: number[]) {
  return useMemo(() => {
    const normalized = normalizeValues(values)
    const colors = new Float32Array(normalized.length * 3)
    for (let i = 0; i < normalized.length; i++) {
      const [r, g, b] = valueToRgb(normalized[i])
      colors[i * 3]     = r / 255
      colors[i * 3 + 1] = g / 255
      colors[i * 3 + 2] = b / 255
    }
    return colors
  }, [values])
}
