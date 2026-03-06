from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any
from app.schemas.model import ModelMetaOut


class PlacementSchema(BaseModel):
    latitude: float
    longitude: float
    rotation_deg: float = 0.0
    scale: float = 1.0
    elevation_m: float = 0.0


class ProjectCreate(BaseModel):
    name: str


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    model_id: Optional[str] = None
    current_step: Optional[str] = None
    placement: Optional[PlacementSchema] = None


class ProjectOut(BaseModel):
    id: str
    name: str
    user_id: str
    model_id: Optional[str]
    model: Optional[ModelMetaOut]
    placement: Optional[PlacementSchema]
    current_step: str
    latest_job_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_model_url(cls, project: Any) -> "ProjectOut":
        """Build ProjectOut from Project ORM, with model.normalized_glb_url set via from_orm_with_url."""
        placement = None
        if project.placement and isinstance(project.placement, dict):
            try:
                placement = PlacementSchema.model_validate(project.placement)
            except Exception:
                placement = None
        model = ModelMetaOut.from_orm_with_url(project.model) if project.model else None
        return cls(
            id=project.id,
            name=project.name,
            user_id=project.user_id,
            model_id=project.model_id,
            model=model,
            placement=placement,
            current_step=project.current_step,
            latest_job_id=project.latest_job_id,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
