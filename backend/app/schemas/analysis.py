from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class CorrelatedEntity(BaseModel):
    finding_type: str
    finding_value: str
    label: str
    occurrences_count: int
    evidence_ids: List[str]
    evidence_filenames: List[str]
    context_samples: List[str]

class EntityGraphNode(BaseModel):
    id: str
    label: str
    type: str # 'evidence', 'phone', 'upi', 'email', 'crypto', 'suspect', 'threat'
    properties: Dict[str, Any] = {}

class EntityGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str

class EntityGraphResponse(BaseModel):
    nodes: List[EntityGraphNode]
    edges: List[EntityGraphEdge]

class IncidentSynthesisResponse(BaseModel):
    case_id: str
    case_title: str
    category: str
    severity: str
    calculated_loss: float
    total_evidence_analyzed: int
    modus_operandi_summary: str
    key_suspect_identifiers: Dict[str, List[str]]
    detected_threat_indicators: List[str]
    reconstructed_timeline_summary: str
    recommended_police_sections: List[str]
