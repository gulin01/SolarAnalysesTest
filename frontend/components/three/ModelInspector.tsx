'use client'

import { useModelStore } from '@/stores/modelStore'
import { formatArea } from '@/lib/utils'
import { FormatBadge } from '@/components/upload/FormatBadge'

export function ModelInspector() {
  const { metadata } = useModelStore()
  if (!metadata) return null

  return (
    <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium truncate">{metadata.original_filename}</span>
        <FormatBadge format={metadata.original_format} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <span>Faces</span>
        <span className="text-foreground">{metadata.face_count.toLocaleString()}</span>
        <span>Vertices</span>
        <span className="text-foreground">{metadata.vertex_count.toLocaleString()}</span>
        <span>Surface area</span>
        <span className="text-foreground">{formatArea(metadata.surface_area_m2)}</span>
      </div>
    </div>
  )
}
