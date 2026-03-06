'use client'

import { useEffect } from 'react'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useAnalysisPolling } from '@/hooks/useAnalysisPolling'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

const BASE_WS = process.env.NEXT_PUBLIC_FASTAPI_URL?.replace(/^http/, 'ws') ?? 'ws://localhost:8000'

const STEP_LABELS = [
  'Preparing geometry',
  'Loading weather data',
  'Running simulation',
  'Processing results',
]

interface ProgressTrackerProps {
  projectId: string
  jobId: string
}

export function ProgressTracker({ projectId, jobId }: ProgressTrackerProps) {
  const { status, progress, progressMessage, setStatus, setProgress } = useAnalysisStore()

  // WebSocket for real-time updates
  useWebSocket(`${BASE_WS}/ws/analysis/${jobId}`, {
    enabled: status === 'running' || status === 'queued',
    onMessage: (msg) => {
      if (msg.status) setStatus(msg.status as any)
      if (typeof msg.progress === 'number') setProgress(msg.progress, msg.message as string ?? '')
    },
  })

  // Polling fallback
  useAnalysisPolling(jobId)

  return (
    <div className="space-y-6">
      <div className="text-center">
        {status === 'completed' ? (
          <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
        ) : status === 'failed' ? (
          <XCircle className="h-12 w-12 mx-auto text-destructive mb-3" />
        ) : (
          <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-3" />
        )}
        <p className="font-medium capitalize">{status === 'running' ? 'Analysis in progress' : status}</p>
        {progressMessage && <p className="text-sm text-muted-foreground mt-1">{progressMessage}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="space-y-2">
        {STEP_LABELS.map((label, i) => {
          const stepProgress = (i + 1) * 25
          const done = progress >= stepProgress
          const active = progress >= i * 25 && progress < stepProgress
          return (
            <div key={i} className={`flex items-center gap-2 text-sm ${done ? 'text-green-600' : active ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              <div className={`h-2 w-2 rounded-full ${done ? 'bg-green-500' : active ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`} />
              {label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
