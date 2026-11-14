import json
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.case import Case
from app.models.evidence import Evidence
from app.models.finding import Finding
from app.schemas.evidence import EvidenceResponse, EvidenceDetailResponse, EvidenceVerifyRequest
from app.services.storage import save_upload_and_hash, verify_file_hash
from app.services.ocr import extract_text_from_file, run_image_ocr
from app.services.speech import transcribe_audio
from app.services.extractor import extract_entities_from_text
from app.services.custody import log_custody_action

router = APIRouter(prefix="/cases/{case_id}/evidence", tags=["Evidence Management"])

@router.post("", response_model=EvidenceDetailResponse, status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    case_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Ingests an evidence item (screenshot, bank statement, chat export, audio, receipt):
    1. Streams and saves file into the vault.
    2. Calculates SHA-256 hash immediately for digital forensics integrity.
    3. Runs OCR / text extraction on file content.
    4. Automatically extracts forensic entities (UPI, phone, crypto, UTR, threat terms).
    5. Appends an entry into the immutable chain of custody audit log.
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # 1. Save and compute SHA-256
    filename, file_path, file_size, sha256_hash, category, metadata = await save_upload_and_hash(case_id, file)

    # 2. Extract text / transcribe speech based on category
    if category == "audio":
        audio_result = transcribe_audio(file_path)
        extracted_text = audio_result.get("text", "")
        metadata["audio_transcription"] = {
            "language": audio_result.get("language"),
            "segments_count": len(audio_result.get("segments", [])),
            "status": audio_result.get("status")
        }
    else:
        # OCR for images, PyPDF for pdfs, or direct read for text
        extracted_text = extract_text_from_file(file_path, category)

    # 3. Create Evidence record
    db_evidence = Evidence(
        case_id=case_id,
        filename=filename,
        original_filename=file.filename or filename,
        file_path=file_path,
        file_size=file_size,
        file_type=category,
        mime_type=file.content_type or "application/octet-stream",
        sha256_hash=sha256_hash,
        processing_status="completed",
        extracted_text=extracted_text,
        metadata_json=json.dumps(metadata),
        is_verified=0
    )
    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)

    # 4. Extract Forensic Entities from text + original filename
    full_text = f"{file.filename or ''}\n{extracted_text}"
    extracted_findings = extract_entities_from_text(full_text)

    for f_item in extracted_findings:
        finding = Finding(
            case_id=case_id,
            evidence_id=db_evidence.id,
            finding_type=f_item["finding_type"],
            finding_value=f_item["finding_value"],
            label=f_item["label"],
            context_snippet=f_item.get("context_snippet"),
            confidence=f_item.get("confidence", 0.90),
            verification_status="needs_verification",
            user_notes=f_item.get("user_notes")
        )
        db.add(finding)

    db.commit()

    # 5. Log immutable chain of custody
    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=db_evidence.id,
        action_type="EVIDENCE_INGESTED",
        actor="Victim / System",
        description=f"Evidence '{db_evidence.original_filename}' ingested with SHA-256: {sha256_hash}",
        details={
            "file_size": file_size,
            "category": category,
            "findings_count": len(extracted_findings)
        },
        sha256_hash=sha256_hash
    )

    db.refresh(db_evidence)
    return db_evidence

@router.get("", response_model=List[EvidenceResponse])
def list_case_evidence(case_id: str, db: Session = Depends(get_db)):
    """Lists all evidence items attached to a case."""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case.evidence_items

@router.get("/{evidence_id}", response_model=EvidenceDetailResponse)
def get_evidence_detail(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Retrieves full details, extracted text, and findings for a specific evidence item."""
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return evidence

@router.get("/{evidence_id}/download")
def download_evidence_file(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Serves the raw evidence file for download or inspection."""
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence or not os.path.exists(evidence.file_path):
        raise HTTPException(status_code=404, detail="Evidence file missing or not found")

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=evidence.id,
        action_type="EVIDENCE_ACCESSED",
        actor="Authorized User",
        description=f"Raw evidence file '{evidence.original_filename}' downloaded/inspected",
        sha256_hash=evidence.sha256_hash
    )

    return FileResponse(
        path=evidence.file_path,
        filename=evidence.original_filename,
        media_type=evidence.mime_type
    )

@router.post("/{evidence_id}/verify-hash")
def verify_evidence_integrity(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """
    Performs on-demand cryptographic hash verification of the stored file.
    Confirms whether the file on disk is bit-for-bit identical to its original ingestion hash.
    """
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    is_intact = verify_file_hash(evidence.file_path, evidence.sha256_hash)

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=evidence.id,
        action_type="HASH_VERIFICATION_CHECK",
        actor="System Auditor",
        description=f"Cryptographic integrity check for '{evidence.original_filename}': {'PASSED' if is_intact else 'FAILED'}",
        details={"intact": is_intact, "recorded_hash": evidence.sha256_hash},
        sha256_hash=evidence.sha256_hash
    )

    return {
        "evidence_id": evidence.id,
        "filename": evidence.original_filename,
        "recorded_sha256": evidence.sha256_hash,
        "integrity_verified": is_intact,
        "status": "VALID_AUTHENTIC" if is_intact else "TAMPER_DETECTED"
    }

@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Deletes an evidence file from the vault and database."""
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    if os.path.exists(evidence.file_path):
        try:
            os.remove(evidence.file_path)
        except Exception:
            pass

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=None,
        action_type="EVIDENCE_PURGED",
        actor="Investigator / Admin",
        description=f"Evidence '{evidence.original_filename}' purged from vault",
        sha256_hash=evidence.sha256_hash
    )

    db.delete(evidence)
    db.commit()
    return None

@router.post("/{evidence_id}/ocr", response_model=EvidenceDetailResponse)
def trigger_image_ocr(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Explicitly triggers or re-runs Tesseract OCR on an image evidence file."""
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    text = run_image_ocr(evidence.file_path)
    evidence.extracted_text = text
    
    # Extract entities from the fresh OCR output
    findings = extract_entities_from_text(f"{evidence.original_filename}\n{text}")
    for f_item in findings:
        db.add(Finding(
            case_id=case_id,
            evidence_id=evidence.id,
            finding_type=f_item["finding_type"],
            finding_value=f_item["finding_value"],
            label=f_item["label"],
            context_snippet=f_item.get("context_snippet"),
            confidence=f_item.get("confidence", 0.90),
            verification_status="needs_verification",
            user_notes=f_item.get("user_notes")
        ))
    
    db.commit()
    db.refresh(evidence)

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=evidence.id,
        action_type="OCR_PROCESSING_EXECUTED",
        actor="Tesseract OCR Engine",
        description=f"OCR executed on '{evidence.original_filename}'. Extracted {len(text)} characters and {len(findings)} findings.",
        sha256_hash=evidence.sha256_hash
    )

    return evidence

@router.post("/{evidence_id}/transcribe", response_model=EvidenceDetailResponse)
def trigger_audio_transcription(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    """Explicitly triggers Whisper Speech-to-Text on an audio evidence file."""
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.case_id == case_id
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    audio_res = transcribe_audio(evidence.file_path)
    text = audio_res.get("text", "")
    evidence.extracted_text = text
    
    # Extract entities from spoken transcript
    findings = extract_entities_from_text(f"{evidence.original_filename}\n{text}")
    for f_item in findings:
        db.add(Finding(
            case_id=case_id,
            evidence_id=evidence.id,
            finding_type=f_item["finding_type"],
            finding_value=f_item["finding_value"],
            label=f_item["label"],
            context_snippet=f_item.get("context_snippet"),
            confidence=f_item.get("confidence", 0.90),
            verification_status="needs_verification",
            user_notes=f_item.get("user_notes")
        ))

    db.commit()
    db.refresh(evidence)

    log_custody_action(
        db=db,
        case_id=case_id,
        evidence_id=evidence.id,
        action_type="AUDIO_TRANSCRIPTION_EXECUTED",
        actor="Whisper AI Engine",
        description=f"Whisper transcription completed on '{evidence.original_filename}' (Lang: {audio_res.get('language')}). Extracted {len(findings)} findings.",
        sha256_hash=evidence.sha256_hash
    )

    return evidence
