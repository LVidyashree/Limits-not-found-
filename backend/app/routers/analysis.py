from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any

from app.database import get_db
from app.models.case import Case
from app.models.finding import Finding
from app.schemas.analysis import (
    EntityGraphResponse,
    IncidentSynthesisResponse
)
from app.schemas.finding import FindingResponse, FindingVerifyRequest
from app.services.correlation import correlate_case_evidence
from app.services.timeline_service import auto_generate_case_timeline
from app.services.synthesis_service import synthesize_case_incident
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases/{case_id}/analysis", tags=["Intelligent Synthesis & Forensics"])

@router.post("/run", response_model=IncidentSynthesisResponse)
def run_full_analysis(case_id: str, db: Session = Depends(get_db)):
    """
    Executes the comprehensive AI Synthesis Pipeline on all case evidence:
    1. Synthesizes cross-evidence connections & financial losses.
    2. Auto-reconstructs the chronological timeline.
    3. Generates executive Modus Operandi & recommended legal sections.
    4. Updates case records with the synthesized summary.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # 1. Reconstruct chronological timeline events
    suggested_events = auto_generate_case_timeline(case)
    for event in suggested_events:
        db.add(event)
    db.commit()
    db.refresh(case)

    # 2. Synthesize Incident Narrative & Suspect Identifiers
    synthesis = synthesize_case_incident(case)

    # Update case with synthesized narrative & calculated loss
    case.synthesized_summary = synthesis.modus_operandi_summary
    if synthesis.calculated_loss > 0:
        case.financial_loss_amount = synthesis.calculated_loss
    db.commit()

    # 3. Log chain of custody event
    log_custody_action(
        db=db,
        case_id=case.id,
        evidence_id=None,
        action_type="INTELLIGENCE_SYNTHESIS_EXECUTED",
        actor="AI Forensic Synthesis Engine",
        description=f"Automated correlation completed across {len(case.evidence_items)} evidence items.",
        details={
            "calculated_loss": synthesis.calculated_loss,
            "threats_count": len(synthesis.detected_threat_indicators)
        }
    )

    return synthesis

@router.get("/correlation", response_model=Dict[str, Any])
def get_correlation(case_id: str, db: Session = Depends(get_db)):
    """
    Returns grouped entities (UPI IDs, phone numbers, crypto accounts) that appear
    across multiple pieces of evidence, identifying linked scam infrastructure.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = correlate_case_evidence(case)
    return result

@router.get("/graph", response_model=EntityGraphResponse)
def get_entity_graph(case_id: str, db: Session = Depends(get_db)):
    """
    Generates a full interactive node-and-edge graph mapping evidence files,
    suspects, phone numbers, payment accounts, and fraud indicators.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    correlation_data = correlate_case_evidence(case)
    return correlation_data["graph"]

@router.get("/synthesis", response_model=IncidentSynthesisResponse)
def get_incident_synthesis(case_id: str, db: Session = Depends(get_db)):
    """Retrieves the synthesized case narrative and modus operandi analysis."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    return synthesize_case_incident(case)

@router.post("/findings/{finding_id}/verify", response_model=FindingResponse)
def verify_finding(
    case_id: str,
    finding_id: str,
    verify_req: FindingVerifyRequest,
    db: Session = Depends(get_db)
):
    """
    Allows a victim or cyber investigator to verify or reject an extracted finding.
    Creates an audit trail entry for human-in-the-loop validation.
    """
    finding = db.query(Finding).filter(
        Finding.id == finding_id,
        Finding.case_id == case_id
    ).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    finding.verification_status = verify_req.verification_status
    finding.verified_at = datetime.utcnow()
    if verify_req.user_notes:
        finding.user_notes = verify_req.user_notes

    db.commit()
    db.refresh(finding)

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=finding.evidence_id,
        action_type="FINDING_VERIFIED",
        actor="Investigator / Complainant",
        description=f"Finding '{finding.finding_value}' marked as {verify_req.verification_status.upper()}",
        details={"finding_type": finding.finding_type, "status": verify_req.verification_status}
    )

    return finding
