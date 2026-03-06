'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Project } from '@/lib/types'
import { apiClient } from '@/lib/api'
import { toast } from 'sonner'

const stepLabels: Record<string, string> = {
  upload: 'Upload',
  place: 'Placement',
  analyze: 'Analysis',
  results: 'Results',
}

export function ProjectCard({ project }: { project: Project }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    setConfirming(false)
    try {
      await apiClient.delete(`/projects/${project.id}`)
      toast.success('Project deleted')
      router.refresh()
    } catch {
      toast.error('Failed to delete project')
      setDeleting(false)
    }
  }

  return (
    <Card className="hover:shadow-md transition-shadow relative">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-lg truncate">{project.name}</CardTitle>
            <CardDescription>
              Step: <span className="font-medium text-foreground">{stepLabels[project.current_step]}</span>
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Updated {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
        </p>
      </CardContent>
      <CardFooter>
        <Link href={`/projects/${project.id}/${project.current_step}`} className="w-full">
          <Button variant="outline" className="w-full gap-2">
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardFooter>

      {/* Confirm overlay */}
      {confirming && (
        <div className="absolute inset-0 bg-background/95 rounded-lg flex flex-col items-center justify-center gap-3 p-6 text-center z-10">
          <p className="font-medium text-sm">Delete <strong>{project.name}</strong>?</p>
          <p className="text-xs text-muted-foreground">
            All data — model, jobs, results — will be permanently removed.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
