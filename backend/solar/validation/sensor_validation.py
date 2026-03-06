import numpy as np


def validate_sensor_points(points):
    """
    Validate sensor point cloud. Raises RuntimeError if invalid.
    Logs a warning if Z spread is large (likely walls included).
    """
    points = np.asarray(points)
    if len(points) == 0:
        raise RuntimeError("No sensor points generated")
    z = points[:, 2]
    z_range = float(np.max(z) - np.min(z))
    if z_range > 5:
        import logging
        logging.getLogger(__name__).warning(
            "Sensors spread vertically (Z range %.2f m) — likely walls included", z_range
        )
    return True
