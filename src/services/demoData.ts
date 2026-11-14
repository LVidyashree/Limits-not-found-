import {
  Case,
  Evidence,
  Finding,
  TimelineEvent,
} from '../types';
import { saveTextAsEvidenceFile } from './storage';
import {
  insertCase,
  insertEvidence,
  insertFinding,
  insertEvent,
  logActivity,
  getCaseById,
} from './database';

export const DEMO_CASE_ID = 'case_demo_payment_fraud';

export const createDemoCaseIfNotExists = async (): Promise<Case> => {
  const existing = await getCaseById(DEMO_CASE_ID);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();

  // 1. Create Demo Case Record
  const demoCase: Case = {
    id: DEMO_CASE_ID,
    title: '[DEMO DATA] Telegram Crypto & UPI Investment Scam',
    category: 'Financial Fraud & Impersonation',
    description:
      'Fictional demonstration case representing an online investment scam. The victim was contacted on Telegram by an impersonator claiming to represent Apex Capital Advisory, promised 300% guaranteed returns within 24 hours, tricked into sending ₹25,000 via UPI, and then subjected to extortion threats demanding another ₹50,000 "liquidity deposit" to unfreeze funds.',
    incident_date: '2026-11-10',
    incident_time: '14:30',
    platform: 'Telegram / UPI Banking',
    suspect_info:
      'Handle: @Apex_Crypto_Trader | Mobile: +91 98201 54321 | UPI: apexinvest@okaxis | Phishing URL: https://apex-capital-secure.xyz',
    severity: 'high',
    status: 'active',
    is_demo: 1,
    created_at: now,
    updated_at: now,
  };

  await insertCase(demoCase);

  // 2. Create Sample File 1: Telegram Threat Chat
  const chatContent = `[DEMO DATA - EVIDENCE FILE 1: TELEGRAM CHAT TRANSCRIPT]
Platform: Telegram Messenger
Target Suspect: @Apex_Crypto_Trader
Target Phone: +91 98201 54321
Victim Account: Victim_User_88

[2026-11-10 14:15:10] @Apex_Crypto_Trader: Hello sir! Welcome to Apex VIP Trading Group. Today we have institutional arbitrage slots open. Invest ₹25,000 right now and get guaranteed 300% profit (₹75,000) credited within 24 hours! Completely legal, SEBI verified.
[2026-11-10 14:22:33] Victim: Is this safe? How do I make the deposit?
[2026-11-10 14:25:02] @Apex_Crypto_Trader: 100% safe sir! Send payment immediately to our verified treasury UPI ID: apexinvest@okaxis. Send payment screenshot with UTR immediately or your reserved slot will expire in 10 minutes.
[2026-11-10 14:32:18] Victim: Sent ₹25,000 from SBI account. UTR is 431902847192.
[2026-11-10 14:35:45] @Apex_Crypto_Trader: Payment verified! Check your trading balance at our portal: https://apex-capital-secure.xyz/verify
[2026-11-10 16:30:12] @Apex_Crypto_Trader: Congratulations sir! Your trade executed with 450% gain, total balance is now ₹1,37,500!
[2026-11-10 16:35:00] Victim: Wonderful! Please release the withdrawal to my bank account.
[2026-11-10 16:42:19] @Apex_Crypto_Trader: ALERT: System has flagged your account for mandatory anti-money laundering tax clearance. You must pay ₹50,000 liquidity deposit within 2 hours to unfreeze your funds.
[2026-11-10 17:05:40] Victim: You said there were no extra fees! I don't have ₹50,000, please refund my original ₹25,000 deposit!
[2026-11-10 17:12:05] @Apex_Crypto_Trader: Listen carefully. If you do not transfer ₹50,000 immediately, our legal cell will file a police complaint against your PAN card. We will have an arrest warrant issued against you for fraud! Pay immediately or face consequences! Contact support@apex-capital-secure.xyz now.`;

  const file1 = await saveTextAsEvidenceFile(chatContent, 'demo_telegram_chat.txt');
  const ev1: Evidence = {
    id: 'ev_demo_001',
    case_id: DEMO_CASE_ID,
    filename: file1.filename,
    original_filename: 'telegram_chat_transcript_Apex.txt',
    file_path: file1.localPath,
    file_size: file1.size,
    file_type: 'text',
    mime_type: 'text/plain',
    sha256_hash: file1.sha256,
    processing_status: 'completed',
    extracted_text: chatContent,
    metadata_json: JSON.stringify({ source: 'Telegram Chat Export', encoding: 'UTF-8' }),
    created_at: '2026-11-10T14:40:00Z',
    is_verified: 1,
  };
  await insertEvidence(ev1);

  // 3. Create Sample File 2: UPI Transaction Receipt Record
  const receiptContent = `[DEMO DATA - EVIDENCE FILE 2: OFFICIAL PAYMENT RECEIPT]
TRANSACTION CONFIRMATION ADVICE
State Bank of India - Mobile Banking (YONO UPI)

Transaction Status: SUCCESSFUL
Payment Date: 10 Nov 2026
Payment Time: 14:32:18 IST

Amount Transferred: ₹25,000.00 (Twenty Five Thousand Rupees Only)
Paid To (Beneficiary): Apex Global Tech Services
Beneficiary UPI ID: apexinvest@okaxis
Debited Account: SB A/c No. ending in XX4819
Bank Ref / UTR Number: 431902847192
NPCI Transaction ID: UPI/431902847192/CR/apexinvest

Remarks: Apex Capital VIP trading deposit
Notice: Fraudulent transfers must be reported to 1930 Cyber Crime Helpline within golden hour.`;

  const file2 = await saveTextAsEvidenceFile(receiptContent, 'demo_payment_receipt.txt');
  const ev2: Evidence = {
    id: 'ev_demo_002',
    case_id: DEMO_CASE_ID,
    filename: file2.filename,
    original_filename: 'bank_receipt_sbi_upi_25000.txt',
    file_path: file2.localPath,
    file_size: file2.size,
    file_type: 'text',
    mime_type: 'text/plain',
    sha256_hash: file2.sha256,
    processing_status: 'completed',
    extracted_text: receiptContent,
    metadata_json: JSON.stringify({ source: 'Mobile Banking Export', paymentChannel: 'UPI' }),
    created_at: '2026-11-10T14:45:00Z',
    is_verified: 1,
  };
  await insertEvidence(ev2);

  // 4. Create Sample File 3: Phishing Domain Technical Audit
  const auditContent = `[DEMO DATA - EVIDENCE FILE 3: PHISHING DOMAIN TECHNICAL AUDIT]
Incident Intelligence Unit - Technical Forensic Note

Target Suspected URL: https://apex-capital-secure.xyz/verify
Target Host: apex-capital-secure.xyz
Resolved IP: 198.51.100.45 (Offshore Bulletproof Host)

WHOIS Domain Analysis:
- Registered: 02-Nov-2026 (Active for only 8 days prior to incident)
- Registrar: NameCheap Private WhoisGuard
- Country: US / Anonymized Proxy
- DNS Servers: ns1.bulletproof-dns.to, ns2.bulletproof-dns.to

SSL / TLS Inspection:
- Certificate Authority: Let's Encrypt Authority X3 (Free Tier)
- Issued Date: 02-Nov-2026

Security Assessment:
- Fraud Classification: High-Confidence Phishing & Impersonation Portal
- Indicators: Fake trading dashboard with artificial counter, unlicensed investment claims, unauthorized use of SEBI logos.
- Associated Email: support@apex-capital-secure.xyz`;

  const file3 = await saveTextAsEvidenceFile(auditContent, 'demo_domain_audit.txt');
  const ev3: Evidence = {
    id: 'ev_demo_003',
    case_id: DEMO_CASE_ID,
    filename: file3.filename,
    original_filename: 'phishing_website_whois_audit.txt',
    file_path: file3.localPath,
    file_size: file3.size,
    file_type: 'text',
    mime_type: 'text/plain',
    sha256_hash: file3.sha256,
    processing_status: 'completed',
    extracted_text: auditContent,
    metadata_json: JSON.stringify({ analyst: 'EvidenceVault Rule-Engine', category: 'Phishing Threat' }),
    created_at: '2026-11-10T15:00:00Z',
    is_verified: 1,
  };
  await insertEvidence(ev3);

  // 5. Populate Sample Extracted Findings
  const demoFindings: Finding[] = [
    {
      id: 'fnd_demo_001',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_type: 'account',
      finding_value: '@Apex_Crypto_Trader',
      label: 'Suspect Telegram Handle',
      context_snippet: 'Target Suspect: @Apex_Crypto_Trader Hello sir! Welcome to Apex VIP...',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:00:00Z',
      user_notes: 'Confirmed primary handle used to initiate contact and issue threats.',
      created_at: '2026-11-10T15:10:00Z',
    },
    {
      id: 'fnd_demo_002',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_type: 'phone',
      finding_value: '+91 98201 54321',
      label: 'Suspect Mobile Number',
      context_snippet: 'Target Phone: +91 98201 54321 Victim Account: Victim_User_88...',
      confidence: 0.98,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:02:00Z',
      user_notes: 'Phone number displayed on Telegram user profile at time of incident.',
      created_at: '2026-11-10T15:10:00Z',
    },
    {
      id: 'fnd_demo_003',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_002',
      finding_type: 'financial',
      finding_value: 'apexinvest@okaxis',
      label: 'Beneficiary UPI Address',
      context_snippet: 'Beneficiary UPI ID: apexinvest@okaxis Debited Account: SB A/c No...',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:05:00Z',
      user_notes: 'Axis Bank VPA used to receive fraudulent payment of ₹25,000.',
      created_at: '2026-11-10T15:11:00Z',
    },
    {
      id: 'fnd_demo_004',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_002',
      finding_type: 'financial',
      finding_value: '₹25,000.00',
      label: 'Defrauded Amount Sent',
      context_snippet: 'Amount Transferred: ₹25,000.00 (Twenty Five Thousand Rupees Only)...',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:06:00Z',
      user_notes: 'Initial fraudulent investment transfer debit from SBI.',
      created_at: '2026-11-10T15:11:00Z',
    },
    {
      id: 'fnd_demo_005',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_002',
      finding_type: 'financial',
      finding_value: '431902847192',
      label: 'Bank UTR / Transaction Ref',
      context_snippet: 'Bank Ref / UTR Number: 431902847192 NPCI Transaction ID...',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:07:00Z',
      user_notes: 'Official NPCI reference for bank cyber-freeze request.',
      created_at: '2026-11-10T15:12:00Z',
    },
    {
      id: 'fnd_demo_006',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_type: 'financial',
      finding_value: '₹50,000',
      label: 'Extortion Demand Amount',
      context_snippet: 'You must pay ₹50,000 liquidity deposit within 2 hours to unfreeze...',
      confidence: 0.94,
      verification_status: 'needs_verification',
      verified_at: null,
      user_notes: null,
      created_at: '2026-11-10T15:12:00Z',
    },
    {
      id: 'fnd_demo_007',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_003',
      finding_type: 'url',
      finding_value: 'https://apex-capital-secure.xyz/verify',
      label: 'Phishing Portal URL',
      context_snippet: 'Target Suspected URL: https://apex-capital-secure.xyz/verify Target Host...',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-11T10:10:00Z',
      user_notes: 'Fraudulent domain hosted on bulletproof server, mimicking SEBI broker.',
      created_at: '2026-11-10T15:13:00Z',
    },
    {
      id: 'fnd_demo_008',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_type: 'keyword',
      finding_value: 'ARREST WARRANT',
      label: 'Indicator: Coercive Threat & Extortion',
      context_snippet: 'We will have an arrest warrant issued against you for fraud! Pay immediately...',
      confidence: 0.99,
      verification_status: 'needs_verification',
      verified_at: null,
      user_notes: null,
      created_at: '2026-11-10T15:14:00Z',
    },
  ];

  for (const f of demoFindings) {
    await insertFinding(f);
  }

  // 6. Populate Chronological Timeline Events
  const demoEvents: TimelineEvent[] = [
    {
      id: 'evt_demo_001',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_id: 'fnd_demo_001',
      event_date: '2026-11-10',
      event_time: '14:15',
      title: 'Initial Contact by Telegram Impersonator',
      description: 'Account @Apex_Crypto_Trader initiated contact promising guaranteed 300% returns for investment.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:20:00Z',
    },
    {
      id: 'evt_demo_002',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_id: 'fnd_demo_003',
      event_date: '2026-11-10',
      event_time: '14:25',
      title: 'Payment Instructions Issued by Suspect',
      description: 'Suspect instructed transfer to UPI handle apexinvest@okaxis with 10-minute urgency pressure.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:21:00Z',
    },
    {
      id: 'evt_demo_003',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_002',
      finding_id: 'fnd_demo_005',
      event_date: '2026-11-10',
      event_time: '14:32',
      title: 'Victim Sent ₹25,000 via UPI (UTR 431902847192)',
      description: 'Debit completed via SBI YONO UPI app to beneficiary Apex Global Tech Services.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:22:00Z',
    },
    {
      id: 'evt_demo_004',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_003',
      finding_id: 'fnd_demo_007',
      event_date: '2026-11-10',
      event_time: '14:35',
      title: 'Directed to Phishing Dashboard',
      description: 'Victim instructed to log in to fake verification portal https://apex-capital-secure.xyz/verify.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:23:00Z',
    },
    {
      id: 'evt_demo_005',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_id: 'fnd_demo_006',
      event_date: '2026-11-10',
      event_time: '16:42',
      title: 'Extortion Demand for ₹50,000 "Liquidity Fee"',
      description: 'Suspect refused withdrawal and claimed account was locked under AML protocol.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:24:00Z',
    },
    {
      id: 'evt_demo_006',
      case_id: DEMO_CASE_ID,
      evidence_id: 'ev_demo_001',
      finding_id: 'fnd_demo_008',
      event_date: '2026-11-10',
      event_time: '17:12',
      title: 'Arrest Warrant & Defamation Threats Issued',
      description: 'Suspect threatened to contact victim family, leak records, and fabricate arrest warrant if funds were not paid.',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-10T15:25:00Z',
    },
  ];

  for (const ev of demoEvents) {
    await insertEvent(ev);
  }

  await logActivity(
    'demo_installed',
    'Demonstration case loaded with 3 evidence items, 8 extracted entities, and 6 timeline milestones.'
  );

  return demoCase;
};

