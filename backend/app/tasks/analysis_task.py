"""
Celery task: run solar analysis in the background.
Worker must use the same DATABASE_URL as the API (e.g. postgres:5432 in Docker, not localhost).

IMPORTANT: Uses sync SQLAlchemy driver in worker to avoid asyncio event loop issues.
The worker process is synchronous; attempting asyncio.run() repeatedly causes:
- "Event loop is closed" errors
- Progress updates failing silently
- Jobs stuck in "running" state

Solution: sqlalchemy.create_engine(sync driver) instead of create_async_engine.
"""
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from signal import SIGTERM

from app.tasks.celery_app import celery_app
from app.core.storage import download_bytes, upload_bytes

# Register all SQLAlchemy models before any task runs (resolves AnalysisJob -> Project relationship)
from app.models import Project, AnalysisJob  # noqa: F401, E402

logger = logging.getLogger(__name__)
MAX_UPDATE_RETRIES = 5
RETRY_BACKOFF_INITIAL = 0.5  # seconds


def _sync_update_job(job_id: str, **kwargs):
    """Synchronous DB update using sync driver. Retries with exponential backoff on failure."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession
    from app.config import get_settings
    from app.models.analysis import AnalysisJob

    settings = get_settings()
    
    # Convert async driver (asyncpg) to sync (psycopg for PostgreSQL)
    # asyncpg URL: postgresql+asyncpg://user:pass@host/db
    # psycopg URL: postgresql://user:pass@host/db (psycopg is default)
    db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    
    last_exc = None
    backoff = RETRY_BACKOFF_INITIAL
    
    for attempt in range(1, MAX_UPDATE_RETRIES + 1):
        try:
            engine = create_engine(db_url, echo=False)
            with SyncSession(engine) as session:
                job = session.get(AnalysisJob, job_id)
                if job:
                    for k, v in kwargs.items():
                        setattr(job, k, v)
                    session.commit()
                else:
                    logger.warning("Job %s not found in DB for update", job_id)
            engine.dispose()
            
            if attempt > 1:
                logger.info("Job %s DB update succeeded on retry %d", job_id, attempt)
            return
            
        except Exception as e:
            last_exc = e
            if attempt < MAX_UPDATE_RETRIES:
                logger.warning(
                    "Job %s DB update attempt %d/%d failed: %s. Retrying in %.1fs...",
                    job_id, attempt, MAX_UPDATE_RETRIES, type(e).__name__, backoff,
                )
                time.sleep(backoff)
                backoff *= 2  # Exponential backoff
            else:
                logger.exception(
                    "Job %s DB update FAILED after %d attempts with error: %s",
                    job_id, MAX_UPDATE_RETRIES, e,
                )
    
    if last_exc:
        raise last_exc


@celery_app.task(
    bind=True,
    name="app.tasks.analysis_task.run_solar_analysis",
    time_limit=600,          # 10 minute hard timeout (kill the task)
    soft_time_limit=580,     # 9:40 soft timeout (graceful shutdown)
)
def run_solar_analysis(self, job_id: str):
    from app.services.solar_engine import run_analysis
    from celery.exceptions import SoftTimeLimitExceeded

    logger.info("Worker received analysis task job_id=%s", job_id)

    # Immediately mark running so frontend sees progress
    try:
        _sync_update_job(
            job_id,
            status="running",
            progress=1.0,
            progress_message="Starting solar analysis",
        )
    except Exception as e:
        logger.exception("Failed to mark job as running: %s", e)
        raise

    def progress_cb(pct: float, msg: str):
        """Progress callback — update job status in DB."""
        logger.info("Job %s progress %.0f%% — %s", job_id, pct, msg)
        try:
            _sync_update_job(job_id, progress=pct, progress_message=msg)
        except Exception as e:
            logger.exception("Job %s progress update failed: %s", job_id, e)
            # Don't raise — allow analysis to continue even if progress update fails

    try:
        # Fetch job + project data
        logger.info("Fetching job data for %s", job_id)
        job_data, project_data, model_data = _fetch_job_data(job_id)
        config = job_data["config"]
        
        logger.info("Config: %s", config)

        # Download model GLB
        logger.info("Downloading model GLB from storage")
        glb_bytes = download_bytes(model_data["normalized_glb_path"])
        logger.info("Downloaded model GLB: %d bytes", len(glb_bytes))

        # Download or locate EPW file
        placement = project_data.get("placement") or {}
        epw_lat = placement.get("latitude")
        epw_lon = placement.get("longitude")
        logger.info("Placement: lat=%.4f lon=%.4f", epw_lat or 0, epw_lon or 0)
        
        epw_path = _get_epw_path(config["epw_station_id"], lat=epw_lat, lon=epw_lon)
        logger.info("Using EPW file: %s (exists=%s)", epw_path, Path(epw_path).exists())

        # Run solar analysis
        logger.info("Running solar analysis with mode=%s, grid_resolution=%s",
                   config.get("mode"), config.get("grid_resolution"))
        result = run_analysis(
            glb_bytes=glb_bytes,
            placement=project_data.get("placement") or {},
            config=config,
            epw_path=epw_path,
            progress_cb=progress_cb,
        )

        # Validate results
        irr_values = result.get("irradiance_values", [])
        if irr_values:
            logger.info("Analysis results: min=%.2f, max=%.2f, avg=%.2f, unit=%s",
                       result.get("statistics", {}).get("min", 0),
                       result.get("statistics", {}).get("max", 0),
                       result.get("statistics", {}).get("avg", 0),
                       result.get("unit", ""))
            if all(v == 0 for v in irr_values if v is not None):
                logger.warning("WARNING: All irradiance values are ZERO. This may indicate:")
                logger.warning("  1. Radiance is not installed in worker (check 'rpict -version')")
                logger.warning("  2. EPW file is missing or invalid: %s", epw_path)
                logger.warning("  3. Geometry has no valid sensor points (empty mesh or bad normals)")
        else:
            logger.warning("Analysis returned NO irradiance values")

        # Local storage: storage/{project_id}/analysis/{job_id}/results.json
        project_id = project_data.get("project_id")
        result_json = json.dumps({**result, "job_id": job_id}).encode()
        result_path = f"storage/{project_id}/analysis/{job_id}/results.json"
        
        logger.info("Uploading results to storage: %s (%d bytes)", result_path, len(result_json))
        upload_bytes(result_path, result_json, "application/json")

        # Mark complete in DB
        _sync_update_job(
            job_id,
            status="completed",
            progress=100.0,
            progress_message="Done",
            result_path=result_path,
            completed_at=datetime.now(timezone.utc),
        )
        logger.info("✓ Analysis task COMPLETED for job_id=%s", job_id)

    except SoftTimeLimitExceeded:
        logger.exception("Job %s exceeded soft time limit (task timeout ~580s)", job_id)
        try:
            _sync_update_job(
                job_id,
                status="failed",
                error_message="Analysis timeout: task exceeded 9:40 limit",
                completed_at=datetime.now(timezone.utc),
            )
        except Exception:
            logger.exception("Failed to mark job as failed after timeout")
        raise
        
    except Exception as exc:
        logger.exception("✗ Analysis task FAILED for job_id=%s: %s", job_id, exc)
        try:
            _sync_update_job(
                job_id,
                status="failed",
                error_message=str(exc),
                completed_at=datetime.now(timezone.utc),
            )
        except Exception as update_err:
            logger.exception("Failed to mark job %s as failed in DB: %s", job_id, update_err)
        raise


def _fetch_job_data(job_id: str) -> tuple[dict, dict, dict]:
    """Fetch job data using sync SQLAlchemy driver."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession
    from app.config import get_settings
    from app.models.analysis import AnalysisJob
    from app.models.project import Project
    from app.models.model import Model3D

    settings = get_settings()
    db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    engine = create_engine(db_url, echo=False)
    try:
        with SyncSession(engine) as session:
            job = session.get(AnalysisJob, job_id)
            if not job:
                raise ValueError(f"Job {job_id} not found")
                
            project = session.get(Project, job.project_id)
            if not project:
                raise ValueError(f"Project {job.project_id} not found")
                
            model = session.get(Model3D, project.model_id)
            if not model:
                raise ValueError(f"Model {project.model_id} not found")

            return (
                {"config": job.config, "id": job.id},
                {"placement": project.placement, "project_id": project.id},
                {"normalized_glb_path": model.normalized_glb_path},
            )
    finally:
        engine.dispose()


def _get_epw_path(station_id: str, lat: float | None = None, lon: float | None = None) -> str:
    """
    Return local path to a real EPW/TMY weather file.

    Priority:
    1. Any *.epw file dropped in backend/data/ or the project root (for local testing).
    2. Per-location PVGIS download cached in /tmp/epw_cache/ (requires internet).
    3. Station-id-based cache path — solar engine falls back to synthetic if missing.
    """
    import httpx

    # 1. Check for manually placed EPW files in well-known locations.
    #    Prefers seoul.epw if present; otherwise takes the first .epw found.
    _backend_root = Path(__file__).parent.parent.parent  # backend/
    _search_dirs = [
        _backend_root / "data",
        _backend_root,
        Path.cwd(),
    ]
    for _dir in _search_dirs:
        _seoul = _dir / "seoul.epw"
        if _seoul.exists():
            logger.info("Using local seoul.epw: %s", _seoul)
            return str(_seoul)
        for _epw in sorted(_dir.glob("*.epw")):
            logger.info("Using local EPW file: %s", _epw)
            return str(_epw)

    # 2. PVGIS download (cached by lat/lon rounded to 2 decimal places ~ 1 km).
    cache_dir = Path("/tmp/epw_cache")
    cache_dir.mkdir(exist_ok=True)

    if lat is not None and lon is not None:
        cache_key = f"{round(lat, 2)}_{round(lon, 2)}"
        epw_file = cache_dir / f"{cache_key}.epw"
    else:
        epw_file = cache_dir / f"{station_id}.epw"

    if epw_file.exists():
        logger.info("EPW cache hit: %s", epw_file)
        return str(epw_file)

    if lat is None or lon is None:
        logger.warning(
            "No coordinates for EPW download (station=%s); analysis will use synthetic fallback",
            station_id,
        )
        return str(epw_file)

    pvgis_url = (
        f"https://re.jrc.ec.europa.eu/api/v5_2/tmy"
        f"?lat={lat}&lon={lon}&outputformat=epw&usehorizon=1"
    )
    logger.info("Downloading TMY EPW from PVGIS for (%.4f, %.4f) → %s", lat, lon, epw_file)
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(pvgis_url)
            resp.raise_for_status()
        epw_file.write_bytes(resp.content)
        logger.info("EPW saved (%d bytes): %s", len(resp.content), epw_file)
    except Exception as exc:
        logger.warning(
            "PVGIS EPW download failed for (%.4f, %.4f): %s — analysis will use synthetic fallback",
            lat, lon, exc,
        )

    return str(epw_file)
