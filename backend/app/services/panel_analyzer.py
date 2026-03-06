"""
Post-processing helper: refine and rank panel placement zones from raw results.
"""
from typing import Any
import numpy as np


def filter_and_rank_zones(
    zones: list[dict],
    min_irradiance: float = 800.0,
    min_area: float = 2.0,
    tilt_min: float = 15.0,
    tilt_max: float = 35.0,
) -> list[dict]:
    """Filter zones by irradiance + geometry criteria and rank by yield."""
    filtered = [
        z for z in zones
        if z["avg_irradiance"] >= min_irradiance
        and z["area_m2"] >= min_area
        and tilt_min <= z["tilt_deg"] <= tilt_max
    ]
    return sorted(filtered, key=lambda z: z["estimated_annual_yield_kwh"], reverse=True)
