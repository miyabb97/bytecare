"""Pydantic schemas for request/response validation.

This file contains lightweight planner response schemas used by the
Day Planner aggregation endpoint. Keep schemas minimal and backwards
compatible with existing API patterns in the project.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


PlannerEventType = Literal["medication", "appointment", "community_event", "wellness_prompt"]
PlannerPriority = Literal["low", "medium", "high"]
PlannerStatus = Literal["upcoming", "ongoing", "completed", "missed"]


class PlannerAction(BaseModel):
	kind: Literal["mark_taken"]
	medication_id: str
	scheduled_for: str


class PlannerTimelineItem(BaseModel):
	id: str
	type: PlannerEventType
	title: str
	subtitle: str
	start_time: str
	end_time: Optional[str] = None
	source: str
	priority: PlannerPriority
	status: PlannerStatus
	cta_label: Optional[str] = None
	cta_route: Optional[str] = None
	action: Optional[PlannerAction] = None
	metadata: Dict[str, Any] = Field(default_factory=dict)


class PlannerTodayResponse(BaseModel):
	user_id: str
	date: str
	timezone: str
	generated_at: str
	items: List[PlannerTimelineItem] = Field(default_factory=list)

