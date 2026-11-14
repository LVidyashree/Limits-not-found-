"""
Qwen AI Analysis Service — EvidenceVault
=========================================
Implements the 7 AI capabilities using the loaded Qwen model.

All functions:
  - Accept extracted text from OCR / Whisper
  - Return structured Python dicts (ready for JSON serialisation)
  - Fail gracefully with MODEL_NOT_FOUND / INFERENCE_ERROR states
  - Never invent facts or make accusations
"""

import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

from app.services.qwen_service import run_json_inference, get_model_status, ModelStatus
from app.models.case import Case

logger = logging.getLogger(__name__)

# ─── Shared helpers ────────────────────────────────────────────────────────────

JSON_INSTRUCTION = (
    "Respond ONLY with valid JSON. No explanations, no markdown prose outside the JSON block. "
    "Do not invent any facts. Only analyse the provided text."
)


def _build_evidence_corpus(case: Case) -> str:
    """Concatenate all extracted text from case evidence into one corpus."""
    parts = []
    for ev in case.evidence_items:
        if ev.extracted_text:
            parts.append(
                f"[Evidence ID: {ev.id} | File: {ev.original_filename}]\n"
                f"{ev.extracted_text}\n"
            )
    return "\n---\n".join(parts) if parts else ""


def _no_model_response(capability: str) -> Dict[str, Any]:
    status = get_model_status()
    return {
        "capability": capability,
        "model_status": status["status"],
        "error": status["message"],
        "result": None,
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 1. Incident Classification ────────────────────────────────────────────────

def classify_incident(case: Case) -> Dict[str, Any]:
    """
    Classify the incident category from evidence text.
    Returns the most likely cybercrime/fraud category with confidence and reasoning.
    """
    corpus = _build_evidence_corpus(case)
    if not corpus:
        return {**_no_model_response("incident_classification"),
                "error": "No extracted text available in evidence."}

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic AI analyst. Classify the incident type based solely on the provided evidence text.

Respond with this exact JSON structure:
{{
  "primary_category": "string — the most likely incident type (e.g. Financial Fraud, Digital Arrest Scam, Investment Scam, Sextortion, Phishing, Identity Theft, Cyber Stalking, Job Scam, Other)",
  "sub_category": "string — specific sub-type if identifiable, else null",
  "confidence": "high | medium | low",
  "reasoning": "string — 1-2 sentences based only on evidence text",
  "alternative_categories": ["array of other plausible categories, can be empty"],
  "human_review_required": true,
  "disclaimer": "This is an AI-assisted classification for investigative purposes only. Human verification is mandatory."
}}
"""

    user_prompt = (
        f"Case title: {case.title}\n"
        f"Case description: {case.description or 'Not provided'}\n\n"
        f"Evidence corpus:\n{corpus[:6000]}"
    )

    result = run_json_inference(system_prompt, user_prompt, max_tokens=512)

    return {
        "capability": "incident_classification",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 2. Entity Extraction ───────────────────────────────────────────────────────

def extract_entities_deep(case: Case) -> Dict[str, Any]:
    """
    Deep entity extraction using LLM — supplements the existing regex extractor.
    Extracts people, organisations, locations, dates, amounts, identifiers.
    """
    corpus = _build_evidence_corpus(case)
    if not corpus:
        return {**_no_model_response("entity_extraction"),
                "error": "No extracted text available in evidence."}

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic analyst. Extract named entities from the evidence text.
Only extract entities explicitly mentioned in the text. Do not invent anything.

Respond with this exact JSON structure:
{{
  "people": [{{"name": "string", "role": "string or null", "evidence_reference": "evidence ID or filename"}}],
  "organisations": [{{"name": "string", "type": "string or null", "evidence_reference": "string"}}],
  "locations": [{{"name": "string", "type": "city|state|country|address|platform|other", "evidence_reference": "string"}}],
  "dates": [{{"date": "string", "context": "what happened on this date", "evidence_reference": "string"}}],
  "amounts": [{{"value": "string", "currency": "string or null", "context": "string", "evidence_reference": "string"}}],
  "identifiers": [{{"type": "string", "value": "string", "context": "string", "evidence_reference": "string"}}],
  "disclaimer": "AI-extracted entities. All must be verified against source evidence before use."
}}
"""

    user_prompt = f"Evidence corpus:\n{corpus[:6000]}"

    result = run_json_inference(system_prompt, user_prompt, max_tokens=1024)

    return {
        "capability": "entity_extraction",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 3. Event Extraction ────────────────────────────────────────────────────────

def extract_events(case: Case) -> Dict[str, Any]:
    """
    Extract meaningful events from evidence text.
    Each event gets a date, description, and evidence reference.
    """
    corpus = _build_evidence_corpus(case)
    if not corpus:
        return {**_no_model_response("event_extraction"),
                "error": "No extracted text available in evidence."}

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic analyst. Extract all meaningful events described in the evidence.
Only events explicitly described in the text. Never invent or guess dates.

Respond with this exact JSON structure:
{{
  "events": [
    {{
      "event_title": "string — brief title",
      "description": "string — what happened",
      "date": "YYYY-MM-DD or partial date if only month/year known, or null if unknown",
      "time": "HH:MM or null",
      "evidence_id": "evidence ID from corpus header",
      "evidence_filename": "filename from corpus header",
      "confidence": "high | medium | low"
    }}
  ],
  "disclaimer": "Events extracted from evidence text only. No events were invented."
}}
"""

    user_prompt = f"Evidence corpus:\n{corpus[:6000]}"

    result = run_json_inference(system_prompt, user_prompt, max_tokens=1024)

    return {
        "capability": "event_extraction",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 4. Timeline Generation ─────────────────────────────────────────────────────

def generate_timeline(case: Case) -> Dict[str, Any]:
    """
    Arrange extracted events chronologically.
    Never invents dates — uses only what is in the evidence.
    """
    # First get events
    events_result = extract_events(case)

    if not events_result.get("result"):
        return {
            "capability": "timeline_generation",
            "model_status": events_result.get("model_status", ModelStatus.INFERENCE_ERROR),
            "error": events_result.get("error", "Event extraction failed — cannot build timeline."),
            "result": None,
            "human_review_required": True,
            "timestamp": datetime.utcnow().isoformat(),
        }

    events_data = events_result["result"]

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic analyst. Sort these events chronologically.
If a date is unknown, place it at the end under "undated_events".
Never invent or modify dates.

Respond with this exact JSON structure:
{{
  "chronological_events": [
    {{
      "sequence": 1,
      "event_title": "string",
      "description": "string",
      "date": "string or null",
      "time": "string or null",
      "evidence_id": "string",
      "evidence_filename": "string",
      "confidence": "high | medium | low"
    }}
  ],
  "undated_events": [],
  "timeline_start": "earliest date in YYYY-MM-DD or null",
  "timeline_end": "latest date in YYYY-MM-DD or null",
  "disclaimer": "Chronological order based solely on dates found in evidence. Human verification required."
}}
"""

    import json as _json
    user_prompt = (
        f"Sort these events chronologically:\n"
        f"{_json.dumps(events_data, indent=2)}"
    )

    result = run_json_inference(system_prompt, user_prompt, max_tokens=1024)

    return {
        "capability": "timeline_generation",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 5. Conflict Detection ──────────────────────────────────────────────────────

def detect_conflicts(case: Case) -> Dict[str, Any]:
    """
    Identify potentially inconsistent information across evidence.
    Never accuses anyone — only flags inconsistencies for human review.
    """
    corpus = _build_evidence_corpus(case)
    if not corpus:
        return {**_no_model_response("conflict_detection"),
                "error": "No extracted text available in evidence."}

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic analyst looking for factual inconsistencies across evidence.
Do NOT accuse anyone. Only flag potential inconsistencies for human investigators.
Only flag issues that are clearly present in the text.

Respond with this exact JSON structure:
{{
  "conflicts": [
    {{
      "conflict_type": "date_inconsistency | amount_inconsistency | statement_inconsistency | identity_inconsistency | other",
      "description": "string — what appears inconsistent",
      "evidence_a_id": "evidence ID or filename",
      "evidence_a_excerpt": "brief quote from evidence A",
      "evidence_b_id": "evidence ID or filename",
      "evidence_b_excerpt": "brief quote from evidence B",
      "significance": "high | medium | low",
      "investigator_note": "what a human investigator should check"
    }}
  ],
  "total_conflicts_found": 0,
  "disclaimer": "These are potential inconsistencies flagged for human review only. No accusations are made. All findings require investigator verification."
}}
"""

    user_prompt = f"Evidence corpus:\n{corpus[:6000]}"

    result = run_json_inference(system_prompt, user_prompt, max_tokens=1024)

    return {
        "capability": "conflict_detection",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 6. Missing Information Detection ──────────────────────────────────────────

def detect_missing_info(case: Case) -> Dict[str, Any]:
    """
    Identify relevant missing details that could help clarify the incident.
    """
    corpus = _build_evidence_corpus(case)
    if not corpus:
        return {**_no_model_response("missing_info_detection"),
                "error": "No extracted text available in evidence."}

    system_prompt = f"""{JSON_INSTRUCTION}

You are a forensic analyst. Based on the evidence provided, identify what information 
is missing that would typically be important in an investigation of this type.
Only suggest information gaps that are genuinely relevant to this case.

Respond with this exact JSON structure:
{{
  "missing_information": [
    {{
      "category": "identity | timeline | financial | communication | witness | documentation | other",
      "description": "string — what information is missing",
      "importance": "critical | important | helpful",
      "how_to_obtain": "string — suggested ways to obtain this information",
      "relates_to_evidence": "which evidence this gap relates to, or 'case overall'"
    }}
  ],
  "completeness_assessment": "string — overall assessment of evidence completeness",
  "disclaimer": "Missing information suggestions are for investigative guidance only. Human investigator judgement is required."
}}
"""

    user_prompt = (
        f"Case: {case.title} ({case.category})\n"
        f"Platform: {case.platform or 'Unknown'}\n\n"
        f"Evidence corpus:\n{corpus[:6000]}"
    )

    result = run_json_inference(system_prompt, user_prompt, max_tokens=768)

    return {
        "capability": "missing_info_detection",
        "model_status": result["status"],
        "error": result.get("error") or result.get("parse_error"),
        "result": result.get("data"),
        "raw_model_output": result.get("raw_text", "")[:500],
        "human_review_required": True,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── 7. Report Generation ───────────────────────────────────────────────────────

def generate_report(case: Case) -> Dict[str, Any]:
    """
    Generate a structured AI incident report combining all 7 analyses.
    This runs all sub-analyses and assembles the final report.
    """
    corpus = _build_evidence_corpus(case)

    # Gather all analyses
    classification = classify_incident(case)
    entities = extract_entities_deep(case)
    timeline = generate_timeline(case)
    conflicts = detect_conflicts(case)
    missing = detect_missing_info(case)

    report = {
        "capability": "incident_report",
        "model_status": classification.get("model_status", ModelStatus.INFERENCE_ERROR),
        "timestamp": datetime.utcnow().isoformat(),
        "human_review_required": True,
        "report": {
            "incident_overview": {
                "case_id": case.id,
                "case_title": case.title,
                "case_category_declared": case.category,
                "severity": case.severity,
                "platform": case.platform,
                "incident_date": case.incident_date,
                "evidence_count": len(case.evidence_items),
                "evidence_index": [
                    {
                        "id": ev.id,
                        "filename": ev.original_filename,
                        "file_type": ev.file_type,
                        "sha256_hash": ev.sha256_hash,
                    }
                    for ev in case.evidence_items
                ],
            },
            "ai_incident_classification": classification.get("result"),
            "extracted_entities": entities.get("result"),
            "chronological_timeline": timeline.get("result"),
            "conflict_analysis": conflicts.get("result"),
            "missing_information": missing.get("result"),
            "sub_analysis_statuses": {
                "classification": classification.get("model_status"),
                "entities": entities.get("model_status"),
                "timeline": timeline.get("model_status"),
                "conflicts": conflicts.get("model_status"),
                "missing_info": missing.get("model_status"),
            },
            "human_review_notes": (
                "⚠️ IMPORTANT: This report is AI-assisted and must be reviewed by a qualified investigator. "
                "No findings are legally conclusive. "
                "All entity extractions, event identifications, and conflict flags require human verification. "
                "This report does not constitute legal advice or admissibility certification."
            ),
            "legal_disclaimer": (
                "EvidenceVault processes evidence locally. No data was transmitted to external AI services. "
                "AI analysis is for investigative assistance only. "
                "SHA-256 cryptographic hashes preserve evidence integrity."
            ),
        },
        "errors": {
            k: v.get("error")
            for k, v in {
                "classification": classification,
                "entities": entities,
                "timeline": timeline,
                "conflicts": conflicts,
                "missing": missing,
            }.items()
            if v.get("error")
        },
    }

    return report


# ─── Analyze All (convenience wrapper) ─────────────────────────────────────────

def analyze_all(case: Case) -> Dict[str, Any]:
    """
    Runs all 7 AI capabilities and returns a combined result.
    Individual failures don't block other analyses.
    """
    results = {}

    capabilities = [
        ("classification",  classify_incident),
        ("entities",        extract_entities_deep),
        ("events",          extract_events),
        ("timeline",        generate_timeline),
        ("conflicts",       detect_conflicts),
        ("missing_info",    detect_missing_info),
    ]

    for name, fn in capabilities:
        try:
            results[name] = fn(case)
        except Exception as exc:
            logger.error(f"[QwenAnalysis] {name} failed: {exc}")
            results[name] = {
                "capability": name,
                "model_status": ModelStatus.INFERENCE_ERROR,
                "error": str(exc),
                "result": None,
                "human_review_required": True,
                "timestamp": datetime.utcnow().isoformat(),
            }

    # Generate report (runs all internally, but we pass cached results)
    try:
        report = generate_report(case)
        results["report"] = report
    except Exception as exc:
        logger.error(f"[QwenAnalysis] report generation failed: {exc}")
        results["report"] = {
            "capability": "incident_report",
            "model_status": ModelStatus.INFERENCE_ERROR,
            "error": str(exc),
            "result": None,
            "human_review_required": True,
            "timestamp": datetime.utcnow().isoformat(),
        }

    return {
        "case_id": case.id,
        "case_title": case.title,
        "analysis_timestamp": datetime.utcnow().isoformat(),
        "model_status": get_model_status()["status"],
        "results": results,
        "human_review_required": True,
    }
