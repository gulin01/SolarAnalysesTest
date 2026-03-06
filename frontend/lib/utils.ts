import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatKwh(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} MWh`
  return `${Math.round(value)} kWh`
}

export function formatArea(m2: number): string {
  return `${m2.toFixed(1)} m²`
}
