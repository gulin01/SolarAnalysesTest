"""
IFC → GLB conversion using IfcOpenShell.
Called by model_parser for .ifc uploads.
"""
from pathlib import Path
import tempfile
import numpy as np


def ifc_to_glb(ifc_path: Path) -> tuple[bytes, dict]:
    """
    Convert an IFC file to GLB bytes.
    Returns (glb_bytes, ifc_metadata).
    """
    try:
        import ifcopenshell
        import ifcopenshell.geom as geom
        import trimesh

        ifc = ifcopenshell.open(str(ifc_path))
        settings = geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)

        meshes = []
        element_types: dict[str, int] = {}

        for product in ifc.by_type("IfcProduct"):
            if not product.Representation:
                continue
            try:
                shape = geom.create_shape(settings, product)
            except Exception:
                continue
            verts = np.array(shape.geometry.verts).reshape(-1, 3)
            faces = np.array(shape.geometry.faces).reshape(-1, 3)
            m = trimesh.Trimesh(vertices=verts, faces=faces)
            meshes.append(m)
            cls = product.is_a()
            element_types[cls] = element_types.get(cls, 0) + 1

        if not meshes:
            raise ValueError("No geometry found in IFC file")

        combined = trimesh.util.concatenate(meshes)
        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
            combined.export(f.name)
            glb_bytes = Path(f.name).read_bytes()

        return glb_bytes, {"element_types": element_types, "product_count": len(meshes)}

    except ImportError:
        raise RuntimeError("IfcOpenShell not installed")
