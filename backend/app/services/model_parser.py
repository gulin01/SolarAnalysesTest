"""
Multi-format 3D model parser.
Converts GLB / GLTF / OBJ / STL / IFC → canonical GLB + extracts metadata.
"""
import uuid
import asyncio
from pathlib import Path
import tempfile
import trimesh
import numpy as np


async def parse_and_convert(content: bytes, filename: str, ext: str) -> dict:
    """Run synchronous trimesh work in a thread pool to keep FastAPI non-blocking."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _parse_sync, content, filename, ext)


def _parse_sync(content: bytes, filename: str, ext: str) -> dict:
    model_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / filename
        src.write_bytes(content)

        if ext == "ifc":
            mesh, ifc_meta = _load_ifc(src)
        else:
            mesh = trimesh.load(str(src), force="mesh")
            ifc_meta = None

        # Ensure we have a single mesh
        if isinstance(mesh, trimesh.Scene):
            mesh = mesh.dump(concatenate=True)

        # Enforce triangulation so exported GLB has only triangles; solar analysis is per-face
        if hasattr(mesh, "triangulate"):
            mesh = mesh.triangulate()

        # Normalise: centre + scale to unit cube for preview
        mesh.apply_translation(-mesh.centroid)

        # Export to GLB
        glb_path = Path(tmpdir) / "model.glb"
        mesh.export(str(glb_path))
        glb_bytes = glb_path.read_bytes()

        bb = mesh.bounds
        face_count = len(mesh.faces)
        vertex_count = len(mesh.vertices)
        surface_area = float(mesh.area)

        return {
            "id": model_id,
            "glb_bytes": glb_bytes,
            "face_count": face_count,
            "vertex_count": vertex_count,
            "surface_area_m2": surface_area,
            "bounding_box": {
                "min": bb[0].tolist(),
                "max": bb[1].tolist(),
            },
            "ifc_metadata": ifc_meta,
        }


def _load_ifc(path: Path):
    """Load IFC via IfcOpenShell and return a trimesh + metadata dict."""
    try:
        import ifcopenshell
        import ifcopenshell.geom as geom

        ifc = ifcopenshell.open(str(path))
        settings = geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)

        vertices_list, faces_list = [], []
        ifc_meta: dict = {"element_types": {}}
        offset = 0

        for product in ifc.by_type("IfcProduct"):
            if not product.Representation:
                continue
            try:
                shape = geom.create_shape(settings, product)
            except Exception:
                continue

            verts = np.array(shape.geometry.verts).reshape(-1, 3)
            faces = np.array(shape.geometry.faces).reshape(-1, 3) + offset
            vertices_list.append(verts)
            faces_list.append(faces)
            offset += len(verts)

            cls = product.is_a()
            ifc_meta["element_types"][cls] = ifc_meta["element_types"].get(cls, 0) + 1

        if not vertices_list:
            raise ValueError("No geometry extracted from IFC")

        all_verts = np.vstack(vertices_list)
        all_faces = np.vstack(faces_list)
        mesh = trimesh.Trimesh(vertices=all_verts, faces=all_faces)
        return mesh, ifc_meta

    except ImportError:
        raise RuntimeError("IfcOpenShell is not installed in this environment")
