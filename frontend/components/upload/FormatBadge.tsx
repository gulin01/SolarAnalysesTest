import { cn } from '@/lib/utils'

const FORMAT_COLORS: Record<string, string> = {
  glb: 'bg-blue-100 text-blue-800',
  gltf: 'bg-blue-100 text-blue-800',
  obj: 'bg-green-100 text-green-800',
  stl: 'bg-purple-100 text-purple-800',
  ifc: 'bg-orange-100 text-orange-800',
}

interface FormatBadgeProps {
  format: string
  className?: string
}

export function FormatBadge({ format, className }: FormatBadgeProps) {
  const f = format.toLowerCase().replace('.', '')
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase',
      FORMAT_COLORS[f] ?? 'bg-muted text-muted-foreground',
      className
    )}>
      {f}
    </span>
  )
}
