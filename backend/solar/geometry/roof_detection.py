import numpy as np


def detect_roof_faces(face_normals, up_vector=None, threshold=0.7):
    """
    Return indices of faces considered roof surfaces.

    A roof face must point upward:
    dot(normal, up_vector) > threshold

    threshold ~ 0.7 means ~45 degrees tolerance from vertical.
    """
    if up_vector is None:
        up_vector = np.array([0, 0, 1])
    normals = np.asarray(face_normals, dtype=np.float64)
    up = np.asarray(up_vector, dtype=np.float64)
    if up.ndim == 1:
        up = up / (np.linalg.norm(up) or 1.0)
    dots = normals @ up
    roof_mask = dots > float(threshold)
    return np.where(roof_mask)[0]
