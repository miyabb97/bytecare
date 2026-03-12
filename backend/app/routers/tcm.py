"""TCM (Traditional Chinese Medicine) endpoint router."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.tcm_engine import check_tcm_interactions

router = APIRouter()


class TCMCheckRequest(BaseModel):
    herb: str


@router.post("/users/{user_id}/tcm-check")
def tcm_check(user_id: str, payload: TCMCheckRequest):
    """Check herb interactions with existing user medication context."""
    return check_tcm_interactions(user_id, payload.herb)
