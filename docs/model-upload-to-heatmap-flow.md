# 3D Model Upload → Heatmap Display: Complete Flow

This document traces every step of the data pipeline from the moment a user drops a file to when
the heatmap renders in the browser. Each section lists the exact file and function responsible,
plus known pitfalls.

---

## Overview

```
User drops file
      │
      ▼
[Frontend] UploadDropzone  →  XHR POST /api/models/upload
      │
      ▼
[Backend] POST /api/models/upload (models.py)
  ├── model_parser.parse_and_convert()   ← converts to GLB
  ├── storage.upload_bytes()             ← saves GLB to disk
  ├── Model3D row → DB
  └── Project.model_id = model.id  (project.current_step → "place")
      │
      ▼
[Frontend] redirect → /projects/{id}/place  (Mapbox, save lat/lon)
      │
      ▼
[Frontend] AnalysisForm  →  POST /api/analysis/run
      │
      ▼
[Backend] POST /api/analysis/run (analysis.py)
  ├── AnalysisJob row → DB  (status = "queued")
  └── Celery: run_solar_analysis.delay(job.id)
      │
      ▼
[Worker] run_solar_analysis (analysis_task.py)
  ├── _fetch_job_data()       ← reads job + project + model from DB
  ├── download_bytes(glb_path) ← loads GLB bytes
  ├── _get_epw_path()          ← finds/downloads EPW weather file
  ├── solar_engine.run_analysis()
  │     ├── trimesh: load GLB, triangulate
  │     ├── ladybug: load EPW, build SkyMatrix
  │     ├── RadiationStudy OR synthetic fallback
  │     └── returns heatmap_cells, sensor_points, statistics …
  └── upload_bytes(results.json)  → storage/{project_id}/analysis/{job_id}/results.json
      │
      ▼
[Frontend] HeatmapViewer polls GET /api/analysis/{job_id}/status
      │  (status: queued → running → completed)
      ▼
[Frontend] TanStack Query: GET /api/analysis/{job_id}/results
      │
      ▼
[Frontend] buildHeatmapMesh(heatmap_cells)  →  THREE.js quad mesh overlay
```

---

## Step 1 — File Upload (Frontend)

**File:** `frontend/components/upload/UploadDropzone.tsx`

- User drops or picks a file (GLB / GLTF / OBJ / STL / IFC, max `MAX_UPLOAD_MB`)
- `XMLHttpRequest` sends a `multipart/form-data` POST directly to:
  ```
  NEXT_PUBLIC_FASTAPI_URL + /api/models/upload
  ```
  Fields: `file` (binary), `project_id` (string)
- Progress bar tracks `xhr.upload.onprogress` (0–90%), then jumps to 100% on success
- On success: saves `ModelMeta` to `useModelStore` (Zustand), redirects to `/projects/{id}/place`

> **Potential issue:** The URL is built from `process.env.NEXT_PUBLIC_FASTAPI_URL` — if this env
> var is missing or wrong, the XHR goes to the wrong host and fails silently with a network error.
> Check `.env` → `NEXT_PUBLIC_FASTAPI_URL=http://localhost:8000`.

---

## Step 2 — Model Parse & Store (Backend)

**File:** `backend/app/api/models.py` → `POST /api/models/upload`

1. **Validate extension** — allowed: `glb`, `gltf`, `obj`, `stl`, `ifc`
2. **Parse & convert** — `backend/app/services/model_parser.py` → `parse_and_convert()`
   - `glb` / `gltf`: stored as-is (no conversion, `face_count` = 0)
   - `obj` / `stl` / `ifc`: converted to GLB via `trimesh`; on any trimesh error,
     raw bytes are stored with stub metadata (face_count = 0, bounding_box = stub)
3. **Save files** — `backend/app/core/storage.py`
   - Original file → `storage/{project_id}/original.{ext}`
   - Converted GLB → `storage/{project_id}/model.glb`
   - Storage root = `backend/` directory on disk
4. **Write DB rows**
   - `Model3D` row (id, paths, face_count, etc.)
   - `Project.model_id = model.id`, `current_step = "place"`
5. **Return** `ModelMetaOut` — includes `normalized_glb_url`

### How `normalized_glb_url` is built

**File:** `backend/app/schemas/model.py` → `ModelMetaOut.from_orm_with_url()`

```python
# Local storage (no MinIO):
path = f"/api/models/{obj.id}/download"
instance.normalized_glb_url = f"{PUBLIC_API_URL}{path}"   # if PUBLIC_API_URL set
#                            = path                         # otherwise (relative URL)
```

> **Potential issue:** If `PUBLIC_API_URL` is not set in `.env`, `normalized_glb_url` is a
> **relative path** like `/api/models/{id}/download`. The frontend results page then prepends
> `NEXT_PUBLIC_FASTAPI_URL` to make it absolute:
> ```ts
> // frontend/app/projects/[id]/results/page.tsx
> const base = process.env.NEXT_PUBLIC_FASTAPI_URL || ''
> return `${base}${url}` // → http://localhost:8000/api/models/{id}/download
> ```
> If `NEXT_PUBLIC_FASTAPI_URL` is also missing, the URL stays relative and the Three.js
> `useGLTF` fetch hits the Next.js server instead of FastAPI → 404.

### GLB Download Endpoint

**File:** `backend/app/api/models.py` → `GET /api/models/{model_id}/download`

```python
data = download_bytes(model.normalized_glb_path)
return StreamingResponse(io.BytesIO(data), media_type="model/gltf-binary")
```

---

## Step 3 — Place on Map (Frontend)

**File:** `frontend/app/projects/[id]/place/page.tsx`

- Mapbox GL map; user positions the model over a real location
- On confirm: `PATCH /api/projects/{id}/placement` with `{ latitude, longitude, rotation_deg, scale, elevation_m }`
- Backend saves `project.placement` (JSONB column)
- These coordinates are later used by the worker to download the EPW weather file

---

## Step 4 — Run Analysis (Frontend → Backend → Celery)

**File:** `frontend/components/analysis/AnalysisForm.tsx`

Sends: `POST /api/analysis/run`
```json
{
  "project_id": "...",
  "epw_station_id": "...",
  "mode": "annual",
  "grid_resolution": 1.0,
  "ground_reflectance": 0.2,
  "surface_filter": "all"
}
```

**File:** `backend/app/api/analysis.py` → `POST /api/analysis/run`

1. Checks project exists and has a `model_id`
2. Creates `AnalysisJob` row (status = `"queued"`)
3. Sets `project.latest_job_id = job.id`, `current_step = "results"`
4. Dispatches `run_solar_analysis.delay(job.id)` to Celery via Redis broker

---

## Step 5 — Worker Executes Analysis

**File:** `backend/app/tasks/analysis_task.py` → `run_solar_analysis(job_id)`

### 5a. Fetch data from DB
```python
job = db.get(AnalysisJob, job_id)
project = db.get(Project, job.project_id)
model = db.get(Model3D, project.model_id)
```

### 5b. Load GLB bytes
```python
glb_bytes = download_bytes(model.normalized_glb_path)
# → reads backend/storage/{project_id}/model.glb
```

### 5c. Get EPW weather file
**File:** `backend/app/tasks/analysis_task.py` → `_get_epw_path()`

Priority order:
1. `backend/data/seoul.epw` — if it exists, always wins
2. Any `*.epw` file in `backend/data/`, `backend/`, or `cwd`
3. PVGIS download cached in `/tmp/epw_cache/{lat}_{lon}.epw`
4. Return a path that doesn't exist yet → solar engine uses synthetic fallback

> **If `seoul.epw` is present in `backend/` or `backend/data/`, it is always used.**

### 5d. Run solar engine
**File:** `backend/app/services/solar_engine.py` → `run_analysis()`

```
trimesh loads GLB → concatenated triangle mesh
_detect_up_vector()    → Y-up (GLB/GLTF) or Z-up (OBJ/STL)
_get_face_mask()       → selects faces by surface_filter or selected_face_ids
_build_study_mesh()    → converts trimesh faces → ladybug Mesh3D
↓
Annual mode:
  SkyMatrix.from_epw()       → sky radiation matrix (needs gendaymtx binary)
  RadiationStudy(sky_matrix, study_mesh) → one kWh/m² per face
↓
Hourly mode:
  Sunpath() → sun position
  _synthetic_hourly_irradiance() → W/m² per face (no binary needed)
↓
On AssertionError / ImportError:
  _synthetic_result() → random but plausible values, real heatmap geometry
↓
_build_heatmap_cells() → list of quad cells, each with 4 3D corners + value
```

### 5e. Save results
```python
result_path = f"storage/{project_id}/analysis/{job_id}/results.json"
upload_bytes(result_path, json_bytes)
# AnalysisJob: status="completed", result_path=result_path
```

---

## Step 6 — Frontend Polls & Renders

**File:** `frontend/app/projects/[id]/results/page.tsx` (Server Component)

```ts
const project = await fetchProject(params.id)
const modelGlbUrl = absoluteModelUrl(project.model?.normalized_glb_url)
// Passes modelGlbUrl + project.latest_job_id to HeatmapViewer
```

**File:** `frontend/components/three/HeatmapViewer.tsx` (Client Component)

### Polling job status
```ts
useQuery(queries.analysisStatus(jobId))   // GET /api/analysis/{jobId}/status
// polls until status === "completed"
```

### Fetching results
```ts
useQuery(queries.analysisResults(jobId))  // GET /api/analysis/{jobId}/results
// Backend reads storage/{project_id}/analysis/{job_id}/results.json
// Returns AnalysisResultOut (heatmap_cells, statistics, unit, …)
```

### Building the heatmap mesh
```ts
// buildHeatmapMesh(cells, minV, maxV)  in HeatmapViewer.tsx
// Each HeatmapCell has 4 corners → 2 triangles → BufferGeometry
// Custom attribute "cellIdx" stores cell index per vertex for raycaster
const geo = new THREE.BufferGeometry()
geo.setAttribute('position', ...)
geo.setAttribute('color', ...)    // valueToColor(value, minV, maxV)
geo.setAttribute('cellIdx', ...)  // for click-to-inspect
```

### Rendering
- Building mesh (gray `MeshStandardMaterial`) — always shown
- Heatmap quad mesh — shown only in `heatmap` view mode, rendered as a SEPARATE mesh
  overlaid on top of the building (offset 0.02 m along face normals)
- Color legend: uses non-zero values from `heatmap_cells` (not `statistics.min/max`)
- Click-to-inspect: raycaster hits heatmap mesh → reads `cellIdx` → floating pin with value

---

## Known Pitfalls & Debugging Checklist

| Symptom | Likely cause | Where to look |
|---|---|---|
| Upload fails with network error | `NEXT_PUBLIC_FASTAPI_URL` missing/wrong | `.env` |
| GLB loads in upload preview but 404 in results | `PUBLIC_API_URL` not set → relative URL + missing `NEXT_PUBLIC_FASTAPI_URL` | `backend/app/schemas/model.py:36`, `results/page.tsx:14` |
| Job stays "queued" forever | Celery worker not running, or Redis unreachable | `docker compose logs worker` |
| Job fails: "No Radiance installation was found" | `AssertionError` not caught in `_run_annual` (fixed in `solar_engine.py:113`) | `solar_engine.py:113` |
| Job fails: "No Radiance" even after fix | Worker image not rebuilt after the fix | `docker compose build worker && docker compose up -d worker` |
| Heatmap renders but all one color | All values identical (synthetic) or min==max | Check `_synthetic` flag in results JSON |
| Heatmap mesh invisible | `heatmap_cells` list empty | Check `surface_filter` — may have excluded all faces |
| GLB face_count = 0 | GLB/GLTF uploaded — parser skips trimesh, stores raw bytes with stub metadata | `model_parser.py:21-30` |
| OBJ/STL face_count = 0 | trimesh conversion failed, raw bytes stored as fallback | `model_parser.py:70-80` |
| Worker can't read GLB from storage | Storage path mismatch between API and worker (both need same `storage/` mount) | `docker-compose.yml` volume mounts |

---

## Key Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `NEXT_PUBLIC_FASTAPI_URL` | Frontend (browser) | Upload XHR target + model download URL base |
| `FASTAPI_INTERNAL_URL` | Frontend (server-side) | Server Component `fetch` to backend (Docker network) |
| `PUBLIC_API_URL` | Backend schema | Prefixes `normalized_glb_url` (leave empty for relative URLs) |
| `DATABASE_URL` | Backend + Worker | Must use same host (e.g. `postgres:5432` in Docker) |
| `CELERY_BROKER_URL` | Backend + Worker | Redis broker |

---

## Data Flow: Key Objects

```
Model3D (DB)
  id, normalized_glb_path = "storage/{pid}/model.glb"

Project (DB)
  model_id → Model3D.id
  placement = { latitude, longitude, … }
  latest_job_id → AnalysisJob.id

AnalysisJob (DB)
  config = { mode, epw_station_id, surface_filter, … }
  result_path = "storage/{pid}/analysis/{jid}/results.json"
  status = queued | running | completed | failed

results.json
  heatmap_cells: [ { position, normal, value, face_id, corners[4] }, … ]
  statistics: { min, max, avg, total }
  unit: "kWh/m²" | "W/m²"
  panel_zones: [ { centroid, avg_irradiance, area_m2, … }, … ]
```
