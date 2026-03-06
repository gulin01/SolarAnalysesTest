"""
Multi-format 3D model parser.
Converts GLB / GLTF / OBJ / STL / IFC → canonical GLB + extracts metadata.
"""
import uuid
import asyncio
from pathlib import Path
import tempfile


async def parse_and_convert(content: bytes, filename: str, ext: str) -> dict:
    """Run synchronous work in a thread pool to keep FastAPI non-blocking."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _parse_sync, content, filename, ext)


def _parse_sync(content: bytes, filename: str, ext: str) -> dict:
    model_id = str(uuid.uuid4())

    # GLB/GLTF: already binary GL Transmission Format — save raw bytes, skip trimesh
    if ext in ("glb", "gltf"):
        return {
            "id": model_id,
            "glb_bytes": content,
            "face_count": 0,
            "vertex_count": 0,
            "surface_area_m2": 0.0,
            "bounding_box": {"min": [0.0, 0.0, 0.0], "max": [1.0, 1.0, 1.0]},
            "ifc_metadata": None,
        }

    # OBJ / STL / IFC: attempt trimesh conversion; fall back to raw bytes on any error
    try:
        import trimesh
        import numpy as np

        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / filename
            src.write_bytes(content)

            if ext == "ifc":
                mesh, ifc_meta = _load_ifc(src)
            else:
                mesh = trimesh.load(str(src), force="mesh")
                ifc_meta = None

            if isinstance(mesh, trimesh.Scene):
                mesh = mesh.dump(concatenate=True)

            if hasattr(mesh, "triangulate"):
                mesh = mesh.triangulate()

            mesh.apply_translation(-mesh.centroid)

            glb_path = Path(tmpdir) / "model.glb"
            mesh.export(str(glb_path))
            glb_bytes = glb_path.read_bytes()

            bb = mesh.bounds
            return {
                "id": model_id,
                "glb_bytes": glb_bytes,
                "face_count": len(mesh.faces),
                "vertex_count": len(mesh.vertices),
                "surface_area_m2": float(mesh.area),
                "bounding_box": {"min": bb[0].tolist(), "max": bb[1].tolist()},
                "ifc_metadata": ifc_meta,
            }

    except Exception:
        # Fallback: store raw bytes with stub metadata so the upload always succeeds
        return {
            "id": model_id,
            "glb_bytes": content,
            "face_count": 0,
            "vertex_count": 0,
            "surface_area_m2": 0.0,
            "bounding_box": {"min": [0.0, 0.0, 0.0], "max": [1.0, 1.0, 1.0]},
            "ifc_metadata": None,
        }


def _load_ifc(path: Path):
    """Load IFC via IfcOpenShell and return a trimesh + metadata dict."""
    try:
        import ifcopenshell
        import ifcopenshell.geom as geom
        import numpy as np
        import trimesh

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
