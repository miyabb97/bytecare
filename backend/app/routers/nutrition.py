"""Food recommendation endpoint router."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.nutrition_engine import recommend_food

router = APIRouter()


@router.get("/users/{user_id}/food-recommendations")
def get_food_recommendations(user_id: str):
    """Get food recommendations for a user."""
    return recommend_food(user_id)
