from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.case import Case
from app.schemas.dossier import CaseDossierResponse, Certificate65BData, ChainOfCustodyItem
from app.schemas.evidence import EvidenceResponse
from app.schemas.finding import FindingResponse
from app.schemas.timeline import TimelineEventResponse
from app.services.certificate import generate_certificate_data, render_html_dossier
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases/{case_id}/dossier", tags=["Dossier & Legal Admissibility"])

@router.get("", response_model=CaseDossierResponse)
def get_case_dossier(case_id: str, db: Session = Depends(get_db)):
    """
    Assembles and exports the complete electronic evidence dossier in structured JSON.
    Contains verified findings, chronological timeline, chain of custody logs,
    and statutory Section 65B certification details.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    cert_data = generate_certificate_data(case)

    # Collate custody trail
    custody_trail = [
        ChainOfCustodyItem(
            timestamp=log.timestamp,
            action_type=log.action_type,
            actor=log.actor,
            description=log.description,
            sha256_recorded=log.sha256_recorded
        )
        for log in case.custody_logs
    ]

    log_custody_action(
        db=db,
        case_id=case.id,
        evidence_id=None,
        action_type="DOSSIER_ACCESSED",
        actor="Investigator / User",
        description="Full Case Dossier assembled for review"
    )

    return CaseDossierResponse(
        case_id=case.id,
        title=case.title,
        category=case.category,
        severity=case.severity,
        status=case.status,
        incident_date=case.incident_date,
        suspect_info=case.suspect_info,
        financial_loss=case.financial_loss_amount,
        synthesized_narrative=case.synthesized_summary,
        evidence_list=[EvidenceResponse.model_validate(e) for e in case.evidence_items],
        verified_findings=[FindingResponse.model_validate(f) for f in case.findings if f.verification_status == "verified"],
        chronological_timeline=[TimelineEventResponse.model_validate(te) for te in case.timeline_events],
        custody_trail=custody_trail,
        legal_certificate=cert_data
    )

@router.get("/html", response_class=HTMLResponse)
def get_html_dossier(case_id: str, db: Session = Depends(get_db)):
    """
    Generates an official, printable HTML Dossier complete with:
    - Case Metadata & Executive AI Synthesis
    - Cryptographic Evidence Registry (SHA-256)
    - Suspect Profile & Financial Flow
    - Chronological Milestone Timeline
    - Section 65B Statutory Legal Certificate
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    html_content = render_html_dossier(case)

    log_custody_action(
        db=db,
        case_id=case.id,
        evidence_id=None,
        action_type="DOSSIER_PRINTED_OR_EXPORTED",
        actor="Investigator / Complainant",
        description="Official Printable Legal Dossier rendered with Section 65B Certificate"
    )

    return HTMLResponse(content=html_content)

@router.get("/certificate-65b", response_model=Certificate65BData)
def get_section_65b_certificate(case_id: str, db: Session = Depends(get_db)):
    """Generates the Section 65B / Section 63 BSA certificate for legal submission."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    return generate_certificate_data(case)
