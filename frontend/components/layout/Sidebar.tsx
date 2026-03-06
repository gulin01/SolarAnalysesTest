import Link from 'next/link'
import { Sun, FolderOpen, Plus, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Project } from '@/lib/types'

interface SidebarProps {
  project: Project | null
}

export function Sidebar({ project }: SidebarProps) {
  return (
    <aside className="w-56 border-r flex flex-col bg-background shrink-0">
      <div className="px-4 py-4 border-b flex items-center gap-2">
        <Sun className="h-5 w-5 text-yellow-500" />
        <Link href="/projects" className="font-bold text-sm">SolarSight</Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        <Link href="/projects" className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <FolderOpen className="h-4 w-4" />
          All projects
        </Link>
        <Link href="/projects/new" className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <Plus className="h-4 w-4" />
          New project
        </Link>
      </nav>

      {project && (
        <div className="px-4 py-3 border-t border-b">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Current project</p>
          <p className="text-sm font-medium truncate">{project.name}</p>
        </div>
      )}

      <div className="p-3">
        <form action="/api/auth/signout" method="POST">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  )
}
