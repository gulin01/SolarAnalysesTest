import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sun, Upload, Map, BarChart3, ArrowRight } from 'lucide-react'

export default function LandingPage() {
  const steps = [
    { icon: Upload, title: 'Upload Model', description: 'Import your 3D building in GLB, OBJ, STL, or IFC format.' },
    { icon: Map, title: 'Place on Map', description: 'Position and orient your model precisely on real-world satellite imagery.' },
    { icon: Sun, title: 'Run Analysis', description: 'Ladybug Tools + Radiance compute annual solar irradiance across every surface.' },
    { icon: BarChart3, title: 'View Results', description: 'Interactive heatmap with panel placement suggestions and yield estimates.' },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sun className="h-6 w-6 text-yellow-500" />
          <span className="font-bold text-xl">SolarSight</span>
        </div>
        <div className="flex gap-3">
          <Link href="/login">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link href="/register">
            <Button>Get started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="py-24 px-6 text-center max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold tracking-tight mb-6">
            Solar analysis for any building, anywhere
          </h1>
          <p className="text-xl text-muted-foreground mb-10">
            Upload your 3D model, place it on the map, and get precise irradiance heatmaps
            powered by industry-standard Ladybug Tools and Radiance.
          </p>
          <Link href="/projects">
            <Button size="lg" className="gap-2">
              Start a project <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </section>

        <section className="py-16 px-6 bg-muted/40">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step, i) => (
                <Card key={i}>
                  <CardHeader>
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                      <step.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{step.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{step.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-4 text-center text-sm text-muted-foreground">
        SolarSight — Solar Panel Analysis Platform
      </footer>
    </div>
  )
}