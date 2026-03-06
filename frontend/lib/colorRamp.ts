// RdYlBu diverging color ramp: blue (low) → yellow (mid) → red (high)
// Matches the architecture spec colors exactly.

const STOPS: [number, [number, number, number]][] = [
  [0.0,  [49,  54,  149]],  // #313695 deep blue
  [0.25, [69,  117, 180]],  // #4575B4
  [0.5,  [255, 255, 191]],  // #FFFFBF yellow
  [0.75, [244, 109,  67]],  // #F46D43
  [1.0,  [165,   0,  38]],  // #A50026 deep red
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueToRgb(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i]
    const [t1, c1] = STOPS[i + 1]
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0)
      return [
        Math.round(lerp(c0[0], c1[0], u)),
        Math.round(lerp(c0[1], c1[1], u)),
        Math.round(lerp(c0[2], c1[2], u)),
      ]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

export function valueToHex(t: number): string {
  const [r, g, b] = valueToRgb(t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function normalizeValues(values: number[]): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (range === 0) return values.map(() => 0.5)
  return values.map((v) => (v - min) / range)
}
