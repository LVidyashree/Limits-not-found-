from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.schemas.evidence import EvidenceResponse
from app.schemas.finding import FindingResponse
from app.schemas.timeline import TimelineEventResponse

class ChainOfCustodyItem(BaseModel):
    timestamp: datetime
    action_type: str
    actor: str
    description: str
    sha256_recorded: Optional[str] = None

class Certificate65BData(BaseModel):
    certificate_id: str
    case_id: str
    case_title: str
    statutory_reference: str
    issued_at: datetime
    certifying_system: str
    evidence_inventory: List[Dict[str, Any]]
    integrity_declaration: str

class CaseDossierResponse(BaseModel):
    case_id: str
    title: str
    category: str
    severity: str
    status: str
    incident_date: Optional[str] = None
    suspect_info: Optional[str] = None
    financial_loss: float
    synthesized_narrative: Optional[str] = None
    
    evidence_list: List[EvidenceResponse]
    verified_findings: List[FindingResponse]
    chronological_timeline: List[TimelineEventResponse]
    custody_trail: List[ChainOfCustodyItem]
    
    legal_certificate: Certificate65BData
