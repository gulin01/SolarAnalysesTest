from pydantic import BaseModel, Field, model_validator
from datetime import datetime, date
from typing import Optional, Literal


class AnalysisRunRequest(BaseModel):
    project_id: str
    epw_station_id: str
    grid_resolution: float = Field(default=0.5, ge=0.1, le=5.0)
    ground_reflectance: float = Field(default=0.2, ge=0.0, le=1.0)
    mode: Literal["annual", "hourly"] = "annual"
    analysis_date: Optional[date] = None
    analysis_hour: Optional[int] = Field(default=None, ge=0, le=23)
    # Surface filter: which faces to simulate
    surface_filter: Literal["all", "roofs", "walls"] = "all"
    # Optional: specific face indices to simulate (overrides surface_filter)
    selected_face_ids: Optional[list[int]] = None

    @model_validator(mode="after")
    def validate_hourly_fields(self):
        if self.mode == "hourly":
            if self.analysis_date is None:
                raise ValueError("analysis_date is required for hourly mode")
            if self.analysis_hour is None:
                raise ValueError("analysis_hour is required for hourly mode")
        return self


class AnalysisJobOut(BaseModel):
    id: str
    project_id: str
    status: str
    progress: float
    progress_message: str
    config: dict
    started_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]

    model_config = {"from_attributes": True}


class PanelZoneOut(BaseModel):
    id: int
    face_indices: list[int]
    centroid: list[float]
    avg_irradiance: float
    area_m2: float
    tilt_deg: float
    azimuth_deg: float
    estimated_annual_yield_kwh: float
    panel_count_estimate: int


class SunPositionOut(BaseModel):
    altitude_deg: float
    azimuth_deg: float
    is_above_horizon: bool


class WeatherAtHourOut(BaseModel):
    temperature_c: float
    dni: float
    dhi: float
    wind_speed: float


class SensorPointOut(BaseModel):
    position: list[float]   # [x, y, z]
    normal: list[float]     # [nx, ny, nz]
    value: float


class HeatmapCellOut(BaseModel):
    position: list[float]           # face centroid [x, y, z]
    normal: list[float]             # face normal [nx, ny, nz]
    value: float                    # irradiance value
    face_id: int                    # index in original full mesh
    corners: list[list[float]]      # 4 corners [[x,y,z], ...] for quad rendering


class AnalysisResultOut(BaseModel):
    job_id: str
    mode: str = "annual"
    grid_points: list[list[float]]
    irradiance_values: list[float]
    # New: heatmap cells (quads) and sensor points for frontend overlay rendering
    heatmap_cells: list[HeatmapCellOut] = Field(default_factory=list)
    sensor_points: list[SensorPointOut] = Field(default_factory=list)
    statistics: dict
    panel_zones: list[PanelZoneOut]
    unit: str = "kWh/m²"
    surface_filter: str = "all"
    # Hourly-mode extras (None for annual)
    sun_position: Optional[SunPositionOut] = None
    weather_at_hour: Optional[WeatherAtHourOut] = None
    analysis_date: Optional[str] = None
    analysis_hour: Optional[int] = None
