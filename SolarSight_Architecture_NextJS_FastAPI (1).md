# SolarSight — Solar Panel Analysis Platform
## Full Architecture Plan (Next.js + FastAPI)

---

## 1. Product Vision

A web application that lets users upload a 3D building/site model, place it on a real-world map, run accurate solar irradiance analysis using Ladybug Tools + Radiance, and visualize results as a heatmap — identifying optimal locations for solar panel placement.

**Comparable to:** Autodesk Forma's solar analysis, but purpose-built for solar panel siting.

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRONTEND — Next.js 14 (App Router)                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Pages (Server Components by default)                        │    │
│  │                                                              │    │
│  │  /                    → Landing / Dashboard                  │    │
│  │  /projects            → Project list (SSR)                   │    │
│  │  /projects/[id]       → Project workspace (client-heavy)     │    │
│  │  /projects/[id]/upload    → Upload step                      │    │
│  │  /projects/[id]/place     → Map placement step               │    │
│  │  /projects/[id]/analyze   → Analysis config + run            │    │
│  │  /projects/[id]/results   → Heatmap + panel suggestions      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────────┐     │
│  │  "use client"     │  │  "use client" │  │  "use client"     │     │
│  │  ThreeViewer      │  │  MapPlacer    │  │  HeatmapViewer    │     │
│  │  (Three.js)       │  │  (Mapbox GL)  │  │  (Three.js)       │     │
│  └──────────────────┘  └──────────────┘  └───────────────────┘     │
│           │                    │                    ▲                 │
│           │              deck.gl bridge             │                 │
│           └────────────────────┼────────────────────┘                │
│                                │                                     │
│  Next.js API Routes (/api/*)   │   (lightweight proxy / auth only)   │
└────────────────────────────────┼─────────────────────────────────────┘
                                 │
                    HTTPS calls to FastAPI
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND — FastAPI (Python)                        │
│                                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────────┐     │
│  │  Model    │  │  Geo       │  │  Solar Analysis Engine        │     │
│  │  Parser   │  │  Service   │  │  (Ladybug + Radiance)         │     │
│  └──────────┘  └───────────┘  └──────────────────────────────┘     │
│       │                              │                               │
│       ▼                              ▼                               │
│  ┌──────────┐               ┌──────────────────┐                    │
│  │  File     │               │  Celery Worker    │                    │
│  │  Storage  │               │  (async analysis) │                    │
│  └──────────┘               └──────────────────┘                    │
│                                      │                               │
│                              ┌───────▼────────┐                      │
│                              │  Redis           │                      │
│                              │  (broker+cache)  │                      │
│                              └────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Split Works

Next.js handles everything the user sees — routing, SSR for SEO and fast initial loads, image optimization, and the client-side 3D/map components. FastAPI handles everything computational — file processing, solar simulation, and heavy async tasks. They communicate over a clean REST API boundary. Next.js API routes are used **only** as a thin proxy layer for auth token injection or CORS simplification — no business logic lives there.

---

## 3. Next.js Architecture Decisions

### 3.1 — App Router + Server/Client Component Strategy

The key architectural insight: **most of this app is interactive 3D/map UI**, which means the heavy pages will be client components. But we still benefit from Next.js for the surrounding structure.

```
Server Components (default — no "use client"):
├── Layout shells (sidebar, nav, project list)
├── Project metadata display
├── Dashboard / landing page
├── Analysis history table
├── SEO-relevant pages
└── Data fetching wrappers (fetch from FastAPI at build/request time)

Client Components ("use client"):
├── ThreeViewer         — Three.js canvas (model preview)
├── MapPlacer           — Mapbox GL JS (geo-placement)
├── HeatmapViewer       — Three.js canvas (results visualization)
├── AnalysisControls    — Interactive form (config + run)
├── UploadDropzone      — Drag-and-drop file upload
├── ProgressTracker     — WebSocket-connected progress bar
└── PanelConfigurator   — Threshold sliders, zone selection
```

**Rule of thumb:** If it touches Three.js, Mapbox, WebSocket, or has `useState` → `"use client"`. Everything else stays server.

### 3.2 — Why NOT Use Next.js API Routes for Backend Logic

It's tempting to put some endpoints in `/app/api/`, but here's why we don't:

1. **Ladybug/Radiance are Python-only** — no JS equivalent exists
2. **Celery requires a Python process** — can't run from Node.js
3. **Long-running tasks** — Next.js API routes have execution time limits (especially on Vercel)
4. **Separation of concerns** — the FastAPI server can scale independently of the frontend

**What Next.js API routes ARE useful for:**

```
/app/api/auth/[...nextauth]/route.ts  → NextAuth.js handlers
/app/api/proxy/upload/route.ts        → Proxy upload to FastAPI (adds auth header)
/app/api/proxy/ws/route.ts            → WebSocket proxy (if needed for auth)
```

### 3.3 — Dynamic Imports for Heavy Libraries

Three.js and Mapbox are massive libraries that should **never** be in the server bundle. Next.js dynamic imports handle this:

```typescript
// app/projects/[id]/place/page.tsx (Server Component)
import dynamic from 'next/dynamic'

const MapPlacer = dynamic(
  () => import('@/components/map/MapPlacer'),
  {
    ssr: false,              // CRITICAL: Three.js/Mapbox crash on server
    loading: () => <MapSkeleton />
  }
)

export default async function PlacePage({ params }) {
  // Fetch project data on the server
  const project = await fetchProject(params.id)

  return (
    <ProjectLayout project={project}>
      <MapPlacer                          // Client component, loaded dynamically
        modelUrl={project.model.glbUrl}
        initialPlacement={project.placement}
      />
    </ProjectLayout>
  )
}
```

This pattern gives you the best of both worlds: the page shell and data are server-rendered instantly, then the heavy 3D/map component hydrates on the client.

### 3.4 — Environment Variables & API Communication

```
# .env.local (Next.js)
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx          # Exposed to browser
NEXT_PUBLIC_FASTAPI_URL=http://localhost:8000  # Public API base

FASTAPI_INTERNAL_URL=http://fastapi:8000  # Server-side only (Docker network)
NEXTAUTH_SECRET=xxx
NEXTAUTH_URL=http://localhost:3000
```

Server Components fetch from `FASTAPI_INTERNAL_URL` (fast, internal Docker network).
Client Components fetch from `NEXT_PUBLIC_FASTAPI_URL` (public-facing URL).

---

## 4. User Flow (Step by Step)

### Step 1: Upload 3D Model
- User navigates to `/projects/[id]/upload`
- Drag-and-drop client component accepts `.glb`, `.gltf`, `.obj`, `.stl`, `.ifc`
- File uploads to FastAPI via Next.js proxy route (handles auth, streams to backend)
- FastAPI validates, converts to canonical `.glb`, extracts metadata
- Frontend shows instant Three.js preview (client-side parsing for quick feedback)
- Backend confirmation updates project state → redirect to `/place`

### Step 2: Place Model on Map
- `/projects/[id]/place` loads with server-fetched project data
- MapPlacer client component initializes Mapbox GL JS with satellite tiles
- 3D model renders on map via deck.gl `SimpleMeshLayer`
- User interactions: address search, click-to-place, rotate handle, scale slider
- Placement saved to FastAPI on each change (debounced PATCH)

### Step 3: Configure Analysis
- `/projects/[id]/analyze` — server component fetches nearest EPW stations
- Client component renders config form:
  - Weather station selector (auto-suggested, with distance shown)
  - Analysis period picker (annual / monthly / custom range)
  - Grid resolution slider (0.25m – 2.0m)
  - Advanced: ground reflectance, analysis height offset
- "Run Analysis" button POSTs config to FastAPI

### Step 4: Run Solar Analysis
- FastAPI queues Celery task, returns `job_id`
- Frontend connects WebSocket to FastAPI for real-time progress
- ProgressTracker client component shows:
  - Step indicator (preparing geometry → loading weather → running simulation → processing results)
  - Percentage bar
  - Estimated time remaining
- On completion: WebSocket sends `{ status: "completed", result_url: "..." }`

### Step 5: Visualize Heatmap
- `/projects/[id]/results` loads with server-fetched result metadata
- HeatmapViewer client component:
  - Fetches full irradiance array from FastAPI
  - Maps values to color ramp (blue → green → yellow → red)
  - Applies as vertex colors on Three.js BufferGeometry
  - Renders color legend, hover tooltips (kWh/m² per face)
  - Toggle between heatmap view and original model view

### Step 6: Panel Placement Suggestions
- Algorithm (backend) identifies optimal zones based on:
  - Irradiance above configurable threshold
  - Surface tilt 15°–35° (optimal for most latitudes)
  - South-facing (northern hemisphere) or north-facing (southern)
  - Minimum contiguous area for panel placement
- Results rendered as highlighted overlays on the 3D model
- Summary panel: estimated annual yield (kWh), panel count, area, CO₂ offset
- Export: PDF report via Next.js server action → FastAPI report generator

---

## 5. Tech Stack

### Frontend (Next.js)

| Component | Technology | Why |
|-----------|-----------|-----|
| Framework | Next.js 14+ (App Router) | SSR, file-based routing, React Server Components |
| Language | TypeScript (strict) | Type safety across the entire frontend |
| 3D Engine | Three.js + @react-three/fiber | Declarative Three.js via R3F, huge ecosystem |
| 3D Helpers | @react-three/drei | OrbitControls, loaders, helpers — saves weeks |
| Map | react-map-gl (Mapbox GL JS wrapper) | React-friendly Mapbox, works with Next.js |
| 3D-on-Map | deck.gl | Bridges 3D meshes into Mapbox coordinate system |
| State | Zustand | Lightweight, no boilerplate, works with SSR |
| Data Fetching | TanStack Query v5 | Polling, caching, mutations, optimistic updates |
| Auth | NextAuth.js v5 | Built for Next.js App Router, multiple providers |
| UI Components | shadcn/ui (Radix + Tailwind) | Accessible, customizable, no vendor lock-in |
| Styling | Tailwind CSS | Utility-first, pairs perfectly with shadcn/ui |
| File Upload | react-dropzone | Mature, accessible drag-and-drop |
| Forms | React Hook Form + Zod | Validation, type-safe forms |
| 3D File Loaders | Three.js loaders (GLTF, OBJ, STL) | Built into Three.js, loaded dynamically |
| IFC Preview | web-ifc-three | Client-side IFC viewing (preview only) |
| Notifications | Sonner (toast) | Lightweight, works with server actions |

### Backend (FastAPI — unchanged)

| Component | Technology | Why |
|-----------|-----------|-----|
| API Server | FastAPI (Python 3.11+) | Async, auto-docs, science/ML ecosystem |
| Task Queue | Celery + Redis | Async long-running analysis jobs |
| Solar Engine | Ladybug Tools | honeybee-radiance, ladybug, ladybug-geometry |
| Ray Tracer | Radiance | Industry-standard daylighting simulation |
| IFC Parser | IfcOpenShell | Converts IFC to mesh geometry |
| Geometry | trimesh, numpy | Mesh processing, normals, areas |
| Weather Data | ladybug EPW loader | Parses EnergyPlus weather files |
| File Storage | S3 / MinIO | Uploaded models, analysis results |
| Database | PostgreSQL + PostGIS | Spatial queries for nearest EPW stations |
| ORM | SQLAlchemy 2.0 + Alembic | Async ORM, schema migrations |
| WebSockets | FastAPI WebSocket | Real-time analysis progress |
| Containerization | Docker + Docker Compose | Reproducible env with Radiance |

---

## 6. Detailed Module Architecture

### 6.1 — Model Upload Pipeline

```
Browser                         Next.js                    FastAPI
───────                         ──────                     ───────
                                
User drops .ifc file
        │
        ▼
UploadDropzone                  
(client component)              
        │                       
        │ POST /api/proxy/upload
        │ (multipart/form-data)
        ▼                       
                                /app/api/proxy/upload/
                                route.ts
                                │
                                │ • Validates auth session
                                │ • Streams file to FastAPI
                                │ • Adds Authorization header
                                │
                                │ POST /api/models/upload
                                ▼
                                                           /api/models/upload
                                                           │
                                                           ├─ Detect format
                                                           ├─ Parse geometry
                                                           │  (trimesh / IfcOpenShell)
                                                           ├─ Convert → .glb
                                                           ├─ Extract metadata
                                                           ├─ Store in S3/MinIO
                                                           └─ Return model record
                                                           
                                ◄── { id, metadata, glbUrl }
        ◄── { id, metadata, glbUrl }
        │
        ▼
ThreeViewer shows preview
(loads .glb from glbUrl)
```

### 6.2 — Geo-Placement Module

```
/projects/[id]/place/page.tsx (Server Component)
│
├── Fetches project + model data from FastAPI (server-side)
├── Passes props to client component
│
└── <MapPlacer> (Client Component — "use client", ssr: false)
    │
    ├── react-map-gl (Mapbox GL JS)
    │   ├── Satellite tile layer
    │   ├── Terrain / 3D buildings layer
    │   └── Geocoder search control
    │
    ├── deck.gl overlay
    │   └── SimpleMeshLayer
    │       ├── Loads .glb from FastAPI URL
    │       ├── Position from [lng, lat, elevation]
    │       ├── Orientation from rotation state
    │       └── Scale from scale state
    │
    ├── Placement Controls (shadcn/ui)
    │   ├── Address search input
    │   ├── Rotation dial (0°–360°)
    │   ├── Scale slider
    │   └── Elevation offset input
    │
    └── Zustand store (placement state)
        │
        ├── On change: debounced PATCH /api/projects/{id}/placement
        └── State: { lat, lng, rotation, scale, elevation }
```

### 6.3 — Solar Analysis Engine (Backend Core)

```
Input:
  - Mesh geometry (vertices, faces, normals)
  - Location (lat, lng)
  - EPW weather file
  - Analysis period + grid resolution

         │
         ▼
┌────────────────────────────────────┐
│  1. GEOMETRY PREPARATION            │
│                                     │
│  - Convert mesh → Honeybee Model    │
│  - Create analysis grid on surfaces │
│  - Grid = sample points + normals   │
│  - Resolution: user-defined         │
│    (e.g. 0.5m spacing)              │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  2. WEATHER DATA                    │
│                                     │
│  - Load .epw file for location      │
│  - Extract:                         │
│    - Direct Normal Irradiance (DNI) │
│    - Diffuse Horizontal Irrad (DHI) │
│    - 8760 hourly values (full year) │
│  - Filter to analysis period        │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  3. SUNPATH CALCULATION             │
│                                     │
│  - Ladybug Sunpath from lat/lng     │
│  - Sun positions for each hour      │
│  - Filter: sun above horizon only   │
│  - Create Radiance sky              │
│    (cumulative or per-timestep)     │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  4. RADIANCE SIMULATION             │
│                                     │
│  Option A: Cumulative Sky (faster)  │
│  - GenCumulativeSky from .epw       │
│  - Single Radiance run              │
│  - Returns total kWh/m² per point   │
│                                     │
│  Option B: Timestep (more detail)   │
│  - Run Radiance for each hour       │
│  - Returns hourly W/m² per point    │
│  - Enables time-of-day animation    │
│                                     │
│  Radiance programs:                 │
│  - rfluxmtx, dctimestep, rpict     │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  5. RESULTS PROCESSING              │
│                                     │
│  - Per-point irradiance values      │
│  - Map back to mesh faces/vertices  │
│  - Statistics: min/max/avg kWh/m²  │
│  - Identify optimal panel zones     │
│  - Export as JSON                    │
└────────────────────────────────────┘

Output JSON:
{
  "grid_points": [[x,y,z], ...],
  "values": [1245.3, 1102.7, ...],
  "statistics": { "min": 234.5, "max": 1456.2, "avg": 987.3 },
  "unit": "kWh/m²",
  "panel_zones": [
    {
      "face_indices": [12, 13, 14, 15],
      "avg_irradiance": 1350.2,
      "area_m2": 24.5,
      "tilt_deg": 22.3,
      "azimuth_deg": 178.5,
      "estimated_yield_kwh": 4200
    }
  ]
}
```

### 6.4 — Heatmap Visualization (Client Component)

```
/projects/[id]/results/page.tsx (Server Component)
│
├── Fetches result metadata from FastAPI
├── Passes to client component
│
└── <HeatmapViewer> (Client Component — "use client", ssr: false)
    │
    ├── Uses @react-three/fiber <Canvas>
    │   │
    │   ├── Load model .glb via useGLTF (drei)
    │   │
    │   ├── Fetch irradiance values via TanStack Query
    │   │   GET /api/analysis/{job_id}/results
    │   │
    │   ├── Value → Color Mapping (custom shader or vertex colors)
    │   │   ├── Normalize: t = (val - min) / (max - min)
    │   │   ├── Color ramp:
    │   │   │   0.0 → #313695 (deep blue — low irradiance)
    │   │   │   0.25 → #4575B4
    │   │   │   0.5 → #FFFFBF (yellow — medium)
    │   │   │   0.75 → #F46D43
    │   │   │   1.0 → #A50026 (deep red — high irradiance)
    │   │   └── Apply as BufferGeometry vertex colors
    │   │
    │   ├── Raycaster for hover interaction
    │   │   └── Tooltip: "1,245 kWh/m²" on hovered face
    │   │
    │   └── Panel zone overlays
    │       └── Highlighted meshes with dashed outlines
    │
    ├── UI Overlays (HTML, positioned over canvas)
    │   ├── Color legend bar
    │   ├── Statistics card (min/max/avg)
    │   ├── Threshold slider (filter visible zones)
    │   └── View toggle (heatmap / original / panel zones)
    │
    └── Export actions
        ├── Download CSV (irradiance data)
        └── Generate PDF report (via server action → FastAPI)
```

---

## 7. Next.js Routing & Page Structure

```
app/
├── layout.tsx                          # Root layout (fonts, providers, sidebar)
├── page.tsx                            # Landing / dashboard
├── globals.css                         # Tailwind base
│
├── (auth)/                             # Auth route group
│   ├── login/page.tsx
│   └── register/page.tsx
│
├── projects/
│   ├── page.tsx                        # Project list (SSR, fetches from FastAPI)
│   ├── new/page.tsx                    # Create project form
│   │
│   └── [id]/
│       ├── layout.tsx                  # Project layout (step indicator sidebar)
│       ├── page.tsx                    # Project overview / redirect to current step
│       │
│       ├── upload/
│       │   └── page.tsx               # Step 1: Upload model
│       │                               # Server: fetch project state
│       │                               # Client: <UploadDropzone>, <ThreePreview>
│       │
│       ├── place/
│       │   └── page.tsx               # Step 2: Geo-placement
│       │                               # Server: fetch project + model
│       │                               # Client: <MapPlacer> (dynamic, ssr:false)
│       │
│       ├── analyze/
│       │   └── page.tsx               # Step 3: Configure + run
│       │                               # Server: fetch nearby EPW stations
│       │                               # Client: <AnalysisForm>, <ProgressTracker>
│       │
│       ├── results/
│       │   └── page.tsx               # Step 4: Heatmap + panels
│       │                               # Server: fetch result metadata
│       │                               # Client: <HeatmapViewer> (dynamic, ssr:false)
│       │
│       └── history/
│           └── page.tsx               # Past analysis runs for this project
│
├── api/                                # Next.js API routes (thin proxy only)
│   ├── auth/
│   │   └── [...nextauth]/route.ts     # NextAuth handlers
│   └── proxy/
│       └── [...path]/route.ts         # Generic FastAPI proxy with auth
│
└── components/                         # Shared components
    ├── ui/                             # shadcn/ui components
    ├── three/                          # Three.js / R3F components
    │   ├── ThreePreview.tsx            # "use client" — model preview
    │   ├── HeatmapMesh.tsx            # "use client" — colored mesh
    │   └── PanelZoneOverlay.tsx       # "use client" — zone highlights
    ├── map/                            # Mapbox components
    │   ├── MapPlacer.tsx              # "use client" — full placement UI
    │   └── ModelLayer.tsx             # "use client" — deck.gl mesh layer
    └── analysis/
        ├── AnalysisForm.tsx           # "use client" — config form
        └── ProgressTracker.tsx        # "use client" — WebSocket progress
```

---

## 8. State Management Strategy

```
┌─────────────────────────────────────────────────────┐
│                  Zustand Stores                       │
│                                                       │
│  projectStore                                         │
│  ├── currentProject: Project | null                   │
│  ├── setProject(p)                                    │
│  └── Used by: all project pages                       │
│                                                       │
│  modelStore                                           │
│  ├── modelUrl: string | null                          │
│  ├── metadata: ModelMetadata | null                   │
│  ├── uploadProgress: number                           │
│  └── Used by: UploadDropzone, ThreePreview            │
│                                                       │
│  placementStore                                       │
│  ├── latitude: number                                 │
│  ├── longitude: number                                │
│  ├── rotation: number                                 │
│  ├── scale: number                                    │
│  ├── elevation: number                                │
│  ├── setPlacement(partial)                            │
│  └── Used by: MapPlacer, saved to FastAPI on change   │
│                                                       │
│  analysisStore                                        │
│  ├── jobId: string | null                             │
│  ├── status: 'idle'|'queued'|'running'|'done'|'error' │
│  ├── progress: number (0-100)                         │
│  ├── results: AnalysisResult | null                   │
│  └── Used by: AnalysisForm, ProgressTracker, Heatmap  │
│                                                       │
│  viewerStore                                          │
│  ├── viewMode: 'model' | 'heatmap' | 'panels'        │
│  ├── threshold: number                                │
│  ├── hoveredFace: number | null                       │
│  ├── selectedZone: PanelZone | null                   │
│  └── Used by: HeatmapViewer, controls                 │
│                                                       │
└─────────────────────────────────────────────────────┘

TanStack Query (server state):
├── useProject(id)        → GET /api/projects/{id}
├── useModel(id)          → GET /api/models/{id}
├── useWeatherStations()  → GET /api/weather/stations?lat=&lng=
├── useAnalysisStatus()   → GET /api/analysis/{jobId}/status (polling)
├── useAnalysisResults()  → GET /api/analysis/{jobId}/results
└── usePanelZones()       → GET /api/analysis/{jobId}/panels
```

**Why both Zustand and TanStack Query?**

Zustand handles UI state (what view mode, what's hovered, placement controls). TanStack Query handles server-fetched data (project info, analysis results) with automatic caching, refetching, and polling. They complement each other — Zustand doesn't re-fetch, TanStack doesn't manage local UI state.

---

## 9. API Endpoints (FastAPI)

```
Authentication (handled by NextAuth, FastAPI validates JWT):
──────────────────────────────────────────────────────────

Models:
POST   /api/models/upload              Upload 3D model file (multipart)
GET    /api/models/{id}                Get model metadata + GLB download URL
DELETE /api/models/{id}                Delete model and files

Projects:
POST   /api/projects                   Create new project
GET    /api/projects                   List user's projects
GET    /api/projects/{id}              Get project details
PATCH  /api/projects/{id}/placement    Update geo-placement
DELETE /api/projects/{id}              Delete project + associated data

Weather:
GET    /api/weather/stations           Find nearest EPW stations
       ?lat=40.7&lng=-74.0&limit=5
GET    /api/weather/epw/{station_id}   Download EPW file info

Analysis:
POST   /api/analysis/run               Start analysis (returns job_id)
       Body: { project_id, epw_station_id, period, grid_resolution, ... }
GET    /api/analysis/{job_id}/status   Poll status + progress
GET    /api/analysis/{job_id}/results  Full irradiance results (large JSON)
GET    /api/analysis/{job_id}/panels   Panel placement suggestions
       ?min_irradiance=800&min_area=2&tilt_min=15&tilt_max=35
DELETE /api/analysis/{job_id}          Delete analysis run

WebSocket:
WS     /ws/analysis/{job_id}           Real-time progress stream

Reports:
POST   /api/reports/generate           Generate PDF report for analysis
GET    /api/reports/{id}/download      Download generated report
```

---

## 10. Data Models

```
Project {
  id: uuid
  user_id: uuid
  name: string
  created_at: datetime
  updated_at: datetime
  model_id: uuid → Model
  placement: {
    latitude: float
    longitude: float
    rotation_deg: float
    scale: float
    elevation_m: float
  }
  current_step: "upload" | "place" | "analyze" | "results"
}

Model {
  id: uuid
  original_filename: string
  original_format: "glb" | "obj" | "stl" | "ifc"
  normalized_glb_path: string         // S3 path
  original_file_path: string          // S3 path
  face_count: int
  vertex_count: int
  bounding_box: { min: [x,y,z], max: [x,y,z] }
  surface_area_m2: float
  ifc_metadata: json | null           // Element types, storeys, etc.
}

AnalysisJob {
  id: uuid
  project_id: uuid → Project
  status: "queued" | "running" | "completed" | "failed"
  progress: float                     // 0-100
  progress_message: string            // "Loading weather data..."
  config: {
    epw_station_id: string
    period: "annual" | { start_month, end_month }
    grid_resolution: float            // meters
    ground_reflectance: float         // 0-1
  }
  started_at: datetime
  completed_at: datetime
  result_path: string                 // S3 path to results JSON
  error_message: string | null
}

AnalysisResult {
  job_id: uuid
  grid_points: [[x,y,z], ...]
  irradiance_values: [float, ...]     // kWh/m² per point
  statistics: { min, max, avg, total }
  panel_zones: [PanelZone, ...]
}

PanelZone {
  id: int
  face_indices: [int, ...]
  centroid: [x, y, z]
  avg_irradiance: float               // kWh/m²
  area_m2: float
  tilt_deg: float
  azimuth_deg: float
  estimated_annual_yield_kwh: float
  panel_count_estimate: int           // Based on standard panel size
}
```

---

## 11. EPW Weather Data Strategy

EPW (EnergyPlus Weather) files contain 8,760 hourly data points for a full year — they're the standard input for Ladybug/Radiance.

**Sources (free):**
- Climate.OneBuilding.Org — largest free collection (worldwide, 3000+ stations)
- EnergyPlus.net weather data
- Ladybug Tools EPW Map

**Implementation:**
1. Pre-index ~3,000+ EPW stations with lat/lng into PostgreSQL + PostGIS
2. When user places model → query nearest stations via `ST_DDistance`
3. Show 3-5 nearest options with distance in the UI
4. Cache downloaded EPW files on server (they rarely change)
5. Allow manual EPW upload for custom/proprietary weather data
6. For locations far from any station → show accuracy warning in UI

---

## 12. IFC Handling Pipeline

```
.ifc upload
    │
    ▼
FastAPI receives file
    │
    ▼
IfcOpenShell (Python)
    │
    ├── Extract geometry per IFC element
    │   (IfcWall, IfcRoof, IfcSlab, IfcWindow, etc.)
    │
    ├── Preserve element metadata as glTF extras:
    │   { ifc_class: "IfcRoof", storey: "Level 2", material: "Concrete" }
    │
    ├── Triangulate all geometry
    │
    └── Export as .glb with element IDs in mesh userData
    
Frontend can then:
    ├── Display element tree (walls, roofs, slabs)
    ├── Let user toggle visibility per element type
    ├── Filter analysis to specific elements:
    │   "Analyze only IfcRoof and IfcSlab surfaces"
    └── Color-code by element type in preview
```

**Why IFC matters:** Architects already have IFC exports from Revit, ArchiCAD, etc. The metadata lets users filter to just roof surfaces for panel analysis — much more useful than analyzing every wall.

---

## 13. Performance & Optimization

| Concern | Solution |
|---------|----------|
| Three.js bundle size (~600KB) | `next/dynamic` with `ssr: false`, code-split per page |
| Mapbox GL JS bundle (~800KB) | Dynamic import, only loaded on `/place` page |
| Large models (100k+ faces) | Decimate for analysis grid, LOD for display, cap at 500k faces |
| Analysis time (full year) | Cumulative sky method (~2-5 min), progress via WebSocket |
| Large result arrays (~MB) | Stream JSON, progressive loading, typed arrays |
| Browser memory | BufferGeometry (no Object3D per face), dispose on unmount |
| Initial page load | Server Components for shell, skeleton loaders for 3D |
| Concurrent analyses | Celery worker pool, Redis rate limiting per user |
| Image/asset optimization | Next.js Image component for non-3D images |
| SEO for marketing pages | Server-rendered by default with Next.js |

**Typical analysis times:**
- Small building (1k faces, 0.5m grid): ~30 seconds
- Medium building (10k faces, 0.5m grid): ~2-5 minutes
- Large complex (50k faces, 1m grid): ~10-20 minutes
- Urban block (100k+ faces): ~30-60 minutes

---

## 14. Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Compose                          │
│                                                              │
│  ┌────────────────┐                                          │
│  │    Nginx        │  Reverse proxy                          │
│  │    :80/:443     │  ├── /          → Next.js :3000         │
│  │                 │  └── /api/v1/*  → FastAPI :8000         │
│  └────────────────┘                                          │
│                                                              │
│  ┌────────────────┐  ┌─────────────────┐                     │
│  │  Next.js        │  │  FastAPI         │                     │
│  │  (Node.js)      │  │  (Uvicorn)       │                     │
│  │  :3000          │  │  :8000           │                     │
│  │                 │  │                  │                     │
│  │  • SSR/SSG      │  │  • REST API      │                     │
│  │  • Static files │  │  • File parsing  │                     │
│  │  • Auth         │  │  • WebSocket     │                     │
│  └────────────────┘  └────────┬────────┘                     │
│                                │                              │
│  ┌────────────────┐  ┌────────▼────────┐  ┌───────────────┐ │
│  │  PostgreSQL     │  │  Celery Workers  │  │  Redis         │ │
│  │  + PostGIS      │  │  (2-4 workers)   │  │  (broker +     │ │
│  │  :5432          │  │                  │  │   cache)       │ │
│  │                 │  │  • Radiance      │  │  :6379         │ │
│  └────────────────┘  │    installed      │  └───────────────┘ │
│                       │  • Ladybug Tools │                     │
│  ┌────────────────┐  │    installed      │                     │
│  │  MinIO (S3)     │  └──────────────────┘                     │
│  │  :9000          │                                          │
│  │  File storage   │                                          │
│  └────────────────┘                                          │
└─────────────────────────────────────────────────────────────┘

Alternative: Vercel (Next.js) + Fly.io/Railway (FastAPI + Workers)
───────────────────────────────────────────────────────────────
┌──────────┐     ┌────────────┐     ┌───────────────┐
│  Vercel   │────▶│  Fly.io     │────▶│  Managed Redis │
│  Next.js  │     │  FastAPI +  │     │  (Upstash)     │
│  (edge)   │     │  Workers    │     └───────────────┘
└──────────┘     └────────────┘     ┌───────────────┐
                                     │  Managed PG    │
                                     │  (Neon/Supabase)│
                                     └───────────────┘
```

**Nginx routing rule:** All paths starting with `/api/v1/` proxy to FastAPI. Everything else goes to Next.js. This keeps CORS simple — both frontend and API share the same domain.

---

## 15. Folder Structure

```
solarsight/
│
├── frontend/                           # Next.js application
│   ├── app/
│   │   ├── layout.tsx                  # Root layout + providers
│   │   ├── page.tsx                    # Landing page
│   │   ├── globals.css
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   │
│   │   ├── projects/
│   │   │   ├── page.tsx               # Project list
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── layout.tsx         # Project workspace layout
│   │   │       ├── page.tsx           # Overview / redirect
│   │   │       ├── upload/page.tsx
│   │   │       ├── place/page.tsx
│   │   │       ├── analyze/page.tsx
│   │   │       ├── results/page.tsx
│   │   │       └── history/page.tsx
│   │   │
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── proxy/[...path]/route.ts
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── slider.tsx
│   │   │   └── ...
│   │   │
│   │   ├── three/                      # 3D components ("use client")
│   │   │   ├── ThreePreview.tsx        # Model preview canvas
│   │   │   ├── HeatmapMesh.tsx        # Irradiance-colored mesh
│   │   │   ├── PanelZoneOverlay.tsx   # Highlighted zones
│   │   │   ├── ColorLegend.tsx        # Heatmap legend overlay
│   │   │   └── ModelInspector.tsx     # Face count, bbox, stats
│   │   │
│   │   ├── map/                        # Map components ("use client")
│   │   │   ├── MapPlacer.tsx          # Full placement interface
│   │   │   ├── ModelLayer.tsx         # deck.gl mesh on map
│   │   │   ├── PlacementControls.tsx  # Rotation, scale, elevation
│   │   │   └── AddressSearch.tsx      # Geocoding input
│   │   │
│   │   ├── analysis/                   # Analysis UI ("use client")
│   │   │   ├── AnalysisForm.tsx       # Config form
│   │   │   ├── StationPicker.tsx      # EPW station selector
│   │   │   ├── ProgressTracker.tsx    # WebSocket progress
│   │   │   └── ResultsDashboard.tsx   # Stats cards + actions
│   │   │
│   │   ├── upload/                     # Upload UI ("use client")
│   │   │   ├── UploadDropzone.tsx     # Drag-and-drop
│   │   │   └── FormatBadge.tsx        # File type indicator
│   │   │
│   │   └── layout/                     # Layout components
│   │       ├── Sidebar.tsx
│   │       ├── StepIndicator.tsx      # Upload → Place → Analyze → Results
│   │       └── Navbar.tsx
│   │
│   ├── stores/                         # Zustand stores
│   │   ├── projectStore.ts
│   │   ├── modelStore.ts
│   │   ├── placementStore.ts
│   │   ├── analysisStore.ts
│   │   └── viewerStore.ts
│   │
│   ├── hooks/                          # Custom hooks
│   │   ├── useAnalysisPolling.ts      # TanStack Query polling
│   │   ├── useWebSocket.ts           # WebSocket connection
│   │   ├── useColorRamp.ts           # Value → color mapping
│   │   └── usePlacementSync.ts       # Debounced save to API
│   │
│   ├── lib/                            # Utilities
│   │   ├── api.ts                     # FastAPI client (fetch wrapper)
│   │   ├── auth.ts                    # NextAuth config
│   │   ├── colorRamp.ts              # Irradiance → RGB
│   │   ├── constants.ts              # Thresholds, defaults
│   │   └── types.ts                   # Shared TypeScript types
│   │
│   ├── public/
│   │   └── ...
│   │
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile
│
├── backend/                            # FastAPI application
│   ├── app/
│   │   ├── main.py                    # FastAPI app entry
│   │   ├── config.py                  # Settings (pydantic-settings)
│   │   │
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── models.py             # /api/models/* endpoints
│   │   │   ├── projects.py           # /api/projects/* endpoints
│   │   │   ├── analysis.py           # /api/analysis/* endpoints
│   │   │   ├── weather.py            # /api/weather/* endpoints
│   │   │   ├── reports.py            # /api/reports/* endpoints
│   │   │   └── websocket.py          # /ws/* WebSocket handlers
│   │   │
│   │   ├── services/
│   │   │   ├── model_parser.py       # Multi-format → glb conversion
│   │   │   ├── ifc_converter.py      # IFC → glTF via IfcOpenShell
│   │   │   ├── solar_engine.py       # Ladybug/Radiance orchestration
│   │   │   ├── panel_analyzer.py     # Optimal zone identification
│   │   │   ├── weather_service.py    # EPW file management + station lookup
│   │   │   └── report_generator.py   # PDF report creation
│   │   │
│   │   ├── tasks/
│   │   │   ├── __init__.py
│   │   │   ├── celery_app.py         # Celery configuration
│   │   │   └── analysis_task.py      # Solar analysis Celery task
│   │   │
│   │   ├── models/                    # SQLAlchemy ORM
│   │   │   ├── project.py
│   │   │   ├── model.py
│   │   │   ├── analysis.py
│   │   │   └── user.py
│   │   │
│   │   ├── schemas/                   # Pydantic schemas
│   │   │   ├── project.py
│   │   │   ├── model.py
│   │   │   ├── analysis.py
│   │   │   └── weather.py
│   │   │
│   │   └── core/
│   │       ├── database.py           # Async SQLAlchemy engine
│   │       ├── auth.py               # JWT validation
│   │       ├── storage.py            # S3/MinIO client
│   │       └── deps.py               # FastAPI dependencies
│   │
│   ├── alembic/                       # Database migrations
│   │   ├── versions/
│   │   └── env.py
│   │
│   ├── data/
│   │   └── epw_stations.csv          # Pre-indexed station locations
│   │
│   ├── requirements.txt
│   ├── Dockerfile
│   └── alembic.ini
│
├── worker/
│   ├── Dockerfile                     # Based on Ubuntu + Radiance + Python
│   └── install_radiance.sh           # Radiance compilation script
│
├── nginx/
│   └── nginx.conf                    # Reverse proxy config
│
├── docker-compose.yml                # Full stack orchestration
├── docker-compose.dev.yml            # Dev overrides (hot reload)
├── .env.example
├── Makefile                          # Common commands
└── README.md
```

---

## 16. Development Phases

### Phase 1 — Foundation (Weeks 1-3)
- [ ] Docker Compose: Next.js + FastAPI + PostgreSQL + Redis + MinIO
- [ ] Next.js scaffolding: App Router, Tailwind, shadcn/ui, NextAuth
- [ ] FastAPI scaffolding: SQLAlchemy, Alembic, S3 client, CORS
- [ ] Model upload: dropzone UI → proxy route → FastAPI → S3
- [ ] Three.js preview: dynamic import, GLTF/OBJ/STL loaders
- [ ] Basic project CRUD (create, list, view)

### Phase 2 — Map Integration (Weeks 4-5)
- [ ] react-map-gl + Mapbox satellite tiles on `/place` page
- [ ] deck.gl SimpleMeshLayer for 3D model on map
- [ ] Address geocoding search
- [ ] Rotation, scale, elevation controls (shadcn/ui sliders)
- [ ] Debounced placement save to FastAPI
- [ ] Step indicator navigation (upload → place → analyze → results)

### Phase 3 — Solar Engine (Weeks 6-9)
- [ ] Celery worker Docker image with Radiance compiled
- [ ] Ladybug/honeybee Python environment in worker
- [ ] EPW station index in PostGIS + nearest-station API
- [ ] Geometry → Honeybee Model conversion service
- [ ] Cumulative sky incident radiation analysis
- [ ] WebSocket progress reporting
- [ ] Analysis status polling (TanStack Query fallback)

### Phase 4 — Visualization (Weeks 10-11)
- [ ] Vertex color heatmap on R3F mesh
- [ ] Color ramp legend + hover tooltip (raycaster)
- [ ] Panel zone identification algorithm
- [ ] Zone overlay rendering (highlighted outlines)
- [ ] Statistics dashboard (cards with min/max/avg, yield estimates)
- [ ] View mode toggle (model / heatmap / panels)

### Phase 5 — IFC + Polish (Weeks 12-14)
- [ ] IFC upload → IfcOpenShell parsing → glTF conversion
- [ ] Element type tree in sidebar (filter by IfcRoof, IfcWall, etc.)
- [ ] Analysis history page per project
- [ ] PDF report generation (FastAPI → frontend download)
- [ ] CSV data export
- [ ] Performance: mesh decimation, LOD, progressive result loading

### Phase 6 — Advanced Features (Weeks 15+)
- [ ] Hourly irradiance animation (playback slider)
- [ ] Shadow study visualization
- [ ] Multi-building / urban context (upload multiple models)
- [ ] Auto panel layout optimizer (arrange standard panels on best zones)
- [ ] Financial calculator (ROI, payback period, local energy prices)
- [ ] User dashboard (all projects, usage stats)
- [ ] Team/sharing features

---

## 17. Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Radiance compilation in Docker | High | Use ladybug-tools Docker base image; test early in Phase 3 |
| Three.js SSR crashes | High | Always use `dynamic()` with `ssr: false` for all 3D/map components |
| deck.gl + react-map-gl integration | Medium | Use `@deck.gl/mapbox` overlay; test with simple cube first |
| IFC geometry extraction failures | Medium | Validate on upload; fallback to "unsupported elements" warning |
| Large result JSON (>10MB) | Medium | Stream with `fetch` + `ReadableStream`; paginate if needed |
| Mapbox token exposure | Low | Use Next.js `NEXT_PUBLIC_` prefix, restrict token to domain |
| WebSocket through Nginx | Low | Configure Nginx `proxy_pass` with upgrade headers |
| Analysis timeout for huge models | High | Cap grid points at 500k; offer mesh simplification; show ETA |

---

## 18. Third-Party Services & Costs

| Service | Purpose | Cost |
|---------|---------|------|
| Mapbox GL JS | Map tiles + satellite + geocoding | Free: 50k loads/mo, 100k geocodes/mo |
| Climate.OneBuilding | EPW weather files | Free (open data) |
| AWS S3 / MinIO | File storage (models, results) | ~$0.023/GB/mo (S3) or self-hosted |
| Vercel (optional) | Next.js hosting | Free tier → $20/mo Pro |
| Fly.io / Railway | FastAPI + workers hosting | ~$5-20/mo depending on usage |
| Neon / Supabase | Managed PostgreSQL | Free tier available |
| Upstash | Managed Redis | Free tier: 10k commands/day |

---

## Summary

This architecture gives you the best of both worlds: Next.js handles the user-facing experience with SSR for fast loads, file-based routing for clean URLs, and React Server Components for the non-interactive parts. FastAPI handles everything computational with Ladybug/Radiance doing the heavy simulation work.

The critical boundaries are clean — Next.js never runs Python, FastAPI never renders HTML. They communicate over REST + WebSocket, and Nginx ties them together under one domain.

**Start here:** Get Docker Compose running with Next.js + FastAPI + PostgreSQL, build the upload → Three.js preview flow, and confirm you can load all four file formats. That alone proves out the hardest frontend pieces. Then tackle the Radiance Docker image early in Phase 3 — that's the biggest unknown.
