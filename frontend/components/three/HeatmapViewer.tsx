'use client'

import { Suspense, useMemo, useRef, useCallback, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, Center, Bounds, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/lib/api'
import { useViewerStore, InspectionPoint } from '@/stores/viewerStore'
import { HeatmapCell } from '@/lib/types'
import { ColorLegend } from './ColorLegend'
import { ResultsDashboard } from '@/components/analysis/ResultsDashboard'

interface HeatmapViewerProps {
  projectId: string
  modelGlbUrl: string | null
  latestJobId: string | null
}

// ---------------------------------------------------------------------------
// Color ramp  (blue → cyan → green → yellow → red) — brightened for visibility
// ---------------------------------------------------------------------------
const COLOR_STOPS = [
  { t: 0.0,  r: 0.2,     g: 0.4,     b: 0.9 },   // bright blue
  { t: 0.25, r: 0.0,     g: 0.8,     b: 1.0 },   // cyan
  { t: 0.5,  r: 0.0,     g: 1.0,     b: 0.0 },   // lime green
  { t: 0.75, r: 1.0,     g: 1.0,     b: 0.0 },   // yellow
  { t: 1.0,  r: 1.0,     g: 0.2,     b: 0.0 },   // red-orange
]

function valueToColor(value: number, minV: number, maxV: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (value - minV) / (maxV - minV || 1)))
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1]
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t)
      return [a.r + (b.r - a.r) * u, a.g + (b.g - a.g) * u, a.b + (b.b - a.b) * u]
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]
  return [last.r, last.g, last.b]
}

// ---------------------------------------------------------------------------
// Build a Three.js mesh from heatmap_cells quads (each cell = 2 triangles)
// ---------------------------------------------------------------------------
function buildHeatmapMesh(cells: HeatmapCell[], minV: number, maxV: number): THREE.Mesh {
  const n = cells.length
  const positions = new Float32Array(n * 6 * 3)
  const colors    = new Float32Array(n * 6 * 3)
  const cellIndex = new Float32Array(n * 6)

  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    const c = cell.corners
    const [r, g, b] = valueToColor(cell.value, minV, maxV)
    // quad → 2 triangles: corners (0,1,2) and (0,2,3)
    const triVerts = [c[0], c[1], c[2], c[0], c[2], c[3]]
    for (let v = 0; v < 6; v++) {
      const vi = i * 6 + v
      const corner = triVerts[v]
      positions[vi * 3]     = corner[0]
      positions[vi * 3 + 1] = corner[1]
      positions[vi * 3 + 2] = corner[2]
      colors[vi * 3]     = r
      colors[vi * 3 + 1] = g
      colors[vi * 3 + 2] = b
      cellIndex[vi] = i
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('cellIdx',  new THREE.BufferAttribute(cellIndex, 1))
  geo.computeVertexNormals()

  // Use BasicMaterial for heatmap: vertex colors are always bright and don't depend on lighting
  // This ensures the heatmap colors are visible regardless of light angle or intensity
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,  // Disable tone mapping to keep colors vibrant
  })
  return new THREE.Mesh(geo, mat)
}

// ---------------------------------------------------------------------------
// Neutral building material — applied to every mesh in the loaded GLB
// ---------------------------------------------------------------------------
const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.72, 0.72, 0.75),
  roughness: 0.65,
  metalness: 0.05,
  side: THREE.DoubleSide,
})

function applyBuildingMaterial(scene: THREE.Object3D) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.material = BUILDING_MATERIAL
  })
}

// ---------------------------------------------------------------------------
// Click-to-inspect — raycasts onto the heatmap mesh, places inspection pins
// ---------------------------------------------------------------------------
function HeatmapInspector({
  heatmapMesh,
  cells,
  unit,
}: {
  heatmapMesh: THREE.Mesh
  cells: HeatmapCell[]
  unit: string
}) {
  const { camera, gl } = useThree()
  const { addInspectionPoint } = useViewerStore()
  const raycaster = useRef(new THREE.Raycaster())

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(mouse, camera)
      const hits = raycaster.current.intersectObject(heatmapMesh)
      if (hits.length > 0) {
        const hit = hits[0]
        const cellIdxAttr = heatmapMesh.geometry.getAttribute('cellIdx')
        const cellI = Math.round(cellIdxAttr.getX(hit.face!.a))
        const value = cells[cellI]?.value ?? 0
        addInspectionPoint({
          id: `inspect-${Date.now()}`,
          position: hit.point.clone(),
          value,
          unit,
        })
      }
    },
    [heatmapMesh, cells, unit, camera, gl, addInspectionPoint],
  )

  useEffect(() => {
    gl.domElement.addEventListener('click', handleClick)
    return () => gl.domElement.removeEventListener('click', handleClick)
  }, [gl, handleClick])

  return null
}

// ---------------------------------------------------------------------------
// Inspection point marker — sphere pin + floating HTML label
// ---------------------------------------------------------------------------
function InspectionMarker({ point }: { point: InspectionPoint }) {
  const { removeInspectionPoint } = useViewerStore()
  return (
    <group position={point.position}>
      <mesh onClick={() => removeInspectionPoint(point.id)}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Html distanceFactor={12} position={[0, 0.4, 0]}>
        <div
          className="bg-black/80 text-white px-2 py-1 rounded text-xs whitespace-nowrap cursor-pointer select-none"
          onClick={() => removeInspectionPoint(point.id)}
        >
          {point.value.toFixed(1)} {point.unit}
        </div>
      </Html>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Scene: building (always gray) + heatmap overlay (only in heatmap mode)
// ---------------------------------------------------------------------------
function ModelScene({ modelUrl, jobId }: { modelUrl: string; jobId: string }) {
  const { scene } = useGLTF(modelUrl)
  const { viewMode, inspectionPoints } = useViewerStore()
  const { data: results } = useQuery(queries.analysisResults(jobId))

  const buildingScene = useMemo(() => {
    const clone = scene.clone(true)
    applyBuildingMaterial(clone)
    return clone
  }, [scene])

  const { heatmapMesh, cells, minV, maxV } = useMemo(() => {
    if (!results || viewMode !== 'heatmap') {
      return { heatmapMesh: null, cells: [] as HeatmapCell[], minV: 0, maxV: 1 }
    }
    const cells = results.heatmap_cells ?? []
    if (cells.length === 0) {
      return { heatmapMesh: null, cells, minV: 0, maxV: 1 }
    }
    const nonZero = cells.map((c) => c.value).filter((v) => v > 0)
    const minV = nonZero.length ? Math.min(...nonZero) : 0
    const maxV = nonZero.length ? Math.max(...nonZero) : 1
    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[HeatmapViewer] Cells:', cells.length,
        '| Range:', minV.toFixed(1), '–', maxV.toFixed(1),
        '| Filter:', results.surface_filter ?? 'all',
      )
    }
    return { heatmapMesh: buildHeatmapMesh(cells, minV, maxV), cells, minV, maxV }
  }, [results, viewMode])

  const unit = results?.unit ?? 'kWh/m²'

  return (
    <>
      {/* Building — always neutral gray */}
      <primitive object={buildingScene} />

      {/* Heatmap overlay — separate quad mesh, only in heatmap mode */}
      {heatmapMesh && <primitive object={heatmapMesh} />}

      {/* Click-to-inspect, only when heatmap is active */}
      {viewMode === 'heatmap' && heatmapMesh && (
        <HeatmapInspector heatmapMesh={heatmapMesh} cells={cells} unit={unit} />
      )}

      {/* Inspection pin markers */}
      {inspectionPoints.map((p) => (
        <InspectionMarker key={p.id} point={p} />
      ))}
    </>
  )
}

function PlainModel({ modelUrl }: { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl)
  const plainScene = useMemo(() => {
    const clone = scene.clone(true)
    applyBuildingMaterial(clone)
    return clone
  }, [scene])
  return <primitive object={plainScene} />
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function HeatmapViewer({ projectId, modelGlbUrl, latestJobId }: HeatmapViewerProps) {
  const { viewMode, setViewMode, inspectionPoints, clearInspectionPoints } = useViewerStore()
  const { data: results } = useQuery({
    ...queries.analysisResults(latestJobId ?? ''),
    enabled: !!latestJobId,
  })

  if (!modelGlbUrl) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No model available. Please upload a model first.
      </div>
    )
  }

  const availableModes = results?.mode === 'hourly'
    ? (['model', 'heatmap'] as const)
    : (['model', 'heatmap', 'panels'] as const)

  return (
    <div className="h-full flex">
      <div className="flex-1 relative">
        <Canvas camera={{ position: [15, 15, 15], fov: 50 }}>
          {/* Bright lighting setup for heatmap visibility */}
          <ambientLight intensity={0.6} />
          <hemisphereLight args={['#e8f4f8', '#444450', 0.5]} />
          <directionalLight position={[20, 30, 20]} intensity={1.5} />
          <directionalLight position={[-15, 20, -10]} intensity={0.6} />
          <Suspense fallback={null}>
            <Bounds fit clip observe>
              <Center>
                {latestJobId
                  ? <ModelScene modelUrl={modelGlbUrl} jobId={latestJobId} />
                  : <PlainModel modelUrl={modelGlbUrl} />
                }
              </Center>
            </Bounds>
          </Suspense>
          <OrbitControls makeDefault />
          <gridHelper args={[20, 20]} strokeDasharray={[2, 2]} />
        </Canvas>

        {results && viewMode === 'heatmap' && (() => {
          // Use the same non-zero range used for coloring, not statistics.min/max
          // (statistics include zeros for non-selected faces, which skews the legend).
          const nonZeroVals = (results.heatmap_cells ?? []).map((c) => c.value).filter((v) => v > 0)
          const legendMin = nonZeroVals.length ? Math.min(...nonZeroVals) : results.statistics.min
          const legendMax = nonZeroVals.length ? Math.max(...nonZeroVals) : results.statistics.max
          return <ColorLegend min={legendMin} max={legendMax} unit={results.unit} />
        })()}

        {/* View mode toggle */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2 bg-background/90 rounded-full p-1 backdrop-blur shadow">
          {availableModes.map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded-full text-sm capitalize transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Inspection hint + clear button */}
        {viewMode === 'heatmap' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-background/90 rounded-full px-4 py-2 backdrop-blur shadow text-xs text-muted-foreground">
            <span>Click any surface to inspect its value</span>
            {inspectionPoints.length > 0 && (
              <button
                onClick={clearInspectionPoints}
                className="text-destructive hover:text-destructive/80 font-medium"
              >
                Clear {inspectionPoints.length} pin{inspectionPoints.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {results && (
        <div className="w-72 border-l overflow-y-auto">
          <ResultsDashboard results={results} projectId={projectId} jobId={latestJobId!} />
        </div>
      )}
    </div>
  )
}
