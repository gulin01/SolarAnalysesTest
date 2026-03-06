from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
import io, uuid

from app.core.database import get_db
from app.core.auth import get_current_user_id
from app.core.storage import upload_bytes, download_bytes
from app.models.analysis import AnalysisJob
from app.models.project import Project
from app.services.report_generator import generate_pdf_report

router = APIRouter()

# In-memory report index (replace with DB table in production)
_reports: dict[str, str] = {}


class ReportRequest(BaseModel):
    analysis_job_id: str


@router.post("/generate", status_code=201)
async def generate_report(
    body: ReportRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    job = await db.get(AnalysisJob, body.analysis_job_id)
    if not job or job.status != "completed":
        raise HTTPException(status_code=404, detail="Analysis not completed")
    project = await db.get(Project, job.project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    pdf_bytes = await generate_pdf_report(job, project)
    report_id = str(uuid.uuid4())
    path = f"storage/{project.id}/reports/{report_id}.pdf"
    upload_bytes(path, pdf_bytes, "application/pdf")
    _reports[report_id] = path

    return {"id": report_id}


@router.get("/{report_id}/download")
async def download_report(
    report_id: str,
    user_id: str = Depends(get_current_user_id),
):
    path = _reports.get(report_id)
    if not path:
        raise HTTPException(status_code=404, detail="Report not found")
    data = download_bytes(path)
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="solarsight_report_{report_id}.pdf"'},
    )
