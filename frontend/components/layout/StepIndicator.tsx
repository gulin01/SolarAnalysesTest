import Link from 'next/link'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProjectStep } from '@/lib/types'

const STEPS: { key: ProjectStep; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'place', label: 'Placement' },
  { key: 'analyze', label: 'Analysis' },
  { key: 'results', label: 'Results' },
]

const ORDER: ProjectStep[] = ['upload', 'place', 'analyze', 'results']

interface StepIndicatorProps {
  currentStep: ProjectStep
  projectId: string
}

export function StepIndicator({ currentStep, projectId }: StepIndicatorProps) {
  const currentIndex = ORDER.indexOf(currentStep)

  return (
    <div className="border-b px-6 py-2 flex items-center gap-1">
      {STEPS.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={step.key} className="flex items-center">
            <Link
              href={`/projects/${projectId}/${step.key}`}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-sm transition-colors',
                active && 'bg-primary text-primary-foreground font-medium',
                done && 'text-muted-foreground hover:text-foreground',
                !active && !done && 'text-muted-foreground/50 pointer-events-none'
              )}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : (
                <span className={cn('h-4 w-4 rounded-full border flex items-center justify-center text-xs',
                  active ? 'border-primary-foreground text-primary-foreground' : 'border-current'
                )}>
                  {i + 1}
                </span>
              )}
              {step.label}
            </Link>
            {i < STEPS.length - 1 && (
              <span className="text-muted-foreground/40 mx-1">›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
