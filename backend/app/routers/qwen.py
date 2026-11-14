"""
Qwen API Router — EvidenceVault
================================
Exposes all 7 Qwen AI capabilities as REST endpoints.

All endpoints:
- Require an existing case_id
- Return model status so the frontend can display it
- Never crash if the model is missing
- Always mark results for human review
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.case import Case
from app.schemas.qwen import (
    ModelStatusResponse,
    QwenCapabilityResponse,
    QwenAnalyzeAllResponse,
    QwenReportResponse,
)
from app.services.qwen_service import get_model_status
from app.services.qwen_analysis import (
    classify_incident,
    extract_entities_deep,
    extract_events,
    generate_timeline,
    detect_conflicts,
    detect_missing_info,
    generate_report,
    analyze_all,
)
from app.services.custody import log_custody_action

router = APIRouter(tags=["Qwen AI Analysis"])


# ─── Model Status ──────────────────────────────────────────────────────────────

@router.get("/qwen/status", response_model=ModelStatusResponse)
def qwen_model_status():
    """
    Returns the current status of the Qwen GGUF model.
    
    Statuses:
    - MODEL_NOT_FOUND: GGUF file not at configured path
    - MODEL_AVAILABLE: File found, not yet loaded into RAM
    - MODEL_LOADED: Model loaded and ready for inference
    - INFERENCE_ERROR: Error occurred during inference
    """
    return get_model_status()


# ─── Case-scoped helper ─────────────────────────────────────────────────────────

def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


# ─── 1. Incident Classification ────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/classify", response_model=QwenCapabilityResponse)
def qwen_classify(case_id: str, db: Session = Depends(get_db)):
    """
    Uses the fine-tuned Qwen model to classify the incident type from evidence text.
    
    Result includes: primary_category, sub_category, confidence, reasoning.
    Always marked for human review.
    """
    case = _get_case(case_id, db)
    result = classify_incident(case)

    if result.get("result"):
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_CLASSIFICATION_EXECUTED",
            actor="Qwen AI Engine",
            description=f"Incident classification: {result['result'].get('primary_category', 'unknown')}",
            details={"model_status": result.get("model_status")}
        )

    return result


# ─── 2. Entity Extraction ───────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/extract-entities", response_model=QwenCapabilityResponse)
def qwen_extract_entities(case_id: str, db: Session = Depends(get_db)):
    """
    Deep entity extraction using Qwen — people, organisations, locations,
    dates, amounts, identifiers.
    
    Supplements the existing regex-based extractor with LLM understanding.
    """
    case = _get_case(case_id, db)
    result = extract_entities_deep(case)

    if result.get("result"):
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_ENTITY_EXTRACTION_EXECUTED",
            actor="Qwen AI Engine",
            description="Deep entity extraction completed.",
            details={"model_status": result.get("model_status")}
        )

    return result


# ─── 3. Event Extraction ────────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/extract-events", response_model=QwenCapabilityResponse)
def qwen_extract_events(case_id: str, db: Session = Depends(get_db)):
    """
    Extracts meaningful events from evidence text.
    Each event includes date, description, and evidence reference.
    """
    case = _get_case(case_id, db)
    result = extract_events(case)

    if result.get("result"):
        events_count = len(result["result"].get("events", []))
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_EVENT_EXTRACTION_EXECUTED",
            actor="Qwen AI Engine",
            description=f"Event extraction completed. {events_count} events identified.",
            details={"events_count": events_count, "model_status": result.get("model_status")}
        )

    return result


# ─── 4. Timeline Generation ─────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/timeline", response_model=QwenCapabilityResponse)
def qwen_timeline(case_id: str, db: Session = Depends(get_db)):
    """
    Generates a chronological timeline from evidence-extracted events.
    
    Never invents dates. Only arranges events that have dates in the evidence.
    """
    case = _get_case(case_id, db)
    result = generate_timeline(case)

    if result.get("result"):
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_TIMELINE_GENERATED",
            actor="Qwen AI Engine",
            description="Chronological timeline generated.",
            details={"model_status": result.get("model_status")}
        )

    return result


# ─── 5. Conflict Detection ──────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/conflicts", response_model=QwenCapabilityResponse)
def qwen_conflicts(case_id: str, db: Session = Depends(get_db)):
    """
    Identifies potential inconsistencies across evidence items.
    
    Checks for conflicting dates, amounts, statements, and identities.
    Never makes accusations — flags for human investigator review only.
    """
    case = _get_case(case_id, db)
    result = detect_conflicts(case)

    if result.get("result"):
        conflicts_count = len(result["result"].get("conflicts", []))
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_CONFLICT_DETECTION_EXECUTED",
            actor="Qwen AI Engine",
            description=f"Conflict detection completed. {conflicts_count} potential inconsistencies flagged.",
            details={"conflicts_count": conflicts_count, "model_status": result.get("model_status")}
        )

    return result


# ─── 6. Missing Information Detection ──────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/missing-info", response_model=QwenCapabilityResponse)
def qwen_missing_info(case_id: str, db: Session = Depends(get_db)):
    """
    Identifies relevant missing details that could strengthen the case.
    Provides investigative guidance on what additional evidence to gather.
    """
    case = _get_case(case_id, db)
    result = detect_missing_info(case)

    if result.get("result"):
        log_custody_action(
            db=db, case_id=case_id, evidence_id=None,
            action_type="QWEN_MISSING_INFO_ANALYSIS_EXECUTED",
            actor="Qwen AI Engine",
            description="Missing information analysis completed.",
            details={"model_status": result.get("model_status")}
        )

    return result


# ─── 7. Incident Report ─────────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/report", response_model=QwenReportResponse)
def qwen_report(case_id: str, db: Session = Depends(get_db)):
    """
    Generates a comprehensive AI-assisted incident report.
    
    Includes: incident overview, AI classification, entities, timeline,
    conflicts, missing info, evidence index, and human review notes.
    
    All sections are marked for human verification.
    """
    case = _get_case(case_id, db)
    result = generate_report(case)

    log_custody_action(
        db=db, case_id=case_id, evidence_id=None,
        action_type="QWEN_REPORT_GENERATED",
        actor="Qwen AI Engine",
        description="Comprehensive AI incident report generated.",
        details={"model_status": result.get("model_status")}
    )

    return result


# ─── Analyze All (runs all 7) ────────────────────────────────────────────────────

@router.post("/cases/{case_id}/qwen/analyze-all", response_model=QwenAnalyzeAllResponse)
def qwen_analyze_all(case_id: str, db: Session = Depends(get_db)):
    """
    Runs all 7 Qwen AI capabilities in sequence:
    1. Incident Classification
    2. Entity Extraction
    3. Event Extraction
    4. Timeline Generation
    5. Conflict Detection
    6. Missing Information Detection
    7. Report Generation
    
    Individual failures don't block other analyses.
    Returns a combined result with all outputs.
    """
    case = _get_case(case_id, db)
    result = analyze_all(case)

    log_custody_action(
        db=db, case_id=case_id, evidence_id=None,
        action_type="QWEN_FULL_ANALYSIS_EXECUTED",
        actor="Qwen AI Engine",
        description="Full 7-capability Qwen AI analysis pipeline executed.",
        details={
            "evidence_count": len(case.evidence_items),
            "model_status": result.get("model_status"),
        }
    )

    return result
