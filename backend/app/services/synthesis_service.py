import re
from typing import Dict, List, Any
from app.models.case import Case
from app.schemas.analysis import IncidentSynthesisResponse

def parse_currency_amount(val: str) -> float:
    """Extract numeric value from currency strings like ₹10,000 or Rs. 5000 or $250.50"""
    cleaned = re.sub(r'[^\d.]', '', val)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def synthesize_case_incident(case: Case) -> IncidentSynthesisResponse:
    """
    Synthesizes all case evidence, findings, and timeline events into a unified
    executive investigative summary suitable for law enforcement submission.
    """
    # 1. Collate unique identifiers
    suspect_identifiers: Dict[str, List[str]] = {
        "phones": [],
        "emails": [],
        "upi_ids": [],
        "bank_accounts_ifsc": [],
        "crypto_wallets": [],
        "telegram_accounts": [],
        "phishing_urls": []
    }
    
    threat_indicators = []
    total_calculated_loss = 0.0
    detected_loss_amounts = []

    for f in case.findings:
        val = f.finding_value
        if f.finding_type == "phone" and val not in suspect_identifiers["phones"]:
            suspect_identifiers["phones"].append(val)
        elif f.finding_type == "email" and val not in suspect_identifiers["emails"]:
            suspect_identifiers["emails"].append(val)
        elif f.finding_type == "account" and val not in suspect_identifiers["telegram_accounts"]:
            suspect_identifiers["telegram_accounts"].append(val)
        elif f.finding_type == "url" and val not in suspect_identifiers["phishing_urls"]:
            suspect_identifiers["phishing_urls"].append(val)
        elif f.finding_type == "crypto" and val not in suspect_identifiers["crypto_wallets"]:
            suspect_identifiers["crypto_wallets"].append(val)
        elif f.finding_type == "financial":
            if "@" in val and val not in suspect_identifiers["upi_ids"]:
                suspect_identifiers["upi_ids"].append(val)
            elif any(c in val for c in ["₹", "Rs", "$", "USD", "INR", "€"]):
                amt = parse_currency_amount(val)
                if amt > 0 and amt not in detected_loss_amounts:
                    detected_loss_amounts.append(amt)
            elif len(val) == 11 and val[:4].isalpha():
                suspect_identifiers["bank_accounts_ifsc"].append(val)
        elif f.finding_type == "keyword" and val not in threat_indicators:
            threat_indicators.append(val)

    if detected_loss_amounts:
        total_calculated_loss = max(detected_loss_amounts) # Or sum if multiple transactions
    elif case.financial_loss_amount:
        total_calculated_loss = case.financial_loss_amount

    # 2. Modus Operandi Narrative
    lines = [
        f"Case Title: {case.title}",
        f"Incident Classification: {case.category} (Severity: {case.severity.upper()})",
        f"Platform Involved: {case.platform or 'Digital Communication Platform'}",
        f"Incident Timeline: Commenced on {case.incident_date or 'an unspecified date'}.",
        ""
    ]

    if threat_indicators:
        lines.append(f"Primary Coercive Indicators: {', '.join(threat_indicators)}.")

    if suspect_identifiers["upi_ids"] or suspect_identifiers["crypto_wallets"]:
        payment_channels = []
        if suspect_identifiers["upi_ids"]:
            payment_channels.append(f"UPI handles ({', '.join(suspect_identifiers['upi_ids'])})")
        if suspect_identifiers["crypto_wallets"]:
            payment_channels.append(f"Crypto addresses ({', '.join(suspect_identifiers['crypto_wallets'])})")
        lines.append(f"Financial Routing: Target was directed to transfer funds via {'; '.join(payment_channels)}.")

    if total_calculated_loss > 0:
        lines.append(f"Total Quantified Financial Loss: INR/Units {total_calculated_loss:,.2f}.")

    lines.append(
        f"Forensic Integrity: {len(case.evidence_items)} primary electronic evidence records captured, "
        f"hashed with SHA-256 for non-repudiation, and verified under chain of custody."
    )

    modus_operandi = "\n".join(lines)

    # 3. Recommended Legal / Police Filing Sections (Indian Law / IT Act standards)
    recommended_sections = []
    if "impersonat" in case.category.lower() or "arrest" in modus_operandi.lower() or "police" in modus_operandi.lower():
        recommended_sections.append("IT Act Section 66D (Cheating by personation using computer resource)")
        recommended_sections.append("BNS Section 319 / IPC Section 419 (Cheating by personation)")
    if "fraud" in case.category.lower() or total_calculated_loss > 0:
        recommended_sections.append("BNS Section 318(4) / IPC Section 420 (Cheating and dishonestly inducing delivery of property)")
        recommended_sections.append("IT Act Section 66C (Identity theft)")
    if "extortion" in case.category.lower() or "sextortion" in case.category.lower() or "blackmail" in modus_operandi.lower():
        recommended_sections.append("BNS Section 308 / IPC Section 384 (Extortion)")
        recommended_sections.append("IT Act Section 67 / 67A (Transmission of obscene or sexually explicit material)")
    if not recommended_sections:
        recommended_sections.append("IT Act Section 66 (Computer related offences)")
        recommended_sections.append("BNS Section 318 (Cheating)")

    # 4. Timeline Summary
    timeline_summary = f"{len(case.timeline_events)} distinct chronological milestones established from electronic evidence."

    return IncidentSynthesisResponse(
        case_id=case.id,
        case_title=case.title,
        category=case.category,
        severity=case.severity,
        calculated_loss=total_calculated_loss,
        total_evidence_analyzed=len(case.evidence_items),
        modus_operandi_summary=modus_operandi,
        key_suspect_identifiers=suspect_identifiers,
        detected_threat_indicators=threat_indicators,
        reconstructed_timeline_summary=timeline_summary,
        recommended_police_sections=recommended_sections
    )
