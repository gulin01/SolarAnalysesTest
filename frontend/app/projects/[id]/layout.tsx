import { fetchProject } from '@/lib/api'
import { StepIndicator } from '@/components/layout/StepIndicator'
import { Sidebar } from '@/components/layout/Sidebar'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  let project = null
  try {
    project = await fetchProject(params.id)
  } catch {
    // project not found or auth error — children will handle
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar project={project} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {project && <StepIndicator currentStep={project.current_step} projectId={params.id} />}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}