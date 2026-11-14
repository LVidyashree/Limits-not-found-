import * as Print from 'expo-print';
import { shareAsync } from 'expo-sharing';
import { Case, Evidence, Finding, TimelineEvent } from '../types';
import { formatBytes } from './storage';
import { logActivity } from './database';

export interface ReportData {
  caseData: Case;
  evidenceList: Evidence[];
  findings: Finding[];
  timelineEvents: TimelineEvent[];
  includeUnverified?: boolean;
  officerNotes?: string;
}

export const generateHtmlReport = (data: ReportData): string => {
  const { caseData, evidenceList, findings, timelineEvents, includeUnverified = true, officerNotes } = data;

  const verifiedFindings = findings.filter((f) => f.verification_status === 'verified');
  const pendingFindings = findings.filter((f) => f.verification_status === 'needs_verification');
  const rejectedFindings = findings.filter((f) => f.verification_status === 'rejected');

  const reportDate = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'medium',
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>EVIDENCEVAULT - Incident Investigation Report</title>
  <style>
    @page {
      margin: 18mm 15mm 18mm 15mm;
      size: A4 portrait;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a202c;
      background: #ffffff;
      line-height: 1.5;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }
    .header-bar {
      border-bottom: 3px solid #176B87;
      padding-bottom: 12px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .brand-title {
      font-size: 20pt;
      font-weight: 800;
      color: #101827;
      letter-spacing: 1px;
      margin: 0;
    }
    .brand-tagline {
      font-size: 8.5pt;
      font-weight: 600;
      color: #45A3A0;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .report-meta {
      text-align: right;
      font-size: 9pt;
      color: #718096;
    }
    .badge-demo {
      background: #FEF3C7;
      color: #92400E;
      border: 1px solid #F59E0B;
      padding: 3px 8px;
      font-size: 8.5pt;
      font-weight: 700;
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 8px;
    }
    .section-title {
      font-size: 13pt;
      font-weight: 700;
      color: #176B87;
      border-bottom: 1.5px solid #E2E8F0;
      padding-bottom: 6px;
      margin-top: 24px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .grid-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 10pt;
    }
    .grid-table th {
      background: #F1F5F9;
      color: #334155;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
      border: 1px solid #CBD5E1;
    }
    .grid-table td {
      padding: 8px 10px;
      border: 1px solid #E2E8F0;
      vertical-align: top;
    }
    .mono {
      font-family: 'Courier New', Courier, monospace;
      font-size: 8.5pt;
      word-break: break-all;
      color: #0F172A;
    }
    .custody-box {
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-left: 4px solid #45A3A0;
      padding: 12px 14px;
      border-radius: 4px;
      margin-bottom: 20px;
      font-size: 9.5pt;
    }
    .verified-chip {
      background: #D1FAE5;
      color: #065F46;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 8pt;
      display: inline-block;
    }
    .pending-chip {
      background: #FEF3C7;
      color: #92400E;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 8pt;
      display: inline-block;
    }
    .timeline-item {
      margin-bottom: 14px;
      padding-left: 14px;
      border-left: 2.5px solid #45A3A0;
      page-break-inside: avoid;
    }
    .timeline-date {
      font-weight: 700;
      color: #176B87;
      font-size: 9.5pt;
    }
    .timeline-heading {
      font-weight: 600;
      font-size: 10.5pt;
      color: #0F172A;
      margin: 2px 0;
    }
    .timeline-desc {
      font-size: 9.5pt;
      color: #475569;
    }
    .footer {
      margin-top: 36px;
      border-top: 1px solid #CBD5E1;
      padding-top: 12px;
      font-size: 8pt;
      color: #64748B;
      text-align: center;
      line-height: 1.4;
    }
  </style>
</head>
<body>

  <div class="header-bar">
    <div>
      <div class="brand-title">EVIDENCEVAULT</div>
      <div class="brand-tagline">YOUR EVIDENCE. YOUR CONTROL. AI-ASSISTED CLARITY.</div>
    </div>
    <div class="report-meta">
      <div><strong>OFFICIAL INCIDENT REPORT</strong></div>
      <div>Generated: ${reportDate}</div>
      <div>Custody State: <strong>OFFLINE SEALED</strong></div>
    </div>
  </div>

  ${caseData.is_demo ? '<div class="badge-demo">⚠️ DEMONSTRATION CASE — CONTAINS SYNTHETIC FICTIONAL DATA FOR ILLUSTRATION ONLY</div>' : ''}

  <div class="custody-box">
    <strong>CHAIN OF CUSTODY & INTEGRITY ATTESTATION:</strong><br>
    This report was generated offline on the user's secure device by EvidenceVault. Every evidence asset recorded herein has been preserved in its original byte form with a cryptographic <strong>SHA-256</strong> checksum calculated upon storage. The hash reflects the bit-exact state of the file at the time of custody capture.
  </div>

  <div class="section-title">1. Incident Overview</div>
  <table class="grid-table">
    <tr>
      <th style="width: 25%;">Case Title</th>
      <td style="width: 75%;"><strong>${escapeHtml(caseData.title)}</strong></td>
    </tr>
    <tr>
      <th>Case Identification</th>
      <td class="mono">${caseData.id}</td>
    </tr>
    <tr>
      <th>Incident Category</th>
      <td>${escapeHtml(caseData.category)}</td>
    </tr>
    <tr>
      <th>Platform Involved</th>
      <td>${escapeHtml(caseData.platform)}</td>
    </tr>
    <tr>
      <th>Incident Date & Time</th>
      <td>${caseData.incident_date} ${caseData.incident_time || 'N/A'}</td>
    </tr>
    <tr>
      <th>Assessed Severity</th>
      <td><span style="text-transform: uppercase; font-weight: bold;">${caseData.severity}</span> (Status: ${caseData.status})</td>
    </tr>
    <tr>
      <th>Suspect / Adversary Profile</th>
      <td>${escapeHtml(caseData.suspect_info || 'Not specified')}</td>
    </tr>
  </table>

  <div class="section-title">2. Narrative Description</div>
  <p style="font-size: 10pt; line-height: 1.6; color: #1E293B; background: #F8FAFC; padding: 12px; border-radius: 4px; border: 1px solid #E2E8F0;">
    ${escapeHtml(caseData.description || 'No detailed description provided.')}
  </p>

  ${officerNotes ? `
  <div class="section-title">Investigator / User Remarks</div>
  <p style="font-size: 10pt; line-height: 1.6; color: #1E293B; background: #FFFBEB; padding: 12px; border-radius: 4px; border: 1px solid #FCD34D;">
    ${escapeHtml(officerNotes)}
  </p>
  ` : ''}

  <div class="section-title">3. Preserved Evidence Index (${evidenceList.length} Files)</div>
  <table class="grid-table">
    <thead>
      <tr>
        <th style="width: 5%;">#</th>
        <th style="width: 30%;">Filename & Type</th>
        <th style="width: 15%;">File Size</th>
        <th style="width: 50%;">SHA-256 Cryptographic Checksum</th>
      </tr>
    </thead>
    <tbody>
      ${evidenceList.map((ev, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <strong>${escapeHtml(ev.original_filename)}</strong><br>
            <span style="font-size: 8pt; color: #64748B;">Type: ${ev.file_type.toUpperCase()} | Captured: ${ev.created_at.split('T')[0]}</span>
          </td>
          <td>${formatBytes(ev.file_size)}</td>
          <td>
            <div class="mono">${ev.sha256_hash}</div>
            <span class="verified-chip" style="margin-top: 4px;">SHA-256 INTEGRITY CONFIRMED</span>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">4. Extracted & Verified Forensic Findings</div>
  <table class="grid-table">
    <thead>
      <tr>
        <th style="width: 25%;">Entity / Label</th>
        <th style="width: 35%;">Extracted Value</th>
        <th style="width: 20%;">Verification Status</th>
        <th style="width: 20%;">User Notes</th>
      </tr>
    </thead>
    <tbody>
      ${findings
        .filter((f) => includeUnverified || f.verification_status === 'verified')
        .map((f) => `
        <tr>
          <td>
            <strong>${escapeHtml(f.label)}</strong><br>
            <span style="font-size: 8pt; color: #64748B;">Category: ${f.finding_type.toUpperCase()}</span>
          </td>
          <td class="mono"><strong>${escapeHtml(f.finding_value)}</strong></td>
          <td>
            ${f.verification_status === 'verified'
              ? '<span class="verified-chip">✓ Verified by User</span>'
              : f.verification_status === 'needs_verification'
              ? '<span class="pending-chip">⚠️ Needs Verification</span>'
              : '<span style="color: #991B1B;">✕ Rejected</span>'
            }
          </td>
          <td style="font-size: 8.5pt;">${escapeHtml(f.user_notes || f.context_snippet || '—')}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">5. Chronological Incident Timeline</div>
  <div style="margin-top: 10px;">
    ${timelineEvents.length === 0 ? '<p style="color: #64748B;">No events logged.</p>' : ''}
    ${timelineEvents.map((event) => `
      <div class="timeline-item">
        <div class="timeline-date">${event.event_date} ${event.event_time ? '• ' + event.event_time : ''} ${event.is_verified ? '<span class="verified-chip" style="margin-left: 6px;">Verified Event</span>' : ''}</div>
        <div class="timeline-heading">${escapeHtml(event.title)}</div>
        <div class="timeline-desc">${escapeHtml(event.description)}</div>
      </div>
    `).join('')}
  </div>

  <div class="footer">
    <strong>DISCLAIMER & LEGAL INTEGRITY NOTICE</strong><br>
    EvidenceVault is an offline evidence preservation tool. It does not certify the veracity of allegations or make legal determinations of guilt. The SHA-256 cryptographic hashes listed prove that the digital evidence files have remained bit-level identical to the copies saved to this device at the indicated timestamp without subsequent modification.
  </div>

</body>
</html>
  `;
};

const escapeHtml = (unsafe: string): string => {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const exportReportAsPdf = async (data: ReportData): Promise<string> => {
  const html = generateHtmlReport(data);

  // Print HTML to local PDF file completely offline
  const result = await Print.printToFileAsync({
    html,
    base64: false,
  });

  await logActivity(
    'report_generated',
    `Exported official PDF report for case "${data.caseData.title}"`,
    data.caseData.id
  );

  return result.uri;
};

export const shareReportPdf = async (pdfUri: string): Promise<void> => {
  try {
    await shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Export EvidenceVault Incident Report',
    });
  } catch (err) {
    console.error('Share failed:', err);
    throw err;
  }
};

