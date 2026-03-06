import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
import json

from app.core.database import get_db
from app.core.auth import get_current_user_id
from app.core.storage import download_bytes, delete_object
from app.models.analysis import AnalysisJob
from app.models.project import Project
from app.schemas.analysis import AnalysisRunRequest, AnalysisJobOut, AnalysisResultOut, PanelZoneOut
from app.tasks.analysis_task import run_solar_analysis

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/run", status_code=201)
async def run_analysis(
    body: AnalysisRunRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = await db.get(Project, body.project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.model_id:
        raise HTTPException(status_code=400, detail="No model attached to project")

    config: dict = {
        "epw_station_id": body.epw_station_id,
        "mode": body.mode,
        "grid_resolution": body.grid_resolution,
        "ground_reflectance": body.ground_reflectance,
        "surface_filter": body.surface_filter,
    }
    if body.selected_face_ids:
        config["selected_face_ids"] = body.selected_face_ids
    if body.mode == "hourly":
        config["analysis_date"] = str(body.analysis_date)
        config["analysis_hour"] = body.analysis_hour

    job = AnalysisJob(
        project_id=body.project_id,
        status="queued",
        mode=body.mode,
        config=config,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Update project
    project.latest_job_id = job.id
    project.current_step = "results"
    await db.commit()

    # Dispatch Celery task (worker must share CELERY_BROKER_URL and DATABASE_URL with API)
    run_solar_analysis.delay(job.id)
    logger.info("Analysis task queued job_id=%s", job.id)

    return {"id": job.id, "status": "queued"}


@router.get("", response_model=list[AnalysisJobOut])
async def list_jobs(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    project = await db.get(Project, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.scalars(
        select(AnalysisJob)
        .where(AnalysisJob.project_id == project_id)
        .order_by(AnalysisJob.started_at.desc())
    )
    return result.all()


@router.get("/{job_id}/status", response_model=AnalysisJobOut)
async def get_status(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    job = await db.get(AnalysisJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    project = await db.get(Project, job.project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return job


@router.get("/{job_id}/results", response_model=AnalysisResultOut)
async def get_results(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    job = await db.get(AnalysisJob, job_id)
    if not job or job.status != "completed":
        raise HTTPException(status_code=404, detail="Results not available")
    project = await db.get(Project, job.project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    raw = download_bytes(job.result_path)
    return AnalysisResultOut(**json.loads(raw))


@router.get("/{job_id}/panels", response_model=list[PanelZoneOut])
async def get_panel_zones(
    job_id: str,
    min_irradiance: float = Query(800.0),
    min_area: float = Query(2.0),
    tilt_min: float = Query(15.0),
    tilt_max: float = Query(35.0),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    job = await db.get(AnalysisJob, job_id)
    if not job or job.status != "completed":
        raise HTTPException(status_code=404, detail="Results not available")

    raw = download_bytes(job.result_path)
    data = json.loads(raw)
    zones = [PanelZoneOut(**z) for z in data.get("panel_zones", [])]
    return [
        z for z in zones
        if z.avg_irradiance >= min_irradiance
        and z.area_m2 >= min_area
        and tilt_min <= z.tilt_deg <= tilt_max
    ]


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    job = await db.get(AnalysisJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.result_path:
        try:
            delete_object(job.result_path)
        except Exception:
            pass
    await db.delete(job)
    await db.commit()
