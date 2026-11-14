import uuid
from datetime import datetime
from typing import Dict, Any, List
from jinja2 import Template
from app.models.case import Case
from app.schemas.dossier import Certificate65BData, CaseDossierResponse, ChainOfCustodyItem
from app.config import settings

CERTIFICATE_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Digital Evidence Dossier & Statutory Certificate - {{ case.id }}</title>
<style>
  body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #1e293b; margin: 40px; line-height: 1.6; }
  .header { border-bottom: 3px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { margin: 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px; color: #0f172a; }
  .header p { margin: 4px 0; color: #64748b; font-size: 13px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; }
  .badge-critical { background: #fee2e2; color: #991b1b; }
  .badge-high { background: #ffedd5; color: #9a3412; }
  .badge-medium { background: #fef3c7; color: #92400e; }
  .section-title { font-size: 16px; font-weight: bold; border-left: 4px solid #0284c7; padding-left: 8px; margin: 28px 0 12px; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
  th { background: #f8fafc; font-weight: 600; color: #334155; }
  .hash { font-family: monospace; font-size: 11px; color: #0369a1; word-break: break-all; }
  .narrative-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; font-size: 13px; white-space: pre-line; }
  .cert-box { border: 2px dashed #0369a1; background: #f0f9ff; padding: 20px; border-radius: 6px; margin-top: 30px; }
  .signature-area { margin-top: 40px; display: flex; justify-content: space-between; font-size: 13px; }
  .sig-line { width: 220px; border-top: 1px solid #334155; text-align: center; padding-top: 6px; }
</style>
</head>
<body>

<div class="header">
  <div style="float: right; text-align: right;">
    <span class="badge badge-{{ case.severity }}">{{ case.severity|upper }} SEVERITY</span>
    <p>Status: <strong>{{ case.status|upper }}</strong></p>
    <p>Report Date: {{ generated_at }}</p>
  </div>
  <h1>Forensic Digital Evidence Dossier</h1>
  <p>Standardized Law Enforcement Submission Package</p>
  <p>Case Reference ID: <strong>{{ case.id }}</strong></p>
</div>

<div class="section-title">1. INCIDENT OVERVIEW</div>
<table>
  <tr><th style="width: 25%;">Case Title</th><td>{{ case.title }}</td></tr>
  <tr><th>Category</th><td>{{ case.category }}</td></tr>
  <tr><th>Platform / Vector</th><td>{{ case.platform or 'Digital Media / Internet' }}</td></tr>
  <tr><th>Incident Date/Time</th><td>{{ case.incident_date or 'N/A' }} {{ case.incident_time or '' }}</td></tr>
  <tr><th>Reported Suspect Info</th><td>{{ case.suspect_info or 'Unknown / Multiple Cyber Actors' }}</td></tr>
  <tr><th>Total Quantified Loss</th><td><strong>INR {{ "{:,.2f}".format(case.financial_loss_amount) }}</strong></td></tr>
</table>

<div class="section-title">2. EXECUTIVE INVESTIGATIVE SYNTHESIS & MODUS OPERANDI</div>
<div class="narrative-box">
{{ case.synthesized_summary or 'Synthesis pending processing.' }}
</div>

<div class="section-title">3. FORENSIC EVIDENCE INVENTORY (CHAIN OF CUSTODY & HASHES)</div>
<table>
  <thead>
    <tr>
      <th style="width: 5%;">#</th>
      <th style="width: 25%;">Original Filename</th>
      <th style="width: 12%;">Type / Size</th>
      <th style="width: 43%;">SHA-256 Cryptographic Hash</th>
      <th style="width: 15%;">Ingested At</th>
    </tr>
  </thead>
  <tbody>
    {% for ev in case.evidence_items %}
    <tr>
      <td>{{ loop.index }}</td>
      <td><strong>{{ ev.original_filename }}</strong></td>
      <td>{{ ev.file_type|upper }} ({{ "{:,.1f}".format(ev.file_size / 1024) }} KB)</td>
      <td class="hash">{{ ev.sha256_hash }}</td>
      <td>{{ ev.created_at.strftime('%Y-%m-%d %H:%M') }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<div class="section-title">4. EXTRACTED & VERIFIED SUSPECT IDENTIFIERS</div>
<table>
  <thead>
    <tr>
      <th style="width: 20%;">Finding Type</th>
      <th style="width: 35%;">Extracted Identifier / Account</th>
      <th style="width: 45%;">Context / Verification Snippet</th>
    </tr>
  </thead>
  <tbody>
    {% for f in case.findings %}
    <tr>
      <td><strong>{{ f.finding_type|upper }}</strong></td>
      <td>{{ f.finding_value }}</td>
      <td>{{ f.context_snippet or 'Direct extraction' }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<div class="section-title">5. CHRONOLOGICAL INCIDENT TIMELINE</div>
<table>
  <thead>
    <tr>
      <th style="width: 15%;">Date & Time</th>
      <th style="width: 25%;">Milestone Event</th>
      <th style="width: 60%;">Detailed Evidence Corroboration</th>
    </tr>
  </thead>
  <tbody>
    {% for te in case.timeline_events %}
    <tr>
      <td><strong>{{ te.event_date }}</strong> {{ te.event_time or '' }}</td>
      <td>{{ te.title }}</td>
      <td>{{ te.description }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<div class="cert-box">
  <h3 style="margin-top:0; color: #0369a1;">CERTIFICATE UNDER SECTION 65B OF THE INDIAN EVIDENCE ACT, 1872 / SECTION 63 OF BHARATIYA SAKSHYA ADHINIYAM (BSA), 2023</h3>
  <p style="font-size: 12px; text-align: justify;">
    I, the authorized officer/custodian in lawful control of the electronic system generating this dossier, hereby certify that:
    <br>1. The computer output containing the electronic records listed herein was produced by a computer system during the period over which the computer was used regularly to store or process information.
    <br>2. Throughout the material part of the said period, the computer was operating properly and there were no operational defects affecting the production of the electronic records or the accuracy of their contents.
    <br>3. Each item of evidence was immediately hashed using SHA-256 at the moment of ingestion, and the resulting digests match the records shown in Section 3 of this document without alteration or tampering.
  </p>
  
  <div class="signature-area">
    <div class="sig-line">
      Certified System Digest: <strong>{{ cert_data.certificate_id }}</strong><br>
      Automated Forensic Authority
    </div>
    <div class="sig-line">
      Investigator / Complainant Signature<br>
      Date: {{ generated_at }}
    </div>
  </div>
</div>

</body>
</html>
"""

def generate_certificate_data(case: Case) -> Certificate65BData:
    cert_id = f"CERT-65B-{case.id[:8].upper()}-{uuid.uuid4().hex[:6].upper()}"
    inventory = []
    for ev in case.evidence_items:
        inventory.append({
            "id": ev.id,
            "filename": ev.original_filename,
            "category": ev.file_type,
            "sha256": ev.sha256_hash,
            "size_bytes": ev.file_size,
            "timestamp": ev.created_at.isoformat()
        })
    
    declaration = (
        f"This certificate confirms that the digital evidence items associated with Case #{case.id} "
        f"were ingested in a bit-stream verifiable manner with SHA-256 cryptographic hashes. "
        f"The integrity of all {len(case.evidence_items)} records is preserved in accordance with {settings.STATUTORY_SECTION}."
    )
    
    return Certificate65BData(
        certificate_id=cert_id,
        case_id=case.id,
        case_title=case.title,
        statutory_reference=settings.STATUTORY_SECTION,
        issued_at=datetime.utcnow(),
        certifying_system=settings.CERTIFICATE_ISSUER_TITLE,
        evidence_inventory=inventory,
        integrity_declaration=declaration
    )

def render_html_dossier(case: Case) -> str:
    cert_data = generate_certificate_data(case)
    template = Template(CERTIFICATE_TEMPLATE)
    return template.render(
        case=case,
        cert_data=cert_data,
        generated_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    )
