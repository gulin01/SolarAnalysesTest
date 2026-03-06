'use client'

import { valueToHex } from '@/lib/colorRamp'

interface ColorLegendProps {
  min: number
  max: number
  unit: string
}

const TICKS = 5

export function ColorLegend({ min, max, unit }: ColorLegendProps) {
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const t = i / (TICKS - 1)
    return { t, value: min + t * (max - min), color: valueToHex(t) }
  }).reverse()

  return (
    <div className="absolute bottom-8 right-4 bg-background/90 rounded-lg p-3 shadow backdrop-blur text-xs">
      <p className="font-medium mb-2 text-center">{unit}</p>
      <div className="flex gap-2">
        <div
          className="w-4 h-32 rounded"
          style={{
            background: `linear-gradient(to bottom, ${ticks.map((t) => t.color).join(', ')})`,
          }}
        />
        <div className="flex flex-col justify-between">
          {ticks.map(({ value }) => (
            <span key={value} className="text-muted-foreground">{Math.round(value)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
