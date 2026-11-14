import re
from typing import List, Dict, Any, Optional

# ======================== FORENSIC REGEX PATTERNS ========================

# Phone numbers (Indian 10-digit mobile, +91, and international formats)
PHONE_REGEX = re.compile(
    r'(?:(?:\+|00)[1-9]\d{0,2}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}',
    re.UNICODE
)

# Email addresses
EMAIL_REGEX = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
    re.IGNORECASE
)

# Web URLs & suspicious links
URL_REGEX = re.compile(
    r'https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)',
    re.IGNORECASE
)

# Telegram usernames & channel handles
TELEGRAM_REGEX = re.compile(
    r'(?:@|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([a-zA-Z0-9_]{4,32})\b',
    re.IGNORECASE
)

# UPI IDs (Google Pay, PhonePe, Paytm, BHIM, banks)
UPI_REGEX = re.compile(
    r'\b[a-zA-Z0-9.\-_]{2,64}@(okaxis|okhdfcbank|oksbi|okicici|paytm|ybl|upi|apl|ibl|axl|postbank|jupiteraxis|kotak|barodampay|federal)\b',
    re.IGNORECASE
)

# Indian Financial System Code (IFSC)
IFSC_REGEX = re.compile(
    r'\b[A-Z]{4}0[A-Z0-9]{6}\b'
)

# Currency amounts (INR, USD, EUR, GBP)
CURRENCY_REGEX = re.compile(
    r'(?:(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)\s?[0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?\s?(?:INR|USD|EUR|Rupees)\b)',
    re.IGNORECASE
)

# Transaction Reference / UTR Numbers
UTR_REGEX = re.compile(
    r'\b(?:UTR|Ref(?:\s*No\.?)?|Txn(?:\s*ID)?|Transaction\s*(?:ID|No\.?))[:\s#]+([A-Za-z0-9]{8,22})\b',
    re.IGNORECASE
)

# Crypto wallet addresses (BTC, ETH, TRON)
BTC_REGEX = re.compile(r'\b(?:1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b')
ETH_REGEX = re.compile(r'\b0x[a-fA-F0-9]{40}\b')
TRON_REGEX = re.compile(r'\bT[A-Za-z1-9]{33}\b')

# Threat, extortion, impersonation and cybercrime terminology
THREAT_TERMS = [
    {"term": "arrest warrant", "category": "Police Impersonation", "severity": "high"},
    {"term": "police custody", "category": "Police Impersonation", "severity": "high"},
    {"term": "digital arrest", "category": "Digital Arrest Scam", "severity": "critical"},
    {"term": "cbi officer", "category": "Authority Impersonation", "severity": "critical"},
    {"term": "cyber crime cell", "category": "Authority Impersonation", "severity": "high"},
    {"term": "narcotics bureau", "category": "Customs/Narcotics Extortion", "severity": "critical"},
    {"term": "customs clearance", "category": "Customs Extortion", "severity": "high"},
    {"term": "court summons", "category": "Legal Impersonation", "severity": "high"},
    {"term": "immediate arrest", "category": "Coercive Threat", "severity": "critical"},
    {"term": "leak your video", "category": "Blackmail / Sextortion", "severity": "critical"},
    {"term": "send to your contacts", "category": "Blackmail / Sextortion", "severity": "critical"},
    {"term": "share your photos", "category": "Blackmail / Sextortion", "severity": "critical"},
    {"term": "ruin your reputation", "category": "Extortion Threat", "severity": "high"},
    {"term": "urgent wire transfer", "category": "Financial Fraud", "severity": "high"},
    {"term": "kyc suspended", "category": "Phishing / Banking Fraud", "severity": "medium"},
    {"term": "account blocked", "category": "Phishing / Banking Fraud", "severity": "medium"},
    {"term": "verify your otp", "category": "Credential Harvesting", "severity": "high"},
    {"term": "guaranteed return", "category": "Investment Scam", "severity": "high"},
    {"term": "part time job", "category": "Job / Task Scam", "severity": "medium"},
    {"term": "telegram task", "category": "Job / Task Scam", "severity": "medium"},
    {"term": "liquidity deposit", "category": "Crypto / Fee Fraud", "severity": "high"},
    {"term": "processing fee", "category": "Advance Fee Fraud", "severity": "medium"},
]

DATE_REGEX = re.compile(r'\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b')
TIME_REGEX = re.compile(r'\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\b')

def get_context_snippet(text: str, start_idx: int, length: int) -> str:
    start = max(0, start_idx - 35)
    end = min(len(text), start_idx + length + 35)
    snippet = text[start:end].replace('\r', ' ').replace('\n', ' ').strip()
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{snippet}{suffix}"

def extract_entities_from_text(text: str) -> List[Dict[str, Any]]:
    """
    Scans text extracted from evidence and returns structured findings.
    """
    findings: List[Dict[str, Any]] = []
    if not text:
        return findings

    # 1. Phone Numbers
    seen_phones = set()
    for m in PHONE_REGEX.finditer(text):
        raw = m.group(0).strip()
        cleaned = re.sub(r'[^\d+]', '', raw)
        if 8 <= len(cleaned) <= 15 and cleaned not in seen_phones:
            seen_phones.add(cleaned)
            findings.append({
                "finding_type": "phone",
                "finding_value": raw,
                "label": "Extracted Phone / Contact",
                "context_snippet": get_context_snippet(text, m.start(), len(raw)),
                "confidence": 0.95
            })

    # 2. Email Addresses
    seen_emails = set()
    for m in EMAIL_REGEX.finditer(text):
        email = m.group(0).lower().strip()
        if email not in seen_emails:
            seen_emails.add(email)
            findings.append({
                "finding_type": "email",
                "finding_value": email,
                "label": "Extracted Email Address",
                "context_snippet": get_context_snippet(text, m.start(), len(email)),
                "confidence": 0.98
            })

    # 3. Web URLs
    seen_urls = set()
    for m in URL_REGEX.finditer(text):
        url = m.group(0).strip()
        if url not in seen_urls:
            seen_urls.add(url)
            is_suspicious_tld = bool(re.search(r'\.(xyz|top|ru|vip|live|cc|cf|tk|online|work|buzz)(\/|$)', url, re.IGNORECASE))
            findings.append({
                "finding_type": "url",
                "finding_value": url,
                "label": "Suspicious / Untrusted URL" if is_suspicious_tld else "Extracted Web URL",
                "context_snippet": get_context_snippet(text, m.start(), len(url)),
                "confidence": 0.99 if is_suspicious_tld else 0.92,
                "user_notes": "High-risk generic top-level domain flagged" if is_suspicious_tld else None
            })

    # 4. Telegram Handles
    seen_handles = set()
    for m in TELEGRAM_REGEX.finditer(text):
        handle = f"@{m.group(1).replace('@', '')}"
        if handle not in seen_handles and len(handle) > 3:
            seen_handles.add(handle)
            findings.append({
                "finding_type": "account",
                "finding_value": handle,
                "label": "Suspected Telegram Handle",
                "context_snippet": get_context_snippet(text, m.start(), len(m.group(0))),
                "confidence": 0.94
            })

    # 5. UPI IDs
    seen_upis = set()
    for m in UPI_REGEX.finditer(text):
        upi = m.group(0).strip()
        if upi not in seen_upis:
            seen_upis.add(upi)
            findings.append({
                "finding_type": "financial",
                "finding_value": upi,
                "label": "Extracted UPI Payment ID",
                "context_snippet": get_context_snippet(text, m.start(), len(upi)),
                "confidence": 0.97
            })

    # 6. IFSC Codes
    seen_ifsc = set()
    for m in IFSC_REGEX.finditer(text):
        code = m.group(0).strip()
        if code not in seen_ifsc:
            seen_ifsc.add(code)
            findings.append({
                "finding_type": "financial",
                "finding_value": code,
                "label": "Bank IFSC Code",
                "context_snippet": get_context_snippet(text, m.start(), len(code)),
                "confidence": 0.96
            })

    # 7. Currency Amounts
    seen_amounts = set()
    for m in CURRENCY_REGEX.finditer(text):
        amt = m.group(0).strip()
        if amt not in seen_amounts:
            seen_amounts.add(amt)
            findings.append({
                "finding_type": "financial",
                "finding_value": amt,
                "label": "Extracted Transaction / Demand Amount",
                "context_snippet": get_context_snippet(text, m.start(), len(amt)),
                "confidence": 0.90
            })

    # 8. UTR / Transaction Reference Numbers
    seen_utrs = set()
    for m in UTR_REGEX.finditer(text):
        utr = m.group(1).strip()
        if utr not in seen_utrs and len(utr) >= 8:
            seen_utrs.add(utr)
            findings.append({
                "finding_type": "financial",
                "finding_value": utr,
                "label": "Transaction Reference / UTR Number",
                "context_snippet": get_context_snippet(text, m.start(), len(m.group(0))),
                "confidence": 0.97
            })

    # 9. Crypto Wallets
    for m in BTC_REGEX.finditer(text):
        findings.append({
            "finding_type": "crypto",
            "finding_value": m.group(0),
            "label": "Bitcoin (BTC) Wallet Address",
            "context_snippet": get_context_snippet(text, m.start(), len(m.group(0))),
            "confidence": 0.95
        })

    for m in ETH_REGEX.finditer(text):
        findings.append({
            "finding_type": "crypto",
            "finding_value": m.group(0),
            "label": "Ethereum (ETH) Wallet Address",
            "context_snippet": get_context_snippet(text, m.start(), len(m.group(0))),
            "confidence": 0.95
        })

    for m in TRON_REGEX.finditer(text):
        findings.append({
            "finding_type": "crypto",
            "finding_value": m.group(0),
            "label": "TRON / USDT (TRC-20) Address",
            "context_snippet": get_context_snippet(text, m.start(), len(m.group(0))),
            "confidence": 0.93
        })

    # 10. Threat & Scam Keywords
    lower_text = text.lower()
    for item in THREAT_TERMS:
        term = item["term"]
        idx = lower_text.find(term)
        if idx != -1:
            findings.append({
                "finding_type": "keyword",
                "finding_value": term.upper(),
                "label": f"Indicator: {item['category']} ({item['severity'].upper()})",
                "context_snippet": get_context_snippet(text, idx, len(term)),
                "confidence": 0.99,
                "user_notes": f"Detected tactic matching known {item['category'].lower()}"
            })

    return findings

def extract_dates_and_times(text: str) -> List[Dict[str, str]]:
    """Extracts dates and associated times for timeline event suggestion."""
    results = []
    dates = list(DATE_REGEX.finditer(text))
    times = list(TIME_REGEX.finditer(text))
    
    for i, d in enumerate(dates):
        raw_date = d.group(0)
        # Normalize date
        norm_date = raw_date
        if '/' in raw_date:
            parts = raw_date.split('/')
            if len(parts) == 3:
                if len(parts[0]) == 4:
                    norm_date = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
                elif len(parts[2]) == 4:
                    norm_date = f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
        
        assigned_time = times[i].group(0) if i < len(times) else None
        results.append({
            "date": norm_date,
            "time": assigned_time
        })
    return results
