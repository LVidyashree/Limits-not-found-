from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TimelineEventBase(BaseModel):
    event_date: str
    event_time: Optional[str] = None
    title: str
    description: Optional[str] = None
    source: str = "extracted"
    is_verified: int = 0

class TimelineEventCreate(TimelineEventBase):
    case_id: str
    evidence_id: Optional[str] = None
    finding_id: Optional[str] = None

class TimelineEventResponse(TimelineEventBase):
    id: str
    case_id: str
    evidence_id: Optional[str] = None
    finding_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
