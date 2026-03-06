# SolarSight: Analysis Pipeline & Heatmap Visualization

This document describes how the solar analysis pipeline works from model upload through heatmap rendering, to support diagnosing incorrect heatmap visualization.

---

## 1. Project Overview

### System Architecture

- **Frontend:** Next.js 14 (React), Mapbox GL for maps, React Three Fiber + Three.js + Drei for 3D and heatmap.
- **Backend:** FastAPI, PostgreSQL (SQLAlchemy async), Redis, Celery.
- **Storage:** Local filesystem under `backend/storage/` (no MinIO in current setup).
- **Solar engine:** Ladybug Tools (EPW, sunpath), optional Radiance via `lbt_recipes` (“annual-irradiance”); trimesh for mesh handling and grid generation.

### High-Level Flow

```
Upload 3D model → Store GLB → Place on map → Configure analysis → Celery task
    → Solar engine (grid + radiation) → results.json → Frontend fetches results
    → HeatmapViewer applies irradiance to mesh as vertex colors
```

---

## 2. Backend Analysis Pipeline

### Step 1: Model Upload

| What | Where |
|------|--------|
| API | `POST /api/models/upload` |
| Handler | `backend/app/api/models.py` → `upload_model` |
| Input | `file` (multipart), `project_id` (form) |
| Supported formats | GLB, GLTF, OBJ, STL, IFC |

**Flow:**

1. File is read and extension validated (`glb`, `gltf`, `obj`, `stl`, `ifc`).
2. **Conversion:** `app.services.model_parser.parse_and_convert(content, filename, ext)`:
   - **File:** `backend/app/services/model_parser.py`
   - **Function:** `_parse_sync` (called via `run_in_executor`):
     - Non-IFC: `trimesh.load(..., force="mesh")`; if Scene, `scene.dump(concatenate=True)`.
     - IFC: `_load_ifc(path)` (IfcOpenShell) → vertices/faces → `trimesh.Trimesh`.
   - **Normalization:** `mesh.apply_translation(-mesh.centroid)` (center at origin).
   - **Export:** `mesh.export(glb_path)` → single GLB.
3. **Storage:** `upload_bytes(orig_path, content)` and `upload_bytes(glb_path, glb_bytes)` from `app.core.storage`:
   - Original: `storage/{project_id}/original.{ext}`
   - GLB: `storage/{project_id}/model.glb`
4. **DB:** New `Model3D` row with `original_file_path`, `normalized_glb_path`, face/vertex counts, bounding box, etc.

The frontend then calls `PATCH /projects/{project_id}` with `model_id: model.id` and `current_step: 'place'` (see `frontend/components/upload/UploadDropzone.tsx`).

### Step 2: Analysis Job Creation

| What | Where |
|------|--------|
| API | `POST /api/analysis/run` |
| Handler | `backend/app/api/analysis.py` → `run_analysis` |
| Schema | `AnalysisRunRequest`: `project_id`, `epw_station_id`, `grid_resolution`, `ground_reflectance`, `mode` ("annual" \| "hourly"), optional `analysis_date`, `analysis_hour` |

**Flow:**

1. Load project; require `project.model_id`.
2. Build `config` dict from request (epw_station_id, mode, grid_resolution, ground_reflectance, and for hourly: analysis_date, analysis_hour).
3. Create `AnalysisJob` (status `"queued"`, `config` JSON), commit, refresh.
4. Set `project.latest_job_id = job.id`, `project.current_step = "results"`, commit.
5. Enqueue Celery task: `run_solar_analysis.delay(job.id)`.

### Step 3: Celery Task Execution

| What | Where |
|------|--------|
| Task | `app.tasks.analysis_task.run_solar_analysis` |
| File | `backend/app/tasks/analysis_task.py` |
| Bind | `@celery_app.task(bind=True, name="app.tasks.analysis_task.run_solar_analysis")` |

**Flow:**

1. Mark job `status="running"`, `progress=1`, `progress_message="Starting solar analysis"` via `_sync_update_job`.
2. **Fetch job data:** `_fetch_job_data(job_id)` → `_async_fetch_job_data`:
   - Loads `AnalysisJob`, `Project`, `Model3D`; returns job config, project placement + `project_id`, and `normalized_glb_path`.
3. **Download GLB:** `download_bytes(model_data["normalized_glb_path"])` from local storage.
4. **EPW path:** `_get_epw_path(config["epw_station_id"])` → `/tmp/epw_cache/{station_id}.epw` (may not exist; engine falls back to synthetic).
5. **Run solar engine:** `run_analysis(glb_bytes, placement, config, epw_path, progress_cb)` (see below).
6. **Save results:** `result_path = f"storage/{project_id}/analysis/{job_id}/results.json"`, `upload_bytes(result_path, result_json)`.
7. Update job: `status="completed"`, `progress=100`, `result_path`, `completed_at`.

### Step 4: Solar Analysis Engine

| What | Where |
|------|--------|
| Entry | `backend/app/services/solar_engine.run_analysis` |
| File | `backend/app/services/solar_engine.py` |

**Flow:**

1. Write `glb_bytes` to `tmpdir/model.glb`, load with trimesh: `scene = trimesh.load(...)`, `mesh = scene.dump(concatenate=True)` if Scene.
2. Load EPW: `EPW(epw_path)`.
3. **Sensor grid:** `_create_sensor_grid(mesh, config["grid_resolution"])`:
   - **Function:** `_create_sensor_grid(mesh, resolution)` (lines 175–179).
   - **Implementation:** `grid_points = mesh.triangles_center`, `grid_normals = mesh.face_normals`.
   - **Note:** One point and one normal per **triangle face**; `resolution` is not used (grid is per-face, not a subsampled grid).
4. **Dispatch by mode:**
   - **Annual:** `_run_annual` → `_run_incident_radiation` → then `_identify_panel_zones`.
   - **Hourly:** `_run_hourly` → `_synthetic_hourly_irradiance` (sun position + DNI/DHI at hour).

#### Radiation Computation

- **Annual (real path):** `_run_incident_radiation`:
  - Uses `lbt_recipes.recipe.Recipe("annual-irradiance")` with `model` (path to tmp GLB), `epw`, `grid-filter="*"`.
  - Runs recipe to `tmpdir/radiance_run`, then reads first `*.res` file with `np.loadtxt`.
  - **Critical:** The recipe generates its **own** sensor grid internally; it does **not** use the trimesh `grid_points`/`grid_normals` from `_create_sensor_grid`. So the **order** of values in the `.res` file is determined by Ladybug/Radiance, not by trimesh face order.
- **Annual (fallback):** If the recipe fails, `_synthetic_irradiance(grid_points, grid_normals)` is used; this **is** aligned with trimesh (one value per face, same order as `mesh.triangles_center`).
- **Hourly:** `_synthetic_hourly_irradiance(grid_normals, sun, weather)` returns one value per face, same order as `grid_normals` (trimesh face order).

#### Result Structure (returned dict)

- `mode`, `grid_points` (list of [x,y,z]), `irradiance_values` (list of float), `statistics` (min, max, avg, total), `unit` ("kWh/m²" or "W/m²"), `panel_zones` (annual only).
- Hourly adds: `sun_position`, `weather_at_hour`, `analysis_date`, `analysis_hour`.

### Step 5: Saving Analysis Outputs

| What | Where |
|------|--------|
| Path | `storage/{project_id}/analysis/{job_id}/results.json` |
| Written by | `backend/app/tasks/analysis_task.run_solar_analysis` |
| Content | JSON of the result dict plus `job_id` |

No separate mesh or GLB is produced for analysis; the same uploaded GLB is used for both analysis and visualization.

---

## 3. File Storage

| Content | Path (relative to backend root) |
|--------|----------------------------------|
| Original upload | `storage/{project_id}/original.{ext}` |
| Normalized GLB | `storage/{project_id}/model.glb` |
| Analysis result | `storage/{project_id}/analysis/{job_id}/results.json` |

Storage implementation: `backend/app/core/storage.py` (`upload_bytes`, `download_bytes`, `delete_object`). Base directory is `Path(__file__).resolve().parent.parent.parent` (backend root).

---

## 4. Data Flow (Backend → Frontend)

### Results API

| What | Where |
|------|--------|
| Endpoint | `GET /api/analysis/{job_id}/results` |
| Handler | `backend/app/api/analysis.py` → `get_results` |
| Response | `AnalysisResultOut` (Pydantic) |

**Handler logic:** Load job and project; require `job.status == "completed"` and project ownership. Read `job.result_path` via `download_bytes`, parse JSON, return `AnalysisResultOut(**json.loads(raw))`.

**Schema** (`backend/app/schemas/analysis.py`): `job_id`, `mode`, `grid_points`, `irradiance_values`, `statistics`, `panel_zones`, `unit`, plus optional hourly fields.

### Frontend Fetching

| What | Where |
|------|--------|
| Client | `frontend/lib/api.ts` |
| Query | `queries.analysisResults(jobId)` → `queryKey: ['analysis', jobId, 'results']`, `queryFn: () => apiClient.get<AnalysisResult>(\`/analysis/${jobId}/results\`)` |
| Base URL | `NEXT_PUBLIC_FASTAPI_URL` (or `FASTAPI_INTERNAL_URL` server-side) |

Results page gets `latestJobId` from `project.latest_job_id` (from `fetchProject`) and passes it to `HeatmapViewer`; the viewer uses `useQuery(queries.analysisResults(latestJobId))` to load results.

---

## 5. Heatmap Rendering

### Component and 3D Model

| What | Where |
|------|--------|
| Results page | `frontend/app/projects/[id]/results/page.tsx` |
| Viewer | `frontend/components/three/HeatmapViewer.tsx` |
| Model loading | Same GLB URL as in placement step: `absoluteModelUrl(project.model?.normalized_glb_url)` |

When there is a `latestJobId`, the viewer renders `HeatmapMesh` with `modelUrl={modelGlbUrl}` and `jobId={latestJobId}`. The mesh is loaded with `useGLTF(modelUrl)` (Drei); the scene is cloned and then colored in a `useMemo` using `results.irradiance_values`.

### How Radiation Values Are Applied

| What | Where |
|------|--------|
| Logic | `HeatmapViewer.tsx` → `HeatmapMesh` → `useMemo` building `coloredScene` |
| Mechanism | **Vertex colors** (per-vertex RGB attribute + `vertexColors: true` on material) |

**Exact logic (lines 25–53):**

1. `results.irradiance_values` is normalized to [0, 1] via `normalizeValues(values)` from `frontend/lib/colorRamp.ts` (min–max linear).
2. A single global `pointIndex` is used across all meshes in the scene.
3. For each `THREE.Mesh` in `clone.traverse(...)`:
   - For each **vertex** in `geo.attributes.position` (count = vertex count):
     - Color = `valueToRgb(normalized[pointIndex % normalized.length])`
     - Write RGB into a `Float32Array` (0–1), set as `geo.setAttribute('color', ...)`.
     - `pointIndex++`.
4. Material: `mat.vertexColors = true`, so the mesh uses the vertex color attribute.

So the frontend maps **one value per vertex** by indexing into `normalized` with a **global vertex index** (wrapping with `% normalized.length`). The backend, in contrast, produces **one value per face** (`grid_points` = triangle centroids, same length as `irradiance_values`).

### Color Ramp

| What | Where |
|------|--------|
| File | `frontend/lib/colorRamp.ts` |
| Ramp | RdYlBu: blue (low) → yellow (mid) → red (high); `valueToRgb(t)` for `t ∈ [0,1]` |

---

## 6. Radiation vs Geometry: Where the Mismatch Comes From

### Backend

- **Grid:** One sensor per **face** (trimesh triangle): `grid_points = mesh.triangles_center`, `grid_normals = mesh.face_normals`.
- **Values:** `irradiance_values[i]` corresponds to face `i` (trimesh face order) **only** when using:
  - `_synthetic_irradiance` (annual fallback), or
  - `_synthetic_hourly_irradiance` (hourly).
- When the **Radiance recipe** is used (annual), the `.res` file order is **not** guaranteed to match trimesh face order, because the recipe builds its own grid from the model.

### Frontend

- Applies color **per vertex**.
- Uses a **single running index** over all vertices of all meshes and maps `normalized[pointIndex % normalized.length]` to each vertex.
- So it implicitly assumes either:
  - Same number of vertices as values (and some unknown vertex↔value mapping), or
  - A cyclic reuse of the value array over vertices.

### Consequences

1. **Face vs vertex:** Backend has one value per **face**; frontend colors **vertices**. So even with perfect ordering, three vertices of a triangle would ideally share one value (face color); the current code gives each vertex a value by global vertex index, which does not match face-based data.
2. **Vertex count ≠ face count:** In a triangulated mesh, vertices are shared; typically `vertex_count ≈ face_count / 2` or similar. So `pointIndex % normalized.length` cycles through a face-sized array over a different-sized vertex set, causing wrong pairing.
3. **Recipe grid order:** For annual runs using Radiance, the order of `irradiance_values` may not match trimesh face order, so even a face-based visualization could be wrong unless the recipe’s grid order is documented and matched.

These are the main reasons the heatmap can look incorrect: **face-based data** and **vertex-based coloring** with a **global vertex index** and no face/vertex correspondence.

---

## 7. Potential Issues (Checklist)

- **Grid/value order (Radiance path):** Annual results from `lbt_recipes` may have a different sensor order than `mesh.triangles_center`; values would then be misaligned with faces.
- **Face vs vertex:** Backend outputs per-face values; frontend applies per-vertex colors with a global vertex index → no correct 1:1 mapping.
- **Multiple meshes:** Scene may contain multiple meshes; the single global `pointIndex` concatenates all vertices; value array length is total face count (one mesh) or sum of face counts (concatenated). So multi-mesh or merged mesh can further desync.
- **Normalization:** `normalizeValues` is min–max over the full array; one bad value can compress the ramp; consider robust scaling or clamping.
- **Empty or failed job:** If job fails or result is missing, `GET /api/analysis/{job_id}/results` returns 404; viewer should handle no/latest job and loading state (results page and HeatmapViewer already guard on `latestJobId` and `results`).

---

## 8. Debugging Guide

### 1. Confirm model and storage

- Check that the project has a model: `project.model_id` and `project.model` with a valid `normalized_glb_url`.
- Check that `storage/{project_id}/model.glb` exists and is a valid GLB (e.g. open in a 3D viewer).

### 2. Confirm analysis job and result file

- In DB: `analysis_jobs` row for the job has `status = 'completed'` and `result_path` set.
- On disk: `storage/{project_id}/analysis/{job_id}/results.json` exists.
- Open `results.json`: check that `grid_points` and `irradiance_values` have the same length; check `statistics` (min/max/avg) look reasonable.

### 3. Compare lengths

- Backend: number of faces in the GLB (trimesh: `len(mesh.faces)`). This should equal `len(grid_points)` and `len(irradiance_values)` when using synthetic or a grid that matches trimesh.
- Frontend: total vertex count across all meshes in the GLB scene (e.g. log `position.count` per mesh in `HeatmapMesh`). This will not equal face count; confirm this mismatch.

### 4. Verify value ordering (annual + Radiance)

- If using the recipe, run a small test: log or save the first N `grid_points` from the engine and the first N values from the recipe’s `.res` (or from the saved result). Compare with trimesh face order (e.g. first few `mesh.triangles_center`) to see if order matches.

### 5. Frontend coloring sanity check

- Temporarily map a single value to all vertices (e.g. `normalized[0]`) and confirm the whole model gets one color; then try mapping by face index if you have face indices per vertex (e.g. custom attribute or derived from geometry) to test face-based coloring.

### 6. Synthetic vs Radiance

- Force fallback: make the recipe fail (e.g. wrong EPW or missing Radiance); then `_synthetic_irradiance` runs and values are aligned with `grid_points`/face order. Compare heatmap quality and alignment with the Radiance path.

### Key file reference

| Purpose | File / function |
|--------|------------------|
| Upload & convert | `backend/app/api/models.py` → `upload_model`; `backend/app/services/model_parser.py` → `_parse_sync` |
| Analysis API | `backend/app/api/analysis.py` → `run_analysis`, `get_results` |
| Celery task | `backend/app/tasks/analysis_task.py` → `run_solar_analysis` |
| Grid + radiation | `backend/app/services/solar_engine.py` → `_create_sensor_grid`, `_run_incident_radiation`, `_run_annual`, `_run_hourly` |
| Result storage path | `backend/app/tasks/analysis_task.py` (result_path) |
| Fetch results | `frontend/lib/api.ts` → `queries.analysisResults` |
| Heatmap render | `frontend/components/three/HeatmapViewer.tsx` → `HeatmapMesh`, `useMemo` coloredScene |
| Color ramp | `frontend/lib/colorRamp.ts` → `normalizeValues`, `valueToRgb` |

---

## 9. Diagram: End-to-End Pipeline

```
[User] Upload file (OBJ/GLB/…)
    → POST /api/models/upload
    → model_parser._parse_sync: load → center → export GLB
    → storage: storage/{project_id}/original.{ext}, model.glb
    → DB: Model3D
    → PATCH /projects/{id}: model_id, current_step

[User] Place on map, then Configure analysis
    → POST /api/analysis/run
    → DB: AnalysisJob (queued), project.latest_job_id
    → Celery: run_solar_analysis.delay(job_id)

[Celery worker]
    → download_bytes(model.glb), _get_epw_path
    → solar_engine.run_analysis(glb_bytes, placement, config, epw_path, progress_cb)
        → trimesh load GLB → _create_sensor_grid(mesh)  [face centroids + normals]
        → annual: _run_incident_radiation (recipe or _synthetic_irradiance)
        → hourly: _synthetic_hourly_irradiance
        → return { grid_points, irradiance_values, statistics, … }
    → upload_bytes(storage/{project_id}/analysis/{job_id}/results.json)
    → DB: job status=completed, result_path

[Frontend] Results page
    → fetchProject(id) → project.latest_job_id, project.model
    → HeatmapViewer(modelGlbUrl, latestJobId)
    → useQuery(analysisResults(jobId)) → GET /api/analysis/{jobId}/results
    → useGLTF(modelGlbUrl) → clone scene
    → traverse meshes: for each vertex, color = valueToRgb(normalized[pointIndex % len])
    → vertex color attribute + vertexColors: true → render
```

This README should be enough to understand the current implementation and to track down why the heatmap visualization is incorrect; the main fix will involve aligning **face-based** backend data with either **face-based** or correctly **vertex-interpolated** coloring on the frontend, and (if using Radiance) ensuring the recipe’s result order matches the grid used for visualization.
