import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Sun, ArrowRight } from 'lucide-react'
import { fetchProjects } from '@/lib/api'
import { Project } from '@/lib/types'
import { formatDistanceToNow } from 'date-fns'

export const dynamic = 'force-dynamic'

const stepLabels: Record<string, string> = {
  upload: 'Upload',
  place: 'Placement',
  analyze: 'Analysis',
  results: 'Results',
}

async function ProjectsPage() {
  let projects: Project[] = []
  try {
    projects = await fetchProjects()
  } catch {
    // unauthenticated or backend unavailable — show empty state
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-yellow-500" />
          <span className="font-semibold">SolarSight</span>
        </div>
        <Link href="/projects/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> New project
          </Button>
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-8">Your projects</h1>

        {projects.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <Sun className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-4">No projects yet</p>
            <Link href="/projects/new">
              <Button>Create your first project</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card key={project.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  <CardDescription>
                    Step: <span className="font-medium text-foreground">{stepLabels[project.current_step]}</span>
                  </CardDescription>
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
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default ProjectsPage