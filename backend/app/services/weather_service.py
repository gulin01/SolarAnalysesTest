"""
EPW weather station lookup.
Reads the pre-indexed CSV of stations and finds nearest by haversine distance.
"""
import csv
import math
from pathlib import Path
from functools import lru_cache

from app.schemas.weather import WeatherStationOut

STATIONS_CSV = Path(__file__).parent.parent.parent / "data" / "epw_stations.csv"


@lru_cache(maxsize=1)
def _load_stations() -> list[dict]:
    if not STATIONS_CSV.exists():
        return []
    with open(STATIONS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def find_nearest_stations(lat: float, lng: float, limit: int = 5) -> list[WeatherStationOut]:
    stations = _load_stations()
    scored = []
    for s in stations:
        try:
            slat, slng = float(s["latitude"]), float(s["longitude"])
        except (KeyError, ValueError):
            continue
        dist = _haversine_km(lat, lng, slat, slng)
        scored.append((dist, s))
    scored.sort(key=lambda x: x[0])
    return [
        WeatherStationOut(
            id=s["id"],
            name=s["name"],
            country=s.get("country", ""),
            latitude=float(s["latitude"]),
            longitude=float(s["longitude"]),
            distance_km=dist,
        )
        for dist, s in scored[:limit]
    ]
