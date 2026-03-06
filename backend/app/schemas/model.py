from pydantic import BaseModel, computed_field
from datetime import datetime
from typing import Optional, Any
from app.config import get_settings
from app.core.storage import get_presigned_url


class BoundingBox(BaseModel):
    min: list[float]
    max: list[float]


class ModelMetaOut(BaseModel):
    id: str
    original_filename: str
    original_format: str
    face_count: int
    vertex_count: int
    surface_area_m2: float
    bounding_box: Optional[Any]
    ifc_metadata: Optional[Any]
    created_at: datetime

    # Derived presigned URL — generated at serialisation time
    normalized_glb_url: str = ""

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_url(cls, obj: Any) -> "ModelMetaOut":
        instance = cls.model_validate(obj)
        try:
            instance.normalized_glb_url = get_presigned_url(obj.normalized_glb_path)
        except NotImplementedError:
            # Local storage: use download endpoint; prepend public API URL if set so frontend gets absolute URL
            base = (get_settings().public_api_url or "").rstrip("/")
            path = f"/api/models/{obj.id}/download"
            instance.normalized_glb_url = f"{base}{path}" if base else path
        except Exception:
            instance.normalized_glb_url = f"/api/models/{obj.id}/download"
        return instance
