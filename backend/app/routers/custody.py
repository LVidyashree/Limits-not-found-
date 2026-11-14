from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from app.database import get_db
from app.models.case import Case
from app.models.custody import ChainOfCustodyLog
from app.services.storage import verify_file_hash
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases/{case_id}/custody", tags=["Chain of Custody & Audit Trail"])

@router.get("", response_model=List[Dict[str, Any]])
def get_custody_trail(case_id: str, db: Session = Depends(get_db)):
    """Retrieves the complete, immutable chain-of-custody audit trail for the case."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    logs = db.query(ChainOfCustodyLog).filter(
        ChainOfCustodyLog.case_id == case_id
    ).order_by(ChainOfCustodyLog.timestamp.asc()).all()

    return [
        {
            "id": log.id,
            "timestamp": log.timestamp.isoformat(),
            "action_type": log.action_type,
            "actor": log.actor,
            "description": log.description,
            "evidence_id": log.evidence_id,
            "sha256_recorded": log.sha256_recorded
        }
        for log in logs
    ]

@router.post("/verify-all")
def verify_all_case_evidence(case_id: str, db: Session = Depends(get_db)):
    """
    Runs an exhaustive bit-level cryptographic verification check on EVERY
    evidence file associated with this case to detect any tampering or disk corruption.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    results = []
    all_passed = True

    for ev in case.evidence_items:
        is_intact = verify_file_hash(ev.file_path, ev.sha256_hash)
        if not is_intact:
            all_passed = False
        results.append({
            "evidence_id": ev.id,
            "original_filename": ev.original_filename,
            "sha256_recorded": ev.sha256_hash,
            "file_size": ev.file_size,
            "integrity_verified": is_intact
        })

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=None,
        action_type="BATCH_FORENSIC_AUDIT",
        actor="System Auditor",
        description=f"Batch forensic audit executed across {len(results)} files. Result: {'ALL_INTACT' if all_passed else 'CORRUPTION_DETECTED'}",
        details={"total_files": len(results), "all_intact": all_passed}
    )

    return {
        "case_id": case_id,
        "total_files_checked": len(results),
        "overall_integrity_intact": all_passed,
        "evidence_audit_results": results
    }
