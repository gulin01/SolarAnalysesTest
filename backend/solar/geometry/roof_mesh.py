import numpy as np
import trimesh
from .roof_detection import detect_roof_faces


def extract_roof_mesh(mesh: trimesh.Trimesh, up_vector=None, threshold=0.7):
    """
    Return a mesh containing only roof faces (faces pointing upward).
    """
    roof_indices = detect_roof_faces(mesh.face_normals, up_vector=up_vector, threshold=threshold)
    if len(roof_indices) == 0:
        raise RuntimeError("No roof faces detected")
    # submesh accepts a list of face index arrays or boolean mask; use mask for compatibility
    mask = np.zeros(len(mesh.faces), dtype=bool)
    mask[roof_indices] = True
    result = mesh.submesh([mask], append=True)
    # submesh can return a list of meshes or a single mesh depending on trimesh version
    if isinstance(result, list) and len(result) == 1:
        return result[0]
    if isinstance(result, list) and len(result) > 1:
        return trimesh.util.concatenate(result)
    return result
