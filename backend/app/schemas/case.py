from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.schemas.evidence import EvidenceResponse
from app.schemas.timeline import TimelineEventResponse

class CaseBase(BaseModel):
    title: str
    category: str
    description: Optional[str] = None
    incident_date: Optional[str] = None
    incident_time: Optional[str] = None
    platform: Optional[str] = None
    suspect_info: Optional[str] = None
    severity: str = "medium"

class CaseCreate(CaseBase):
    pass

class CaseUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    incident_date: Optional[str] = None
    incident_time: Optional[str] = None
    platform: Optional[str] = None
    suspect_info: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    financial_loss_amount: Optional[float] = None
    synthesized_summary: Optional[str] = None

class CaseResponse(CaseBase):
    id: str
    status: str
    is_demo: int
    financial_loss_amount: float
    synthesized_summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class CaseDetailResponse(CaseResponse):
    evidence_items: List[EvidenceResponse] = []
    timeline_events: List[TimelineEventResponse] = []
    total_evidence_count: int = 0
    verified_findings_count: int = 0
    pending_findings_count: int = 0

class CaseStatistics(BaseModel):
    total_cases: int
    active_cases: int
    critical_cases: int
    total_evidence_items: int
    total_verified_findings: int
    total_financial_loss: float
