from datetime import datetime
from typing import List
from app.models.case import Case
from app.models.timeline import TimelineEvent
from app.services.extractor import extract_dates_and_times

def auto_generate_case_timeline(case: Case) -> List[TimelineEvent]:
    """
    Analyzes evidence in the case to reconstruct a chronological event timeline.
    Returns suggested TimelineEvent instances to be persisted.
    """
    suggested_events: List[TimelineEvent] = []
    seen_event_keys = set()

    # Pre-populate with existing events to prevent duplicates
    for ev in case.timeline_events:
        seen_event_keys.add(f"{ev.event_date}_{ev.title.lower()}")

    # 1. First event: Incident creation / initial reported date
    if case.incident_date:
        key = f"{case.incident_date}_first contact reported"
        if key not in seen_event_keys:
            suggested_events.append(TimelineEvent(
                case_id=case.id,
                event_date=case.incident_date,
                event_time=case.incident_time,
                title=f"Incident Began on {case.platform or 'Digital Channel'}",
                description=f"First interaction with suspect/fraudulent entity. {case.description or ''}".strip(),
                source="extracted",
                is_verified=1
            ))
            seen_event_keys.add(key)

    # 2. Extract from Evidence findings and text
    for item in case.evidence_items:
        text = item.extracted_text or ""
        dates_and_times = extract_dates_and_times(f"{item.original_filename} {text}")
        
        event_date = dates_and_times[0]["date"] if dates_and_times else item.created_at.strftime("%Y-%m-%d")
        event_time = dates_and_times[0]["time"] if dates_and_times else item.created_at.strftime("%H:%M:%S")

        # Determine appropriate title based on file category and findings
        title = f"Evidence Captured: {item.original_filename}"
        desc = f"Uploaded {item.file_type.upper()} file with hash SHA-256: {item.sha256_hash[:16]}..."

        # Look for financial or threat findings in this evidence
        threat_findings = [f for f in item.findings if f.finding_type == "keyword"]
        financial_findings = [f for f in item.findings if f.finding_type == "financial"]

        if threat_findings:
            title = f"Threat / Scam Coercion Detected"
            desc = f"Indicators: {', '.join([f.finding_value for f in threat_findings[:3]])}. Evidenced in {item.original_filename}"
        elif financial_findings:
            title = f"Financial Transfer / Demand Logged"
            desc = f"Entities: {', '.join([f.finding_value for f in financial_findings[:3]])}. Evidenced in {item.original_filename}"

        key = f"{event_date}_{title.lower()}"
        if key not in seen_event_keys:
            suggested_events.append(TimelineEvent(
                case_id=case.id,
                evidence_id=item.id,
                event_date=event_date,
                event_time=event_time,
                title=title,
                description=desc,
                source="extracted",
                is_verified=0
            ))
            seen_event_keys.add(key)

    return suggested_events
