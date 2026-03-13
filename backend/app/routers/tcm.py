"""TCM (Traditional Chinese Medicine) endpoint router."""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

from app.services.tcm_engine import check_tcm_interactions, check_tcm_from_image

router = APIRouter()


class TCMCheckRequest(BaseModel):
    herb: str


@router.post("/users/{user_id}/tcm-check")
def tcm_check(user_id: str, payload: TCMCheckRequest):
    """Check herb interactions with existing user medication context."""
    return check_tcm_interactions(user_id, payload.herb)


@router.post("/users/{user_id}/tcm-scan")
async def tcm_scan_image(user_id: str, image: UploadFile = File(...)):
    """Upload a TCM herb image, run OCR, and check interactions."""
    image_bytes = await image.read()
    return check_tcm_from_image(user_id, image_bytes)
