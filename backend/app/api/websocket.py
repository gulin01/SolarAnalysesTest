import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import AsyncSessionLocal
from app.models.analysis import AnalysisJob

router = APIRouter()

POLL_INTERVAL = 1.5  # seconds


@router.websocket("/analysis/{job_id}")
async def analysis_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()
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
        pass
