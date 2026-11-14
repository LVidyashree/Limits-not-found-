import {
  Evidence,
  Finding,
  FindingType,
  TimelineEvent,
} from '../types';
import { readTextFromFile } from './storage';
import { findDuplicateHash, insertFinding, insertEvent, logActivity } from './database';

export interface AnalysisResult {
  evidenceId: string;
  isDuplicate: boolean;
  duplicateOfEvidenceId?: string;
  extractedFindings: Finding[];
  suggestedEvents: TimelineEvent[];
  summary: string;
}

// ======================== REGEX PATTERNS ========================

// Phone numbers (International and local formats)
const PHONE_REGEX = /(?:\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}/g;

// Email addresses
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Web URLs and suspicious links
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;

// Telegram usernames & channel handles
const TELEGRAM_HANDLE_REGEX = /(?:@|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([a-zA-Z0-9_]{4,32})\b/gi;

// Financial / UPI IDs (popular payment handles)
const UPI_REGEX = /\b[a-zA-Z0-9.\-_]{2,64}@(okaxis|okhdfcbank|oksbi|okicici|paytm|ybl|upi|apl|ibl|axl|postbank|jupiteraxis|kotak)\b/gi;

// Currency amounts (INR, USD, EUR, GBP)
const CURRENCY_REGEX = /(?:(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)\s?[0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?\s?(?:INR|USD|EUR|Rupees)\b)/gi;

// Transaction Reference / UTR Numbers
const UTR_REF_REGEX = /\b(?:UTR|Ref(?:\s*No\.?)?|Txn(?:\s*ID)?|Transaction\s*(?:ID|No\.?))[:\s#]+([A-Za-z0-9]{8,22})\b/gi;

// Crypto wallet addresses (BTC, ETH, TRON)
const BTC_REGEX = /\b(?:1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\b/g;
const ETH_REGEX = /\b0x[a-fA-F0-9]{40}\b/g;
const TRON_REGEX = /\bT[A-Za-z1-9]{33}\b/g;

// High-risk threat & scam terminology
const THREAT_TERMS: { term: string; category: string; severity: string }[] = [
  { term: 'arrest warrant', category: 'Police Impersonation', severity: 'high' },
  { term: 'police custody', category: 'Police Impersonation', severity: 'high' },
  { term: 'customs clearance', category: 'Customs Extortion', severity: 'high' },
  { term: 'court summons', category: 'Legal Impersonation', severity: 'high' },
  { term: 'cyber crime cell', category: 'Authority Impersonation', severity: 'high' },
  { term: 'immediate arrest', category: 'Coercive Threat', severity: 'critical' },
  { term: 'leak your video', category: 'Blackmail / Sextortion', severity: 'critical' },
  { term: 'send to your contacts', category: 'Blackmail / Sextortion', severity: 'critical' },
  { term: 'defamation', category: 'Extortion Threat', severity: 'medium' },
  { term: 'ruin your reputation', category: 'Extortion Threat', severity: 'high' },
  { term: 'share your photos', category: 'Blackmail', severity: 'critical' },
  { term: 'urgent wire transfer', category: 'Financial Fraud', severity: 'high' },
  { term: 'kyc suspended', category: 'Phishing', severity: 'medium' },
  { term: 'account blocked', category: 'Phishing', severity: 'medium' },
  { term: 'otp', category: 'Credential Harvesting', severity: 'high' },
  { term: 'verify your pin', category: 'Credential Harvesting', severity: 'high' },
  { term: 'guaranteed return', category: 'Investment Scam', severity: 'high' },
  { term: '300% profit', category: 'Investment Scam', severity: 'high' },
  { term: 'liquidity deposit', category: 'Fee Fraud', severity: 'high' },
  { term: 'processing fee', category: 'Advance Fee Fraud', severity: 'medium' },
];

// Date and Time pattern
const DATE_REGEX = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g;
const TIME_REGEX = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\b/g;

// ======================== HELPER FUNCTIONS ========================

const getContextSnippet = (text: string, matchIndex: number, matchLength: number): string => {
  const start = Math.max(0, matchIndex - 35);
  const end = Math.min(text.length, matchIndex + matchLength + 35);
  const snippet = text.slice(start, end).replace(/[\r\n]+/g, ' ').trim();
  return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
};

export const runEvidenceAnalysis = async (
  evidence: Evidence,
  optionalCustomText?: string
): Promise<AnalysisResult> => {
  const caseId = evidence.case_id;
  const findings: Finding[] = [];
  const events: TimelineEvent[] = [];

  // Step 1: Duplicate Detection using SHA-256 hash
  const duplicate = await findDuplicateHash(evidence.sha256_hash, evidence.id);
  const isDuplicate = !!duplicate;

  // Step 2: Acquire text for analysis
  let textToAnalyze = optionalCustomText || evidence.extracted_text || '';

  if (!textToAnalyze && evidence.file_type === 'text') {
    const fileContent = await readTextFromFile(evidence.file_path);
    if (fileContent) {
      textToAnalyze = fileContent;
    }
  }

  // Also include original filename for heuristic parsing
  const fullTextToInspect = `${evidence.original_filename}\n${textToAnalyze}`;

  // Step 3: Extract Phone Numbers
  const phoneMatches = [...fullTextToInspect.matchAll(PHONE_REGEX)];
  const seenPhones = new Set<string>();
  for (const m of phoneMatches) {
    const phone = m[0].replace(/[^\d+]/g, '').trim();
    if (phone.length >= 8 && phone.length <= 15 && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'phone',
        finding_value: m[0].trim(),
        label: 'Extracted Phone / Contact',
        context_snippet: snippet,
        confidence: 0.95,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 4: Extract Email Addresses
  const emailMatches = [...fullTextToInspect.matchAll(EMAIL_REGEX)];
  const seenEmails = new Set<string>();
  for (const m of emailMatches) {
    const email = m[0].toLowerCase().trim();
    if (!seenEmails.has(email)) {
      seenEmails.add(email);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'email',
        finding_value: email,
        label: 'Extracted Email Address',
        context_snippet: snippet,
        confidence: 0.98,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 5: Extract URLs and Web Domains
  const urlMatches = [...fullTextToInspect.matchAll(URL_REGEX)];
  const seenUrls = new Set<string>();
  for (const m of urlMatches) {
    const url = m[0].trim();
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      const isSuspiciousTld = /\.(xyz|top|ru|vip|live|cc|cf|tk|online|work|buzz)(\/|$)/i.test(url);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'url',
        finding_value: url,
        label: isSuspiciousTld ? 'Suspicious / Untrusted URL' : 'Extracted Web URL',
        context_snippet: snippet,
        confidence: isSuspiciousTld ? 0.99 : 0.92,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: isSuspiciousTld ? 'High-risk generic top-level domain flagged' : null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 6: Extract Telegram Handles
  const tgMatches = [...fullTextToInspect.matchAll(TELEGRAM_HANDLE_REGEX)];
  const seenHandles = new Set<string>();
  for (const m of tgMatches) {
    const handle = '@' + m[1].replace('@', '');
    if (!seenHandles.has(handle) && handle.length > 3) {
      seenHandles.add(handle);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'account',
        finding_value: handle,
        label: 'Suspected Telegram Handle',
        context_snippet: snippet,
        confidence: 0.94,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 7: Extract UPI IDs
  const upiMatches = [...fullTextToInspect.matchAll(UPI_REGEX)];
  const seenUpi = new Set<string>();
  for (const m of upiMatches) {
    const upiId = m[0].trim();
    if (!seenUpi.has(upiId)) {
      seenUpi.add(upiId);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'financial',
        finding_value: upiId,
        label: 'Extracted UPI Payment ID',
        context_snippet: snippet,
        confidence: 0.96,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 8: Extract Currency Amounts
  const currencyMatches = [...fullTextToInspect.matchAll(CURRENCY_REGEX)];
  const seenAmounts = new Set<string>();
  for (const m of currencyMatches) {
    const amount = m[0].trim();
    if (!seenAmounts.has(amount)) {
      seenAmounts.add(amount);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'financial',
        finding_value: amount,
        label: 'Extracted Transaction / Demand Amount',
        context_snippet: snippet,
        confidence: 0.90,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 9: Extract Transaction References / UTR
  const utrMatches = [...fullTextToInspect.matchAll(UTR_REF_REGEX)];
  const seenUtr = new Set<string>();
  for (const m of utrMatches) {
    const utr = m[1].trim();
    if (!seenUtr.has(utr) && utr.length >= 8) {
      seenUtr.add(utr);
      const snippet = getContextSnippet(fullTextToInspect, m.index || 0, m[0].length);
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'financial',
        finding_value: utr,
        label: 'Transaction Reference / UTR Number',
        context_snippet: snippet,
        confidence: 0.97,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 10: Extract Crypto Wallets
  const btcMatches = [...fullTextToInspect.matchAll(BTC_REGEX)];
  for (const m of btcMatches) {
    findings.push({
      id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      case_id: caseId,
      evidence_id: evidence.id,
      finding_type: 'financial',
      finding_value: m[0],
      label: 'Bitcoin (BTC) Wallet Address',
      context_snippet: getContextSnippet(fullTextToInspect, m.index || 0, m[0].length),
      confidence: 0.95,
      verification_status: 'needs_verification',
      verified_at: null,
      user_notes: null,
      created_at: new Date().toISOString(),
    });
  }

  const ethMatches = [...fullTextToInspect.matchAll(ETH_REGEX)];
  for (const m of ethMatches) {
    findings.push({
      id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      case_id: caseId,
      evidence_id: evidence.id,
      finding_type: 'financial',
      finding_value: m[0],
      label: 'Ethereum (ETH) Wallet Address',
      context_snippet: getContextSnippet(fullTextToInspect, m.index || 0, m[0].length),
      confidence: 0.95,
      verification_status: 'needs_verification',
      verified_at: null,
      user_notes: null,
      created_at: new Date().toISOString(),
    });
  }

  const tronMatches = [...fullTextToInspect.matchAll(TRON_REGEX)];
  for (const m of tronMatches) {
    findings.push({
      id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      case_id: caseId,
      evidence_id: evidence.id,
      finding_type: 'financial',
      finding_value: m[0],
      label: 'TRON / USDT (TRC-20) Address',
      context_snippet: getContextSnippet(fullTextToInspect, m.index || 0, m[0].length),
      confidence: 0.93,
      verification_status: 'needs_verification',
      verified_at: null,
      user_notes: null,
      created_at: new Date().toISOString(),
    });
  }

  // Step 11: Identify Threat and Coercion Keywords
  const lowerText = fullTextToInspect.toLowerCase();
  for (const item of THREAT_TERMS) {
    const idx = lowerText.indexOf(item.term);
    if (idx !== -1) {
      findings.push({
        id: 'fnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        case_id: caseId,
        evidence_id: evidence.id,
        finding_type: 'keyword',
        finding_value: item.term.toUpperCase(),
        label: `Indicator: ${item.category} (${item.severity.toUpperCase()})`,
        context_snippet: getContextSnippet(fullTextToInspect, idx, item.term.length),
        confidence: 0.99,
        verification_status: 'needs_verification',
        verified_at: null,
        user_notes: `Detected pattern matching known ${item.category.toLowerCase()} tactic`,
        created_at: new Date().toISOString(),
      });
    }
  }

  // Step 12: Generate Proposed Chronological Timeline Events
  // Extract dates from text or use evidence upload date
  const dateMatches = [...fullTextToInspect.matchAll(DATE_REGEX)];
  const timeMatches = [...fullTextToInspect.matchAll(TIME_REGEX)];

  if (dateMatches.length > 0) {
    const rawDate = dateMatches[0][0];
    const rawTime = timeMatches.length > 0 ? timeMatches[0][0] : null;

    // Standardize ISO date format if possible
    let normalizedDate = rawDate;
    if (rawDate.includes('/')) {
      const parts = rawDate.split('/');
      if (parts[0].length === 4) {
        normalizedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      } else if (parts[2].length === 4) {
        normalizedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }

    events.push({
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      case_id: caseId,
      evidence_id: evidence.id,
      finding_id: null,
      event_date: normalizedDate,
      event_time: rawTime,
      title: `Event identified in ${evidence.original_filename}`,
      description: `Discovered chronological activity record in evidence file. Verified timestamp: ${normalizedDate} ${rawTime || ''}`,
      source: 'extracted',
      is_verified: 0,
      created_at: new Date().toISOString(),
    });
  }

  // Save all findings into local database
  for (const finding of findings) {
    await insertFinding(finding);
  }

  // Save all extracted events into database
  for (const event of events) {
    await insertEvent(event);
  }

  await logActivity(
    'analysis_completed',
    `Analyzed evidence "${evidence.original_filename}": ${findings.length} findings extracted, ${events.length} events identified.` +
      (isDuplicate ? ' (Duplicate hash alert!)' : ''),
    caseId,
    JSON.stringify({ findingsCount: findings.length, isDuplicate })
  );

  return {
    evidenceId: evidence.id,
    isDuplicate,
    duplicateOfEvidenceId: duplicate?.id,
    extractedFindings: findings,
    suggestedEvents: events,
    summary: `Extracted ${findings.length} verifiable entities (${seenPhones.size} phones, ${seenEmails.size} emails, ${seenUrls.size} URLs, ${seenAmounts.size} transactions) using rule-based offline parsing.`,
  };
};

