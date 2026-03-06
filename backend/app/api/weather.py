from fastapi import APIRouter, Depends, Query, HTTPException
from app.core.auth import get_current_user_id
from app.schemas.weather import WeatherStationOut, StationsResponse
from app.services.weather_service import find_nearest_stations

router = APIRouter()


@router.get("/stations", response_model=StationsResponse)
async def get_stations(
    lat: float = Query(..., description="Latitude from project placement"),
    lng: float = Query(..., description="Longitude from project placement"),
    limit: int = Query(5, ge=1, le=20),
    _: str = Depends(get_current_user_id),
):
    """
    Find nearest EPW weather stations to the given coordinates.
    Called when the user opens the analyze page; lat/lng come from the project's saved placement.
    """
    stations = await find_nearest_stations(lat, lng, limit)
    if not stations:
        raise HTTPException(
            status_code=404,
            detail="No weather stations indexed yet. Run the EPW station import script.",
        )
    return {
        "stations": [s.model_dump() for s in stations],
        "location": {"latitude": lat, "longitude": lng},
    }
