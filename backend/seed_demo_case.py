"""
Seed script to populate a realistic Digital Arrest & Investment Fraud case
demonstrating the complete Intelligent Evidence Synthesis pipeline.
"""
import os
import hashlib
from datetime import datetime
from app.database import SessionLocal, Base, engine
from app.models.case import Case
from app.models.evidence import Evidence
from app.models.finding import Finding
from app.models.timeline import TimelineEvent
from app.models.custody import ChainOfCustodyLog
from app.services.synthesis_service import synthesize_case_incident
from app.services.timeline_service import auto_generate_case_timeline
from app.config import settings

def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("Checking if demo case already exists...")
    existing = db.query(Case).filter(Case.title == "CBI Digital Arrest & Coerced Wire Transfer").first()
    if existing:
        print(f"Demo case already present (ID: {existing.id})")
        db.close()
        return

    print("Creating realistic cybercrime case: CBI Digital Arrest & Coerced Wire Transfer...")
    demo_case = Case(
        title="CBI Digital Arrest & Coerced Wire Transfer",
        category="Digital Arrest & Financial Extortion",
        description="Victim received Skype and WhatsApp video calls from suspects claiming to be officers of the Cyber Crime Cell and CBI. Falsely alleged a DHL package containing contraband in victim's name. Subjected victim to a 14-hour 'digital arrest' and coerced to transfer funds to a 'RBI verification liquidity account'.",
        incident_date="2026-11-10",
        incident_time="09:30 AM",
        platform="WhatsApp & Skype",
        suspect_info="Claimed Officer: 'Inspector Vikram Rathore, CBI New Delhi' (Phone: +91 98231 44219, Telegram: @cbi_cyber_helpdesk)",
        severity="critical",
        status="active",
        is_demo=1,
        financial_loss_amount=250000.0
    )
    db.add(demo_case)
    db.commit()
    db.refresh(demo_case)

    # 1. Evidence 1: Fake Police Summons PDF
    dummy_pdf_content = b"%PDF-1.4 Simulated CBI Arrest Warrant text: Case Ref CBI/DEL/2026/894. Immediate Arrest Order. Suspect contact: +91 98231 44219. Defamation and court summons."
    pdf_hash = hashlib.sha256(dummy_pdf_content).hexdigest()
    ev1_path = str(settings.UPLOAD_DIR / "simulated_cbi_warrant.pdf")
    with open(ev1_path, "wb") as f:
        f.write(dummy_pdf_content)

    ev1 = Evidence(
        case_id=demo_case.id,
        filename="simulated_cbi_warrant.pdf",
        original_filename="CBI_Official_Notice_Urgent_Arrest.pdf",
        file_path=ev1_path,
        file_size=len(dummy_pdf_content),
        file_type="pdf",
        mime_type="application/pdf",
        sha256_hash=pdf_hash,
        processing_status="completed",
        extracted_text="CENTRAL BUREAU OF INVESTIGATION - NEW DELHI\nARREST WARRANT & IMMEDIATE ARREST NOTICE\nCase File: CBI/DEL/2026/894\nOfficer Contact: +91 98231 44219\nTelegram Desk: @cbi_cyber_helpdesk\nLegal action initiated under Court Summons. Urgent wire transfer required for verification.",
        is_verified=1
    )
    db.add(ev1)

    # 2. Evidence 2: WhatsApp Chat Screenshot
    dummy_img_content = b"Simulated PNG bytes for WhatsApp extortion chat screenshot"
    img_hash = hashlib.sha256(dummy_img_content).hexdigest()
    ev2_path = str(settings.UPLOAD_DIR / "whatsapp_chat_evidence.png")
    with open(ev2_path, "wb") as f:
        f.write(dummy_img_content)

    ev2 = Evidence(
        case_id=demo_case.id,
        filename="whatsapp_chat_evidence.png",
        original_filename="WhatsApp_Chat_Threats_Screenshot.png",
        file_path=ev2_path,
        file_size=len(dummy_img_content),
        file_type="image",
        mime_type="image/png",
        sha256_hash=img_hash,
        processing_status="completed",
        extracted_text="Suspect (+91 98231 44219): You are placed under Digital Arrest. Do not disconnect the video call.\nSuspect: Send ₹2,50,000 security deposit immediately to clear your name.\nSuspect: Pay to verified UPI ID: clearance.verify@okhdfcbank or UTR reference will be canceled.\nPhishing portal: https://cybercrime-portal-verify.xyz/case-track",
        is_verified=1
    )
    db.add(ev2)

    # 3. Evidence 3: Bank Transfer Transaction Slip
    dummy_slip_content = b"Simulated Bank Transfer Slip UTR 321894729184"
    slip_hash = hashlib.sha256(dummy_slip_content).hexdigest()
    ev3_path = str(settings.UPLOAD_DIR / "bank_slip_evidence.pdf")
    with open(ev3_path, "wb") as f:
        f.write(dummy_slip_content)

    ev3 = Evidence(
        case_id=demo_case.id,
        filename="bank_slip_evidence.pdf",
        original_filename="NetBanking_Transaction_Receipt.pdf",
        file_path=ev3_path,
        file_size=len(dummy_slip_content),
        file_type="pdf",
        mime_type="application/pdf",
        sha256_hash=slip_hash,
        processing_status="completed",
        extracted_text="HDFC BANK - PAYMENT ACKNOWLEDGEMENT\nDebited: ₹2,50,000.00\nBeneficiary: clearance.verify@okhdfcbank\nUTR No: 321894729184\nIFSC Code: HDFC0001234\nDate: 2026-11-10 14:15:22\nStatus: SUCCESS",
        is_verified=1
    )
    db.add(ev3)
    db.commit()

    # Create Extracted Findings across evidence
    findings_data = [
        (ev1.id, "phone", "+91 98231 44219", "Suspect Extortion Line", "Officer Contact: +91 98231 44219", "verified"),
        (ev1.id, "account", "@cbi_cyber_helpdesk", "Suspect Telegram Channel", "Telegram Desk: @cbi_cyber_helpdesk", "verified"),
        (ev1.id, "keyword", "DIGITAL ARREST", "Indicator: Digital Arrest Scam (CRITICAL)", "You are placed under Digital Arrest", "verified"),
        (ev2.id, "phone", "+91 98231 44219", "Suspect Extortion Line (Correlated)", "Suspect (+91 98231 44219)", "verified"),
        (ev2.id, "financial", "₹2,50,000", "Extortion Demand Amount", "Send ₹2,50,000 security deposit", "verified"),
        (ev2.id, "financial", "clearance.verify@okhdfcbank", "Mule UPI Payment Handle", "Pay to verified UPI ID: clearance.verify@okhdfcbank", "verified"),
        (ev2.id, "url", "https://cybercrime-portal-verify.xyz/case-track", "Phishing / Impersonation Portal", "Phishing portal: https://cybercrime-portal-verify.xyz", "verified"),
        (ev3.id, "financial", "clearance.verify@okhdfcbank", "Target Payment UPI (Correlated)", "Beneficiary: clearance.verify@okhdfcbank", "verified"),
        (ev3.id, "financial", "321894729184", "Bank UTR Transaction Ref", "UTR No: 321894729184", "verified"),
        (ev3.id, "financial", "HDFC0001234", "Mule Account IFSC", "IFSC Code: HDFC0001234", "verified"),
    ]

    for eid, ftype, val, lbl, snip, vstatus in findings_data:
        db.add(Finding(
            case_id=demo_case.id,
            evidence_id=eid,
            finding_type=ftype,
            finding_value=val,
            label=lbl,
            context_snippet=snip,
            confidence=0.98,
            verification_status=vstatus,
            verified_at=datetime.utcnow()
        ))

    # Add Chain of Custody records
    db.add(ChainOfCustodyLog(
        case_id=demo_case.id,
        evidence_id=ev1.id,
        action_type="EVIDENCE_INGESTED",
        actor="Victim",
        description="Notice uploaded with SHA-256",
        sha256_recorded=pdf_hash
    ))
    db.add(ChainOfCustodyLog(
        case_id=demo_case.id,
        evidence_id=ev2.id,
        action_type="EVIDENCE_INGESTED",
        actor="Victim",
        description="WhatsApp screenshot ingested with SHA-256",
        sha256_recorded=img_hash
    ))
    db.add(ChainOfCustodyLog(
        case_id=demo_case.id,
        evidence_id=ev3.id,
        action_type="EVIDENCE_INGESTED",
        actor="Victim",
        description="Bank receipt uploaded with SHA-256",
        sha256_recorded=slip_hash
    ))

    db.commit()

    # Run synthesis & timeline
    events = auto_generate_case_timeline(demo_case)
    for e in events:
        db.add(e)
    
    synth = synthesize_case_incident(demo_case)
    demo_case.synthesized_summary = synth.modus_operandi_summary
    db.commit()

    print("✅ Demo Cybercrime Case successfully seeded!")
    print(f"👉 Case ID: {demo_case.id}")
    print(f"👉 View API at: http://127.0.0.1:8000/api/v1/cases/{demo_case.id}")
    print(f"👉 View HTML Dossier at: http://127.0.0.1:8000/api/v1/cases/{demo_case.id}/dossier/html")
    db.close()

if __name__ == "__main__":
    seed()
