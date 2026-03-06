from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.auth import get_current_user_id
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectOut, PlacementSchema

router = APIRouter()


@router.post("", status_code=201, response_model=ProjectOut)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = Project(user_id=user_id, name=body.name)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return ProjectOut.from_orm_with_model_url(project)


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    result = await db.scalars(
        select(Project).where(Project.user_id == user_id).order_by(Project.updated_at.desc())
    )
    projects = result.all()
    return [ProjectOut.from_orm_with_model_url(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectOut.from_orm_with_model_url(project)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")

    data = body.model_dump(exclude_unset=True)
    if "placement" in data and data["placement"] is not None:
        data["placement"] = data["placement"] if isinstance(data["placement"], dict) else data["placement"].model_dump()

    for k, v in data.items():
        setattr(project, k, v)

    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)
    return ProjectOut.from_orm_with_model_url(project)


@router.patch("/{project_id}/placement", response_model=ProjectOut)
async def update_placement(
    project_id: str,
    body: PlacementSchema,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    project.placement = body.model_dump()
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)
    return ProjectOut.from_orm_with_model_url(project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from app.core.storage import delete_object
    from app.models.model import Model3D

    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Delete analysis result files from storage (jobs cascade-deleted via DB relationship)
    for job in project.analysis_jobs:
        if job.result_path:
            try:
                delete_object(job.result_path)
            except Exception:
                pass

    # Delete model files from storage and the Model3D row
    if project.model_id:
        model = await db.get(Model3D, project.model_id)
        if model:
            for path in [model.original_file_path, model.normalized_glb_path]:
                if path:
                    try:
                        delete_object(path)
                    except Exception:
                        pass
            await db.delete(model)

    await db.delete(project)
    await db.commit()
