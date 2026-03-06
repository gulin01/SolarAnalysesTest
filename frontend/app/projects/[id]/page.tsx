import { redirect } from 'next/navigation'
import { fetchProject } from '@/lib/api'

export default async function ProjectOverviewPage({ params }: { params: { id: string } }) {
  const project = await fetchProject(params.id)
  redirect(`/projects/${params.id}/${project.current_step}`)
}