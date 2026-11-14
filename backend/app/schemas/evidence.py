from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.schemas.finding import FindingResponse

class EvidenceBase(BaseModel):
    filename: str
    original_filename: str
    file_type: str
    mime_type: str
    file_size: int
    sha256_hash: str
    processing_status: str = "pending"

class EvidenceResponse(EvidenceBase):
    id: str
    case_id: str
    is_verified: int
    created_at: datetime

    class Config:
        from_attributes = True

class EvidenceDetailResponse(EvidenceResponse):
    extracted_text: Optional[str] = None
    metadata_json: Optional[str] = None
    findings: List[FindingResponse] = []

class EvidenceVerifyRequest(BaseModel):
    is_verified: bool
