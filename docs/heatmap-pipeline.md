# SolarSight Heatmap Pipeline

End-to-end trace from model upload to coloured heatmap, including every
bug found by deep analysis and how each was fixed.
---
## 1. Model Upload & Normalisation
**File**: `backend/app/services/model_parser.py`
```
uploaded file (any format)
    │
    ▼  trimesh.load(force="mesh")
    │  scene.dump(concatenate=True)   ← multi-mesh → single Trimesh
    │  mesh.triangulate()             ← all faces become triangles
    │  mesh.apply_translation(...)    ← centre at origin
    ▼
single-mesh GLB  →  storage/{project_id}/model.glb
DB: Model3D.normalized_glb_path, face_count = len(mesh.faces) = N
```

**Critical invariant**: the stored GLB always has exactly one mesh primitive
with a flat triangulated index buffer.  N = face count is stable and must equal
`len(irradiance_values)` in the analysis result.

**Coordinate system note**: trimesh preserves the file's native coordinate
system on export.  GLB/glTF files are Y-up; OBJ/STL files are typically Z-up.
The exported GLB inherits whichever convention the source file used.

---

## 2. Analysis Worker — Sensor Grid Generation

**File**: `backend/app/services/solar_engine.py`

### Step 1 — Load mesh

```python
scene = trimesh.load("model.glb")
mesh  = scene.dump(concatenate=True) if isinstance(scene, trimesh.Scene) else scene
face_count = len(mesh.faces)   # N triangles
```

### Step 2 — Auto-detect world "up" axis  ← BUG A FIX

```python
# _detect_up_vector()
y_count = count of faces where dot(normal, [0,1,0]) > 0.5
z_count = count of faces where dot(normal, [0,0,1]) > 0.5
up = [0,1,0]  if y_count > z_count  else  [0,0,1]
```

**Bug A (old line 249)**:
```python
up = np.array([0, 0, 1])   # HARDCODED Z-UP — WRONG FOR GLB/glTF
```
GLB/glTF is Y-up.  For a Y-up building model:
- Roof normals ≈ [0,1,0] → `dot([0,1,0],[0,0,1]) = 0` → no roof detected
- Z-facing walls ≈ [0,0,1] → `dot = 1.0 > 0.7` → walls wrongly classified as roof

Result: wall faces received irradiance values; actual roof faces got 0.
Heatmap showed walls coloured, roofs dark — the exact opposite of correct.

### Step 3 — Detect roof faces (M faces, M ≤ N)

```python
# solar/geometry/roof_detection.py
dots = face_normals @ up            # one dot product per face
roof_indices = where(dots > 0.7)    # threshold ~45° from vertical
# roof_indices shape: (M,) — indices into the FULL mesh face array
```

### Step 4 — Extract roof submesh

```python
# solar/geometry/roof_mesh.py
mask = zeros(N, bool)
mask[roof_indices] = True
roof_mesh = mesh.submesh([mask], append=True)
# roof_mesh.faces[i]  corresponds to  mesh.faces[roof_indices[i]]
# Face ORDER is preserved by submesh — this 1-to-1 mapping is essential
```

### Step 5 — Generate sensor points

```python
# _build_roof_sensor_grid()
centroids   = roof_mesh.triangles_center   # (M, 3)
normals     = roof_mesh.face_normals       # (M, 3)
points_roof = centroids + normals * 0.1    # offset 0.1 m above surface
```

### Step 6 — Deduplicate sensors (M → K)

Flat roofs have many co-planar faces whose centroids collapse to the same
location.  Deduplication reduces M down to K unique positions (K ≤ M).

```python
# solar/utils/deduplicate_points.py
points_unique, idx, inv = deduplicate_points(
    points_roof, tolerance=1e-4, return_inverse=True, return_index=True
)
# points_unique shape: (K, 3)  — K unique sensor positions
# idx shape:           (K,)    — first-occurrence indices in points_roof
# inv shape:           (M,)    — inv[i] = unique-point index for roof face i
#                                satisfies: points_roof[i] ≈ points_unique[inv[i]]

normals_unique = normals[idx]   # (K, 3)
```

---

## 3. Irradiance Computation

### Annual mode — `_run_incident_radiation()`

**Bug B (old code)**:
```python
face_count = len(mesh.faces)   # mesh = roof_mesh → M faces  (WRONG)
if len(values) == face_count:  # Radiance returns K values; K ≤ M → always False
    return values               # Radiance results ALWAYS discarded silently
```
The function received `grid_points = points_unique` (K points), so Radiance
produced K output values.  The guard compared K against M, which fails whenever
any two centroids were deduped.  Radiance output was silently thrown away every
time and the synthetic fallback always ran.

**Fixed**:
```python
def _run_incident_radiation(tmpdir, grid_points, grid_normals, epw_path, up):
    sensor_count = len(grid_points)   # K — correct expected output length
    ...
    if len(values) == sensor_count:   # now matches Radiance output
        return values
    return _synthetic_irradiance(grid_points, grid_normals, up)
```

### `_synthetic_irradiance()` — annual fallback

**Bug C (old)**:
```python
sun_dir = np.array([0.3, 0.2, 0.9])  # Z-dominant — wrong for Y-up models
```
For a Y-up model, roof normals ≈ [0,1,0]:
`dot([0,1,0],[0.3,0.2,0.9]) ≈ 0.2` → roofs got low irradiance.
Z-facing walls [0,0,1]: `dot ≈ 0.9` → walls got high irradiance.
Heatmap inverted: walls bright, roofs dim.

**Fixed** — sun direction built relative to detected `up`:
```python
def _synthetic_irradiance(grid_points, grid_normals, up):
    horiz   = cross(up, perpendicular_hint)   # one horizontal axis
    sun_dir = 0.4*horiz + 0.9*up             # ~64° altitude
    sun_dir /= norm(sun_dir)
    cos_angles = clip(grid_normals @ sun_dir, 0, 1)
    return clip(1000 + 400*cos_angles + noise, 100, 1600)
```
Roofs (normal ≈ up) now correctly get high cos_angle → high irradiance.

### Hourly mode — `_synthetic_hourly_irradiance()`

**Bug D (old)**:
```python
sun_dir = [cos(alt)*sin(az), cos(alt)*cos(az), sin(alt)]  # Z-up assumed
```
For Y-up model the Z axis is *horizontal*, not up.  Sun altitude was mapped
to the wrong direction, giving physically wrong irradiance on Y-up models.

**Fixed** — north/east axes derived from `up`:
```python
def _synthetic_hourly_irradiance(grid_normals, sun, weather, up):
    east    = cross(north_hint, up);  east  /= norm(east)
    north   = cross(up, east);        north /= norm(north)
    sun_dir = north*cos(alt)*cos(az) + east*cos(alt)*sin(az) + up*sin(alt)
    cos_inc = clip(grid_normals @ sun_dir, 0, 1)
    return clip(DNI*cos_inc + DHI*0.5 + noise, 0, 1200)
```

---

## 4. Value Expansion — Roof → Full Mesh

```python
result_values_unique = _run_incident_radiation(...)  # K values

# K → M  (expand unique sensors back to all roof faces)
result_values_roof = result_values_unique[inv]        # M values
# result_values_roof[i] = irradiance for roof_mesh.faces[i]
#                       = irradiance for mesh.faces[roof_indices[i]]

# M → N  (expand roof faces back to full mesh)
irradiance_values = zeros(N)
irradiance_values[roof_indices] = result_values_roof
# roof face i  → irradiance_values[roof_indices[i]] = correct value  ✓
# wall/floor j → irradiance_values[j] = 0
```

Final array: **N values**, one per triangle of the full mesh, in GLB index-buffer order.

---

## 5. Result JSON

```json
{
  "irradiance_values": [0, 0, 1234.5, 987.2, 0, ...],
  "statistics":        {"min": 0, "max": 1456, "avg": 312, "total": ...},
  "unit":              "kWh/m²",
  "panel_zones":       [...]
}
```

`len(irradiance_values)` must equal `N` (the GLB triangle count).

---

## 6. Frontend Heatmap Rendering

**File**: `frontend/components/three/HeatmapViewer.tsx`

### Triangle count guard

```typescript
totalTriangleCount = sum of (index.count/3) across all mesh nodes
if (totalTriangleCount !== values.length) {
  // mismatch → show plain gray model, no heatmap
  console.warn('[HeatmapViewer] Face/value count mismatch')
}
```
Three.js and trimesh read the same GLB index buffer in the same order, so face
indices are identical when counts match.

### Colour mapping

**Bug E (old)**: `normalizeValues(values)` included zeros (walls) in min.
Walls normalized to 0.0 → deep blue.  Roof scale was compressed.

**Fixed**:
```typescript
const nonZero = values.filter(v => v > 0)
const minV = Math.min(...nonZero)
const maxV = Math.max(...nonZero)

for each face i:
  raw = irradiance_values[i]
  color = (raw === 0)
    ? [0.35, 0.35, 0.38]                    // neutral gray (wall/floor)
    : valueToRgb((raw - minV) / range)      // RdYlBu ramp (roof)
```

### Material setup

**Bug F (old)**: `mat.clone()` on original (often black) GLB material, then
`mat.vertexColors = true`.  Vertex colors multiply `material.color`; black
base → black output regardless of vertex colors.

**Bug G (old)**: No `side: DoubleSide`.  Trimesh exports frequently produce
inverted-normal faces which render black with default `FrontSide` culling.

**Fixed**:
```typescript
obj.material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  color: new THREE.Color(1, 1, 1),  // white — vertex colors render undimmed
  side: THREE.DoubleSide,           // handles inverted normals
})
```

---

## 7. Complete Bug Table

| ID | File | Old code / symptom | Effect on heatmap | Fix |
|----|------|--------------------|-------------------|-----|
| A | `solar_engine.py:249` | `up = [0,0,1]` hardcoded | Walls classified as roofs for Y-up GLB; heatmap on walls, not roofs | `_detect_up_vector()` auto-detects Y-up vs Z-up from face normals |
| B | `_run_incident_radiation` | `face_count = len(mesh.faces)` (M) not `len(grid_points)` (K) | Radiance output always discarded; synthetic always ran | `sensor_count = len(grid_points)` |
| C | `_synthetic_irradiance` | `sun_dir = [0.3, 0.2, 0.9]` (Z-up assumed) | Walls bright, roofs dim — inverted colours | Sun direction built from detected `up` |
| D | `_synthetic_hourly_irradiance` | `sun_dir` Z-component used as "up" | Wrong incidence angles for Y-up models | North/east axes derived from `up`; sun built in mesh space |
| E | `HeatmapViewer.tsx` | `normalizeValues()` included zeros | Walls coloured deep blue; roof scale compressed | Normalize only on `values.filter(v => v > 0)` |
| F | `HeatmapViewer.tsx` | `mat.clone()` + `vertexColors=true` on black material | All faces rendered black despite vertex colors | Fresh `MeshStandardMaterial({ color: white, vertexColors: true })` |
| G | `HeatmapViewer.tsx` | No `DoubleSide` on any material | Inverted-normal faces rendered black | `side: THREE.DoubleSide` everywhere |
| H | `_synthetic_result()` | Fixed `n=500` regardless of model | `values.length ≠ triangle count` → heatmap disabled | `n = face_count` from loaded mesh |
| I | `AnalysisForm.tsx` | `router.push()` in render body | React Router warning; navigation race | Moved to `useEffect` |

---

## 8. Debugging Checklist

### Worker logs
```bash
docker compose logs worker -f
```
Expected healthy output:
```
Up-vector detection: Y-up candidates=120  Z-up candidates=8  → using Y-up [0,1,0]
Total mesh faces: 1248, Roof faces: 312, Unique sensors: 289, Up-axis: [0.0, 1.0, 0.0]
```
- `Roof faces: 0` → up-vector wrong or threshold too high
- `Unique sensors = Roof faces` → no deduplication (model has no flat areas)

### Browser console (dev mode)
```
[HeatmapViewer] Triangles: 1248 | Values: 1248 | Roof faces: 312 | Range: 450 – 1432
```
- `Triangles ≠ Values` → old cached result; re-run analysis job
- `Roof faces: 0` → backend returned all zeros; check worker logs
- `Range: 0 – X` → min was zero (old E bug); ensure latest frontend is deployed
