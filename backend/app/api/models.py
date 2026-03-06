from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import io

from app.core.database import get_db
from app.core.auth import get_current_user_id
from app.core.storage import upload_bytes, download_bytes, delete_object
from app.models.model import Model3D
from app.schemas.model import ModelMetaOut
from app.services.model_parser import parse_and_convert

router = APIRouter()


@router.post("/upload", status_code=201)
async def upload_model(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    content = await file.read()
    filename = file.filename or "model"
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext not in ("glb", "gltf", "obj", "stl", "ifc"):
        raise HTTPException(status_code=400, detail=f"Unsupported format: {ext}")

    # Parse and convert to GLB
    result = await parse_and_convert(content, filename, ext)

    # Local storage: storage/{project_id}/original.{ext} and storage/{project_id}/model.glb
    orig_path = f"storage/{project_id}/original.{ext}"
    glb_path = f"storage/{project_id}/model.glb"
    upload_bytes(orig_path, content, file.content_type or "application/octet-stream")
    upload_bytes(glb_path, result["glb_bytes"], "model/gltf-binary")

    model = Model3D(
        id=result["id"],
        user_id=user_id,
        original_filename=filename,
        original_format=ext,
        original_file_path=orig_path,
        normalized_glb_path=glb_path,
        face_count=result["face_count"],
        vertex_count=result["vertex_count"],
        surface_area_m2=result["surface_area_m2"],
        bounding_box=result["bounding_box"],
        ifc_metadata=result.get("ifc_metadata"),
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return ModelMetaOut.from_orm_with_url(model)


@router.get("/{model_id}", response_model=ModelMetaOut)
async def get_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    model = await db.get(Model3D, model_id)
    if not model or model.user_id != user_id:
        raise HTTPException(status_code=404, detail="Model not found")
    return ModelMetaOut.from_orm_with_url(model)


@router.get("/{model_id}/download")
async def download_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    model = await db.get(Model3D, model_id)
    if not model or model.user_id != user_id:
        raise HTTPException(status_code=404, detail="Model not found")
    data = download_bytes(model.normalized_glb_path)
    return StreamingResponse(io.BytesIO(data), media_type="model/gltf-binary")


@router.delete("/{model_id}", status_code=204)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    model = await db.get(Model3D, model_id)
    if not model or model.user_id != user_id:
        raise HTTPException(status_code=404, detail="Model not found")
    delete_object(model.original_file_path)
    delete_object(model.normalized_glb_path)
    await db.delete(model)
    await db.commit()
