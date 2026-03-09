import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.core.database import AsyncSessionLocal
from app.core.auth import decode_token
from app.models.analysis import AnalysisJob

router = APIRouter()
logger = logging.getLogger(__name__)

POLL_INTERVAL = 1.5  # seconds


@router.websocket("/analysis/{job_id}")
async def analysis_progress(websocket: WebSocket, job_id: str, token: str = Query(...)):
    """
    WebSocket for analysis progress streaming.
    REQUIRES authentication token via query parameter.
    """
    # Authenticate user
    try:
        user_id = decode_token(token)
    except Exception as e:
        logger.warning(f"WebSocket connection rejected: invalid token — {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authorization token")
        return
    
    # Verify user owns this job
    try:
        async with AsyncSessionLocal() as db:
            job = await db.get(AnalysisJob, job_id)
            if not job:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Job not found")
                return
                
            # Verify ownership by checking if job's project belongs to user
            from app.models.project import Project
            project = await db.get(Project, job.project_id)
            if not project or project.user_id != user_id:
                logger.warning(f"WebSocket access denied: user {user_id} attempted to access job {job_id} from project {job.project_id}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Forbidden")
                return
    except Exception as e:
        logger.exception(f"WebSocket authentication check failed: {e}")
        await websocket.close(code=1011, reason="Authorization check failed")
        return
    
    await websocket.accept()
    logger.info(f"WebSocket connection accepted for job {job_id} (user {user_id})")
    
    try:
        while True:
            async with AsyncSessionLocal() as db:
                job = await db.get(AnalysisJob, job_id)
            
            if not job:
                await websocket.send_text(json.dumps({"type": "error", "message": "Job not found"}))
                break

            await websocket.send_text(json.dumps({
                "type": "progress",
                "status": job.status,
                "progress": job.progress,
                "message": job.progress_message,
            }))

            if job.status in ("completed", "failed"):
                break

            await asyncio.sleep(POLL_INTERVAL)
    except WebSocketDisconnect:
        logger.debug(f"WebSocket disconnected for job {job_id}")
    except Exception as e:
        logger.exception(f"WebSocket error for job {job_id}: {e}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass
