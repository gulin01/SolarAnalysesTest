import numpy as np


def deduplicate_points(points, tolerance=1e-4, return_inverse=False, return_index=False):
    """
    Remove duplicate points within tolerance.
    - return_inverse: if True, also return inv so that points == unique[inv].
    - return_index: if True, also return idx (first occurrence indices) so unique = points[idx].
    Returns: unique points, and optionally (inv,) or (idx, inv) or (inv,) depending on flags.
    """
    points = np.asarray(points, dtype=np.float64)
    if points.size == 0:
        empty_idx = np.array([], dtype=np.intp)
        pts = points.reshape(0, points.shape[-1]) if points.ndim == 1 else points
        if return_inverse and return_index:
            return pts, empty_idx, empty_idx
        if return_inverse:
            return pts, empty_idx
        if return_index:
            return pts, empty_idx
        return pts
    scaled = points / (float(tolerance) or 1e-10)
    rounded = np.round(scaled).astype(np.int64)
    _, idx, inv = np.unique(rounded, axis=0, return_index=True, return_inverse=True)
    unique_pts = points[idx]
    if not return_inverse and not return_index:
        return unique_pts
    if return_inverse and not return_index:
        return unique_pts, inv
    if return_index and not return_inverse:
        return unique_pts, idx
    return unique_pts, idx, inv
