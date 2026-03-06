"""
Import all SQLAlchemy models so mappers are registered before any DB access.
Order matters: resolve dependencies (User, Model3D) before (Project, AnalysisJob).
"""
from app.models.user import User
from app.models.model import Model3D
from app.models.project import Project
from app.models.analysis import AnalysisJob

__all__ = ["User", "Model3D", "Project", "AnalysisJob"]
