'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queries } from '@/lib/api'
import { useAnalysisStore } from '@/stores/analysisStore'

export function useAnalysisPolling(jobId: string | null) {
  const { setStatus, setProgress, setResults } = useAnalysisStore()

  const statusQuery = useQuery({
    ...queries.analysisStatus(jobId ?? ''),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 3000
    },
  })

  const resultsQuery = useQuery({
    ...queries.analysisResults(jobId ?? ''),
    enabled: statusQuery.data?.status === 'completed',
  })

  useEffect(() => {
    if (statusQuery.data) {
      setStatus(statusQuery.data.status)
      setProgress(statusQuery.data.progress, statusQuery.data.progress_message)
    }
  }, [statusQuery.data, setStatus, setProgress])

  useEffect(() => {
    if (resultsQuery.data) setResults(resultsQuery.data)
  }, [resultsQuery.data, setResults])

  return { statusQuery, resultsQuery }
}
