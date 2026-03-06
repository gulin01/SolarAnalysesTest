from pydantic import BaseModel


class WeatherStationOut(BaseModel):
    id: str
    name: str
    country: str
    latitude: float
    longitude: float
    distance_km: float


class LocationOut(BaseModel):
    latitude: float
    longitude: float


class StationsResponse(BaseModel):
    stations: list[WeatherStationOut]
    location: LocationOut
