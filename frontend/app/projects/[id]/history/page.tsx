import { fetchProjectAnalysisHistory } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default',
  running: 'secondary',
  queued: 'outline',
  failed: 'destructive',
}

export default async function HistoryPage({ params }: { params: { id: string } }) {
  let jobs: any[] = []
  try {
    jobs = await fetchProjectAnalysisHistory(params.id)
  } catch {
    // no history or auth issue
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Analysis History</h1>
        <Link href={`/projects/${params.id}/analyze`}>
          <Button>Run new analysis</Button>
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">No analyses run yet for this project.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job: any) => (
            <Card key={job.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    {job.config?.epw_station_id ?? 'Unknown station'}
                  </CardTitle>
                  <Badge variant={statusVariant[job.status] ?? 'outline'}>{job.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Started {formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}</p>
                <p>Grid: {job.config?.grid_resolution ?? '?'}m resolution &bull; {job.config?.period ?? 'annual'}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}