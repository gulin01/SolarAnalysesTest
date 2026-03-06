"""
Solar irradiance analysis engine using ladybug-radiance RadiationStudy.
No Radiance binary installation required — all computation is Python/NumPy.

Pipeline:
  1. Load GLB mesh with trimesh
  2. Filter faces by surface_filter (all / roofs / walls) or selected_face_ids
  3. Build Ladybug Mesh3D from selected faces
  4. Run RadiationStudy → one value per selected face
  5. Build heatmap_cells (quads) for frontend overlay rendering
  6. Return sensor_points + heatmap_cells + irradiance_values (full mesh, non-selected = 0)

The heatmap is rendered as a SEPARATE quad mesh in the frontend,
NOT as vertex colours on the building mesh.
"""
import logging
import math
import sys
import tempfile
from pathlib import Path
from typing import Callable
import numpy as np

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_analysis(
    glb_bytes: bytes,
    placement: dict,
    config: dict,
    epw_path: str,
    progress_cb: Callable[[float, str], None],
) -> dict:
    """
    Run solar analysis. Dispatches to annual (kWh/m²) or hourly (W/m²) mode.
    Returns a dict containing heatmap_cells, sensor_points, irradiance_values, statistics.
    """
    mode = config.get("mode", "annual")
    progress_cb(5, "Preparing geometry")

    try:
        import trimesh
    except ImportError as e:
        return _synthetic_result(None, placement, config, str(e), n=500)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        glb_file = tmpdir / "model.glb"
        glb_file.write_bytes(glb_bytes)
        scene = trimesh.load(str(glb_file))
        mesh = scene.dump(concatenate=True) if isinstance(scene, trimesh.Scene) else scene
        if not _is_triangulated(mesh):
            try:
                mesh = mesh.triangulate()
            except AttributeError:
                pass

        face_count = len(mesh.faces)

        try:
            from ladybug.epw import EPW  # noqa: F401

            progress_cb(15, "Loading weather data")
            epw = EPW(epw_path)

            progress_cb(25, "Building sensor grid")
            up = _detect_up_vector(mesh.face_normals)
            face_mask = _get_face_mask(mesh, config, up)
            logger.info(
                "Total faces: %d, Selected faces: %d, Surface filter: %s, Up: %s",
                face_count, int(face_mask.sum()),
                config.get("surface_filter", "all"), up.tolist(),
            )

            study_mesh, face_map = _build_study_mesh(mesh, face_mask)

            if mode == "hourly":
                return _run_hourly(
                    mesh, face_map, face_count, up,
                    epw, config, progress_cb
                )
            else:
                return _run_annual(
                    mesh, face_map, face_count,
                    epw, config, placement, progress_cb, study_mesh
                )

        except ImportError as e:
            logger.info(
                "Ladybug not available (%s); using synthetic irradiance for %d faces",
                e, face_count,
            )
            return _synthetic_result(mesh, placement, config, str(e), n=face_count)


# ---------------------------------------------------------------------------
# Annual / Hourly runners
# ---------------------------------------------------------------------------

def _run_annual(mesh, face_map, face_count,
                epw, config, placement, progress_cb, study_mesh):
    from ladybug.skymatrix import SkyMatrix
    from ladybug_radiance.study.radiation import RadiationStudy

    north_angle = float(config.get("north_angle", 0))
    progress_cb(40, "Building sky matrix")
    sky_mtx = SkyMatrix.from_epw(epw)
    sky_mtx.north = north_angle

    progress_cb(55, "Running annual radiation study")
    study = RadiationStudy(
        sky_matrix=sky_mtx,
        study_mesh=study_mesh,
        offset_distance=float(config.get("sensor_height", 0.1)),
        by_vertex=False,
    )
    values_selected = np.array(study.radiation_values, dtype=np.float32)

    progress_cb(80, "Processing results")
    result_values = _expand_to_full_mesh(face_count, face_map, values_selected)

    study_points = study.study_points
    study_normals = study.study_normals
    sensor_points = _build_sensor_points(study_points, study_normals, values_selected)
    heatmap_cells = _build_heatmap_cells(mesh, face_map, values_selected)

    grid_points_full = mesh.triangles_center.astype(np.float32)
    panel_zones = _identify_panel_zones(
        grid_points_full, mesh.face_normals.astype(np.float32),
        result_values, mesh, placement, config
    )

    min_v, max_v, avg_v = _stats(result_values)
    progress_cb(100, "Complete")
    return {
        "mode": "annual",
        "grid_points": grid_points_full.tolist(),
        "irradiance_values": result_values.tolist(),
        "sensor_points": sensor_points,
        "heatmap_cells": heatmap_cells,
        "statistics": {"min": min_v, "max": max_v, "avg": avg_v, "total": float(np.sum(result_values))},
        "unit": "kWh/m²",
        "panel_zones": panel_zones,
        "surface_filter": config.get("surface_filter", "all"),
    }


def _run_hourly(mesh, face_map, face_count, up,
                epw, config, progress_cb):
    from ladybug.sunpath import Sunpath

    analysis_date = config.get("analysis_date", "2024-06-21")
    analysis_hour = int(config.get("analysis_hour", 12))
    parts = analysis_date.split("-")
    month, day = int(parts[1]), int(parts[2])

    progress_cb(40, f"Computing solar position for {analysis_date} {analysis_hour:02d}:00")
    sp = Sunpath(epw.location.latitude, epw.location.longitude)
    sun = sp.calculate_sun(month, day, analysis_hour)
    sun_position = {
        "altitude_deg": float(sun.altitude),
        "azimuth_deg": float(sun.azimuth),
        "is_above_horizon": sun.altitude > 0,
    }

    hoy = _date_to_hoy(month, day, analysis_hour)
    hoy_idx = min(hoy, 8759)
    weather_at_hour = {
        "temperature_c": float(epw.dry_bulb_temperature[hoy_idx]),
        "dni": float(epw.direct_normal_radiation[hoy_idx]),
        "dhi": float(epw.diffuse_horizontal_radiation[hoy_idx]),
        "wind_speed": float(epw.wind_speed[hoy_idx]),
    }

    progress_cb(60, "Computing instantaneous irradiance")
    face_normals_selected = mesh.face_normals[face_map].astype(np.float64)
    values_selected = _synthetic_hourly_irradiance(face_normals_selected, sun, weather_at_hour, up)

    result_values = _expand_to_full_mesh(face_count, face_map, values_selected)
    face_centers_selected = mesh.triangles_center[face_map].astype(np.float32)
    sensor_points = [
        {"position": c.tolist(), "normal": n.tolist(), "value": float(v)}
        for c, n, v in zip(face_centers_selected, face_normals_selected, values_selected)
    ]
    heatmap_cells = _build_heatmap_cells(mesh, face_map, values_selected)

    min_v, max_v, avg_v = _stats(result_values)
    progress_cb(100, "Complete")
    return {
        "mode": "hourly",
        "grid_points": mesh.triangles_center.astype(np.float32).tolist(),
        "irradiance_values": result_values.tolist(),
        "sensor_points": sensor_points,
        "heatmap_cells": heatmap_cells,
        "statistics": {"min": min_v, "max": max_v, "avg": avg_v, "total": float(np.sum(result_values))},
        "unit": "W/m²",
        "panel_zones": [],
        "sun_position": sun_position,
        "weather_at_hour": weather_at_hour,
        "analysis_date": analysis_date,
        "analysis_hour": analysis_hour,
        "surface_filter": config.get("surface_filter", "all"),
    }


# ---------------------------------------------------------------------------
# Face mask / surface filter
# ---------------------------------------------------------------------------

def _get_face_mask(mesh, config: dict, up: np.ndarray) -> np.ndarray:
    """Return boolean mask of which faces to simulate."""
    n_faces = len(mesh.faces)
    selected_ids = config.get("selected_face_ids")
    if selected_ids:
        mask = np.zeros(n_faces, dtype=bool)
        for idx in selected_ids:
            if 0 <= idx < n_faces:
                mask[idx] = True
        return mask

    surface_filter = config.get("surface_filter", "all")
    normals = mesh.face_normals
    up_dot = normals @ up

    if surface_filter == "roofs":
        return up_dot > 0.7
    elif surface_filter == "walls":
        return np.abs(up_dot) < 0.3
    else:
        # "all" — exclude faces pointing straight down (floor undersides)
        return up_dot > -0.9


# ---------------------------------------------------------------------------
# Ladybug study mesh
# ---------------------------------------------------------------------------

def _build_study_mesh(trimesh_mesh, face_mask):
    """Convert selected trimesh faces → Ladybug Mesh3D. Returns (Mesh3D, face_map)."""
    from ladybug_geometry.geometry3d.mesh import Mesh3D
    from ladybug_geometry.geometry3d.pointvector import Point3D

    original_indices = np.where(face_mask)[0]
    selected_faces = trimesh_mesh.faces[original_indices]

    unique_verts_idx = np.unique(selected_faces.flatten())
    vert_remap = {old: new for new, old in enumerate(unique_verts_idx)}

    vertices = [
        Point3D(float(v[0]), float(v[1]), float(v[2]))
        for v in trimesh_mesh.vertices[unique_verts_idx]
    ]
    faces = [tuple(vert_remap[v] for v in face) for face in selected_faces]
    mesh3d = Mesh3D(vertices, faces)
    return mesh3d, original_indices.tolist()


# ---------------------------------------------------------------------------
# Heatmap cells (quads for frontend overlay)
# ---------------------------------------------------------------------------

def _build_heatmap_cells(trimesh_mesh, face_map: list, values: np.ndarray) -> list:
    """
    Build heatmap cell quads for frontend visualization.
    Each cell is a small quad centered on the triangle face, slightly offset above the surface.
    """
    cells = []
    for local_i, orig_idx in enumerate(face_map):
        face_verts = trimesh_mesh.vertices[trimesh_mesh.faces[orig_idx]]
        center = face_verts.mean(axis=0)
        normal = trimesh_mesh.face_normals[orig_idx]
        corners = _compute_cell_corners(face_verts, center, normal)
        cells.append({
            "position": center.tolist(),
            "normal": normal.tolist(),
            "value": float(values[local_i]),
            "face_id": int(orig_idx),
            "corners": [c.tolist() for c in corners],
        })
    return cells


def _compute_cell_corners(face_verts: np.ndarray, center: np.ndarray, normal: np.ndarray):
    """
    Compute 4 quad corners for a heatmap cell.
    For a triangle face, we use the face's actual bounding extent to size the quad.
    The quad is offset 0.02 m along the normal to prevent z-fighting.
    """
    normal = normal / (np.linalg.norm(normal) or 1.0)

    # Tangent: perpendicular to normal, lying on the face
    if abs(np.dot(normal, [0.0, 0.0, 1.0])) < 0.99:
        tangent = np.cross(normal, [0.0, 0.0, 1.0])
    else:
        tangent = np.cross(normal, [1.0, 0.0, 0.0])
    tangent /= np.linalg.norm(tangent) or 1.0
    bitangent = np.cross(normal, tangent)
    bitangent /= np.linalg.norm(bitangent) or 1.0

    # Size the quad to cover the triangle's face footprint
    projected_t = face_verts @ tangent
    projected_b = face_verts @ bitangent
    half_t = (projected_t.max() - projected_t.min()) * 0.5 + 0.01
    half_b = (projected_b.max() - projected_b.min()) * 0.5 + 0.01

    offset_center = center + normal * 0.02
    return [
        offset_center - tangent * half_t - bitangent * half_b,
        offset_center + tangent * half_t - bitangent * half_b,
        offset_center + tangent * half_t + bitangent * half_b,
        offset_center - tangent * half_t + bitangent * half_b,
    ]


def _build_sensor_points(study_points, study_normals, values: np.ndarray) -> list:
    return [
        {
            "position": [float(pt.x), float(pt.y), float(pt.z)],
            "normal": [float(n.x), float(n.y), float(n.z)],
            "value": float(v),
        }
        for pt, n, v in zip(study_points, study_normals, values)
    ]


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------

def _expand_to_full_mesh(face_count: int, face_map: list, values: np.ndarray) -> np.ndarray:
    """Expand selected-face values to full mesh; non-selected faces = 0."""
    full = np.zeros(face_count, dtype=np.float32)
    full[face_map] = np.asarray(values, dtype=np.float32)
    return full


def _stats(values: np.ndarray):
    if len(values) == 0:
        return 0.0, 0.0, 0.0
    return float(np.min(values)), float(np.max(values)), float(np.mean(values))


# ---------------------------------------------------------------------------
# Up-vector detection
# ---------------------------------------------------------------------------

def _detect_up_vector(face_normals: np.ndarray) -> np.ndarray:
    """Auto-detect Y-up (glTF) vs Z-up (OBJ/STL) from face normals."""
    normals = np.asarray(face_normals, dtype=np.float64)
    y_up = np.array([0.0, 1.0, 0.0])
    z_up = np.array([0.0, 0.0, 1.0])
    y_count = int(np.sum(normals @ y_up > 0.5))
    z_count = int(np.sum(normals @ z_up > 0.5))
    chosen = y_up if y_count > z_count else z_up
    logger.info(
        "Up-vector detection: Y-up=%d  Z-up=%d  → %s",
        y_count, z_count, "Y-up" if y_count > z_count else "Z-up",
    )
    return chosen


# ---------------------------------------------------------------------------
# Hourly synthetic (used when Ladybug is available but RadiationStudy is hourly)
# ---------------------------------------------------------------------------

def _synthetic_hourly_irradiance(
    grid_normals: np.ndarray, sun, weather: dict, up: np.ndarray
) -> np.ndarray:
    if sun.altitude <= 0:
        return np.zeros(len(grid_normals), dtype=np.float32)

    alt_rad = math.radians(sun.altitude)
    az_rad = math.radians(sun.azimuth)

    up_f = np.asarray(up, dtype=np.float64)
    north_hint = np.array([0.0, 0.0, 1.0]) if up_f[2] < 0.9 else np.array([0.0, 1.0, 0.0])
    east = np.cross(north_hint, up_f)
    east /= np.linalg.norm(east) or 1.0
    north = np.cross(up_f, east)
    north /= np.linalg.norm(north) or 1.0

    horiz = math.cos(alt_rad)
    sun_dir = (
        north * horiz * math.cos(az_rad)
        + east * horiz * math.sin(az_rad)
        + up_f * math.sin(alt_rad)
    )

    dni = weather.get("dni", 600.0)
    dhi = weather.get("dhi", 100.0)
    cos_inc = np.clip(grid_normals @ sun_dir, 0, 1)
    irradiance = dni * cos_inc + dhi * 0.5
    noise = np.random.normal(0, 10, len(grid_normals))
    return np.clip(irradiance + noise, 0, 1200).astype(np.float32)



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_triangulated(mesh) -> bool:
    return mesh.faces.shape[1] == 3 and np.all(mesh.faces >= 0)


def _date_to_hoy(month: int, day: int, hour: int) -> int:
    days_per_month = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    day_of_year = sum(days_per_month[:month]) + day - 1
    return day_of_year * 24 + hour


# ---------------------------------------------------------------------------
# Panel zones
# ---------------------------------------------------------------------------

def _identify_panel_zones(grid_points, grid_normals, values, mesh, placement, config):
    threshold = config.get("min_irradiance", 900)
    high_mask = values >= threshold
    up = np.array([0.0, 0.0, 1.0])
    tilt_angles = np.degrees(np.arccos(np.clip(grid_normals @ up, -1, 1)))
    tilt_mask = (tilt_angles >= 15) & (tilt_angles <= 35)
    candidate_mask = high_mask & tilt_mask
    candidate_indices = np.where(candidate_mask)[0]
    if len(candidate_indices) == 0:
        threshold_percentile = np.percentile(values, 80)
        candidate_indices = np.where(values >= threshold_percentile)[0]

    PANEL_AREA = 1.65
    zones = []
    for i, idx in enumerate(candidate_indices[:20]):
        area = float(mesh.area_faces[idx]) if idx < len(mesh.area_faces) else 2.5
        n = grid_normals[idx]
        tilt = float(np.degrees(np.arccos(np.clip(n @ up, -1, 1))))
        azimuth = float(math.degrees(math.atan2(n[0], n[1])) % 360)
        irr = float(values[idx])
        panel_count = max(1, int(area / PANEL_AREA))
        yield_kwh = irr * area * 0.2
        zones.append({
            "id": i,
            "face_indices": [int(idx)],
            "centroid": grid_points[idx].tolist(),
            "avg_irradiance": irr,
            "area_m2": area,
            "tilt_deg": tilt,
            "azimuth_deg": azimuth,
            "estimated_annual_yield_kwh": yield_kwh,
            "panel_count_estimate": panel_count,
        })
    return zones


# ---------------------------------------------------------------------------
# Synthetic fallback (when Ladybug unavailable)
# ---------------------------------------------------------------------------

def _synthetic_result(mesh, _placement: dict, config: dict, reason: str, n: int = 500) -> dict:
    """
    Return plausible synthetic results. If mesh is provided, builds real heatmap_cells.
    n = real face count so frontend value/triangle counts match.
    """
    np.random.seed(42)
    mode = config.get("mode", "annual")
    surface_filter = config.get("surface_filter", "all")

    heatmap_cells = []
    sensor_points = []

    if mesh is not None:
        try:
            up = _detect_up_vector(mesh.face_normals)
            face_mask = _get_face_mask(mesh, config, up)
            face_map = np.where(face_mask)[0].tolist()
            n_selected = len(face_map)
            if mode == "hourly":
                sel_values = np.random.uniform(0, 800, n_selected).astype(np.float32)
            else:
                sel_values = np.random.uniform(300, 1500, n_selected).astype(np.float32)

            full_values = _expand_to_full_mesh(n, face_map, sel_values)
            heatmap_cells = _build_heatmap_cells(mesh, face_map, sel_values)
            face_centers = mesh.triangles_center[face_map].astype(np.float32)
            face_normals = mesh.face_normals[face_map]
            sensor_points = [
                {"position": c.tolist(), "normal": nr.tolist(), "value": float(v)}
                for c, nr, v in zip(face_centers, face_normals, sel_values)
            ]
        except Exception as e:
            logger.debug("Could not build synthetic heatmap_cells: %s", e)
            full_values = np.random.uniform(300, 1500, n).astype(np.float32)
    else:
        full_values = np.random.uniform(300, 1500, n).astype(np.float32)

    grid_points = np.random.uniform(-5, 5, (n, 3)).tolist()
    min_v, max_v, avg_v = _stats(full_values)

    if mode == "hourly":
        analysis_hour = config.get("analysis_hour", 12)
        return {
            "mode": "hourly",
            "grid_points": grid_points,
            "irradiance_values": full_values.tolist(),
            "sensor_points": sensor_points,
            "heatmap_cells": heatmap_cells,
            "statistics": {"min": min_v, "max": max_v, "avg": avg_v, "total": float(np.sum(full_values))},
            "unit": "W/m²",
            "panel_zones": [],
            "sun_position": {"altitude_deg": 45.0, "azimuth_deg": 180.0, "is_above_horizon": 6 <= analysis_hour <= 18},
            "weather_at_hour": {"temperature_c": 22.0, "dni": 600.0, "dhi": 100.0, "wind_speed": 3.0},
            "analysis_date": config.get("analysis_date", "2024-06-21"),
            "analysis_hour": analysis_hour,
            "surface_filter": surface_filter,
            "_synthetic": True,
            "_reason": reason,
        }
    else:
        return {
            "mode": "annual",
            "grid_points": grid_points,
            "irradiance_values": full_values.tolist(),
            "sensor_points": sensor_points,
            "heatmap_cells": heatmap_cells,
            "statistics": {"min": min_v, "max": max_v, "avg": avg_v, "total": float(np.sum(full_values))},
            "unit": "kWh/m²",
            "panel_zones": [],
            "surface_filter": surface_filter,
            "_synthetic": True,
            "_reason": reason,
        }
