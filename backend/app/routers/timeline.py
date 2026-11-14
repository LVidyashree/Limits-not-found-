from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.case import Case
from app.models.timeline import TimelineEvent
from app.schemas.timeline import TimelineEventCreate, TimelineEventResponse
from app.services.timeline_service import auto_generate_case_timeline
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases/{case_id}/timeline", tags=["Timeline Reconstruction"])

@router.get("", response_model=List[TimelineEventResponse])
def get_timeline(case_id: str, db: Session = Depends(get_db)):
    """Retrieves all timeline milestones in chronological sequence."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    events = db.query(TimelineEvent).filter(
        TimelineEvent.case_id == case_id
    ).order_by(TimelineEvent.event_date.asc(), TimelineEvent.event_time.asc()).all()

    return events

@router.post("", response_model=TimelineEventResponse, status_code=status.HTTP_201_CREATED)
def add_timeline_event(
    case_id: str,
    event_in: TimelineEventCreate,
    db: Session = Depends(get_db)
):
    """Allows the victim or investigator to manually add an incident event to the timeline."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    event = TimelineEvent(
        case_id=case_id,
        evidence_id=event_in.evidence_id,
        finding_id=event_in.finding_id,
        event_date=event_in.event_date,
        event_time=event_in.event_time,
        title=event_in.title,
        description=event_in.description,
        source="manual",
        is_verified=1
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=event.evidence_id,
        action_type="TIMELINE_EVENT_ADDED",
        actor="Investigator / Complainant",
        description=f"Manual timeline entry added: '{event.title}' on {event.event_date}"
    )

    return event

@router.post("/auto-generate", response_model=List[TimelineEventResponse])
def auto_reconstruct_timeline(case_id: str, db: Session = Depends(get_db)):
    """Auto-reconstructs chronological timeline events from all evidence in the case."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    new_events = auto_generate_case_timeline(case)
    for ev in new_events:
        db.add(ev)
    db.commit()

    all_events = db.query(TimelineEvent).filter(
        TimelineEvent.case_id == case_id
    ).order_by(TimelineEvent.event_date.asc(), TimelineEvent.event_time.asc()).all()

    return all_events
