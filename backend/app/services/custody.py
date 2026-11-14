import json
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from app.models.custody import ChainOfCustodyLog

def log_custody_action(
    db: Session,
    case_id: Optional[str],
    evidence_id: Optional[str],
    action_type: str,
    actor: str,
    description: str,
    details: Optional[Dict[str, Any]] = None,
    sha256_hash: Optional[str] = None
) -> ChainOfCustodyLog:
    """
    Appends an immutable audit event to the digital chain of custody.
    """
    log_entry = ChainOfCustodyLog(
        case_id=case_id,
        evidence_id=evidence_id,
        action_type=action_type,
        actor=actor,
        description=description,
        details_json=json.dumps(details) if details else None,
        sha256_recorded=sha256_hash
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry
