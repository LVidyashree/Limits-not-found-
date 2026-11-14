from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional

from app.database import get_db
from app.models.case import Case
from app.models.evidence import Evidence
from app.models.finding import Finding
from app.schemas.case import (
    CaseCreate,
    CaseUpdate,
    CaseResponse,
    CaseDetailResponse,
    CaseStatistics
)
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases", tags=["Cases / Incidents"])

@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
def create_case(case_in: CaseCreate, db: Session = Depends(get_db)):
    """Creates a new cybercrime incident / evidence case."""
    db_case = Case(
        title=case_in.title,
        category=case_in.category,
        description=case_in.description,
        incident_date=case_in.incident_date,
        incident_time=case_in.incident_time,
        platform=case_in.platform,
        suspect_info=case_in.suspect_info,
        severity=case_in.severity,
        status="active"
    )
    db.add(db_case)
    db.commit()
    db.refresh(db_case)

    log_custody_action(
        db=db,
        case_id=db_case.id,
        evidence_id=None,
        action_type="CASE_CREATED",
        actor="Victim / Complainant",
        description=f"Incident registered: '{db_case.title}' ({db_case.category})"
    )

    return db_case

@router.get("", response_model=List[CaseResponse])
def list_cases(
    category: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Lists cases with optional filters for investigators and dashboard overview."""
    query = db.query(Case)
    if category:
        query = query.filter(Case.category.ilike(f"%{category}%"))
    if severity:
        query = query.filter(Case.severity == severity.lower())
    if status:
        query = query.filter(Case.status == status.lower())
    if search:
        query = query.filter(
            (Case.title.ilike(f"%{search}%")) |
            (Case.description.ilike(f"%{search}%")) |
            (Case.suspect_info.ilike(f"%{search}%"))
        )
    return query.order_by(Case.created_at.desc()).offset(skip).limit(limit).all()

@router.get("/statistics", response_model=CaseStatistics)
def get_dashboard_statistics(db: Session = Depends(get_db)):
    """Computes high-level aggregated statistics for the investigation dashboard."""
    total_cases = db.query(func.count(Case.id)).scalar() or 0
    active_cases = db.query(func.count(Case.id)).filter(Case.status == "active").scalar() or 0
    critical_cases = db.query(func.count(Case.id)).filter(Case.severity == "critical").scalar() or 0
    total_evidence = db.query(func.count(Evidence.id)).scalar() or 0
    total_verified_findings = db.query(func.count(Finding.id)).filter(Finding.verification_status == "verified").scalar() or 0
    total_loss = db.query(func.sum(Case.financial_loss_amount)).scalar() or 0.0

    return CaseStatistics(
        total_cases=total_cases,
        active_cases=active_cases,
        critical_cases=critical_cases,
        total_evidence_items=total_evidence,
        total_verified_findings=total_verified_findings,
        total_financial_loss=float(total_loss)
    )

@router.get("/{case_id}", response_model=CaseDetailResponse)
def get_case_detail(case_id: str, db: Session = Depends(get_db)):
    """Retrieves full case details, including evidence items and timeline events."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    verified_findings = db.query(func.count(Finding.id)).filter(
        Finding.case_id == case_id,
        Finding.verification_status == "verified"
    ).scalar() or 0

    pending_findings = db.query(func.count(Finding.id)).filter(
        Finding.case_id == case_id,
        Finding.verification_status == "needs_verification"
    ).scalar() or 0

    response_data = CaseDetailResponse.model_validate(case)
    response_data.total_evidence_count = len(case.evidence_items)
    response_data.verified_findings_count = verified_findings
    response_data.pending_findings_count = pending_findings

    return response_data

@router.patch("/{case_id}", response_model=CaseResponse)
def update_case(case_id: str, case_update: CaseUpdate, db: Session = Depends(get_db)):
    """Updates case fields (e.g. status transition to 'submitted', severity, loss amount)."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    update_data = case_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(case, field, value)

    db.commit()
    db.refresh(case)

    log_custody_action(
        db=db,
        case_id=case.id,
        evidence_id=None,
        action_type="CASE_UPDATED",
        actor="Investigator / User",
        description=f"Case record updated with modified fields: {', '.join(update_data.keys())}"
    )

    return case

@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(case_id: str, db: Session = Depends(get_db)):
    """Deletes a case and cascades deletion to all associated evidence and logs."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    db.delete(case)
    db.commit()
    return None
