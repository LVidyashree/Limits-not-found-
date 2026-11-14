from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class FindingBase(BaseModel):
    finding_type: str
    finding_value: str
    label: str
    context_snippet: Optional[str] = None
    confidence: float = 0.90
    verification_status: str = "needs_verification"
    user_notes: Optional[str] = None

class FindingCreate(FindingBase):
    case_id: str
    evidence_id: str

class FindingVerifyRequest(BaseModel):
    verification_status: str # "verified" or "rejected"
    user_notes: Optional[str] = None

class FindingResponse(FindingBase):
    id: str
    case_id: str
    evidence_id: str
    verified_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
