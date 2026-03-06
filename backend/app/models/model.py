import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Model3D(Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    original_format: Mapped[str] = mapped_column(String, nullable=False)  # glb|gltf|obj|stl|ifc
    original_file_path: Mapped[str] = mapped_column(String, nullable=False)
    normalized_glb_path: Mapped[str] = mapped_column(String, nullable=False)
    face_count: Mapped[int] = mapped_column(Integer, default=0)
    vertex_count: Mapped[int] = mapped_column(Integer, default=0)
    surface_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    bounding_box: Mapped[dict] = mapped_column(JSON, nullable=True)
    ifc_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
