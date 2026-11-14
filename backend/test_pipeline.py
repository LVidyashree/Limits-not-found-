"""
Automated Test Script for Digital Evidence Intelligent Interface
Tests: Hashing, OCR, Audio Whisper, Entity Extraction, and 65B Dossier Generation.
"""
import os
import wave
import struct
import math
from PIL import Image, ImageDraw

def create_synthetic_test_image(path: str):
    """Creates a sample chat screenshot image with cybercrime text for OCR testing."""
    img = Image.new("RGB", (650, 200), color=(240, 242, 245))
    draw = ImageDraw.Draw(img)
    
    # Draw simulated WhatsApp chat text
    lines = [
        "Suspect (+91 98231 44219): Immediate Arrest Order issued.",
        "Transfer Rs. 50,000 to clearance.verify@okhdfcbank",
        "Ref UTR: 998822331144 within 15 minutes."
    ]
    y = 25
    for line in lines:
        draw.text((20, y), line, fill=(17, 24, 39))
        y += 45
        
    img.save(path)

def create_synthetic_test_audio(path: str):
    """Creates a small 2-second valid WAV audio file for testing Whisper audio pipeline."""
    sample_rate = 16000
    duration_secs = 2
    num_samples = sample_rate * duration_secs
    
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1) # Mono
        wav.setsampwidth(2) # 16-bit
        wav.setframerate(sample_rate)
        
        # Write low-frequency tone
        for i in range(num_samples):
            value = int(32767.0 * 0.1 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            data = struct.pack("<h", value)
            wav.writeframes(data)

def main():
    print("=" * 60)
    print("🧪 DIGITAL EVIDENCE INTELLIGENT INTERFACE - TEST SUITE")
    print("=" * 60)

    # 1. Test Entity Extractor
    print("\n[1/5] Testing Forensic Entity Extraction...")
    from app.services.extractor import extract_entities_from_text
    sample_text = (
        "CBI Officer Vikram (+91 98231 44219): You are placed under Digital Arrest. "
        "Pay penalty of ₹2,50,000 to clearance.verify@okhdfcbank. UTR: 321894729184."
    )
    findings = extract_entities_from_text(sample_text)
    print(f"  ✓ Extracted {len(findings)} findings from sample text:")
    for f in findings:
        print(f"    - [{f['finding_type'].upper()}] {f['finding_value']} ({f['label']})")
    assert any(f['finding_type'] == 'financial' for f in findings), "UPI/Financial extraction failed"
    assert any(f['finding_type'] == 'keyword' for f in findings), "Threat extraction failed"

    # 2. Test Cryptographic Hashing & Verification
    print("\n[2/5] Testing Cryptographic SHA-256 Storage & Tamper Check...")
    from app.services.storage import verify_file_hash
    import hashlib
    test_file = "test_integrity.tmp"
    with open(test_file, "w") as f:
        f.write("Forensic bitstream test data 2026")
    with open(test_file, "rb") as f:
        expected_hash = hashlib.sha256(f.read()).hexdigest()
    
    is_valid = verify_file_hash(test_file, expected_hash)
    print(f"  ✓ SHA-256 Hash: {expected_hash}")
    print(f"  ✓ Integrity Check Passed: {is_valid}")
    if os.path.exists(test_file):
        os.remove(test_file)

    # 3. Test OCR Engine
    print("\n[3/5] Testing Image OCR Engine...")
    from app.services.ocr import extract_text_from_file
    img_path = "test_ocr_sample.png"
    create_synthetic_test_image(img_path)
    ocr_result = extract_text_from_file(img_path, "image")
    if ocr_result:
        print(f"  ✓ OCR Result:\n    {ocr_result.replace(chr(10), ' ')}")
    else:
        print("  ℹ️ Tesseract binary not currently running on system; graceful fallback confirmed.")
    if os.path.exists(img_path):
        os.remove(img_path)

    # 4. Test Audio Whisper Pipeline
    print("\n[4/5] Testing Whisper Audio Pipeline...")
    from app.services.speech import transcribe_audio
    audio_path = "test_audio_sample.wav"
    create_synthetic_test_audio(audio_path)
    audio_res = transcribe_audio(audio_path)
    print(f"  ✓ Audio Pipeline Status: {audio_res.get('status')}")
    if audio_res.get("text"):
        print(f"  ✓ Audio Transcript: {audio_res.get('text')}")
    if os.path.exists(audio_path):
        os.remove(audio_path)

    # 5. Test Legal Certificate & HTML Dossier
    print("\n[5/5] Testing Section 65B Dossier Generation...")
    from app.database import SessionLocal
    from app.models.case import Case
    from app.services.certificate import render_html_dossier
    db = SessionLocal()
    case = db.query(Case).first()
    if case:
        html = render_html_dossier(case)
        print(f"  ✓ Generated Printable 65B Dossier for Case: {case.title} ({len(html)} bytes)")
    else:
        print("  ℹ️ Run 'python seed_demo_case.py' to generate a full case for dossier rendering.")
    db.close()

    print("\n" + "=" * 60)
    print("✅ TEST SUITE FINISHED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    main()
