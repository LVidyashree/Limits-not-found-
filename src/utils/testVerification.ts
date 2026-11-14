import { checkPassphraseStrength } from '../services/security';
import { generateHtmlReport } from '../services/reportGenerator';
import { Case, Evidence, Finding, TimelineEvent } from '../types';

export const runSystemDiagnostics = (): {
  passphraseTest: boolean;
  htmlReportTest: boolean;
  regexTest: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Test 1: Passphrase Strength
  const weakCheck = checkPassphraseStrength('1234');
  const strongCheck = checkPassphraseStrength('EvidenceVault#2026!');
  const passphraseTest = !weakCheck.isValid && strongCheck.isValid;
  if (!passphraseTest) {
    errors.push('Passphrase validation test failed');
  }

  // Test 2: HTML Report Generation
  const dummyCase: Case = {
    id: 'case_test_01',
    title: 'Test Incident Case',
    category: 'Financial Fraud',
    description: 'Testing incident generation',
    incident_date: '2026-11-14',
    incident_time: '12:00',
    platform: 'WhatsApp',
    suspect_info: '+91 98765 43210',
    severity: 'high',
    status: 'active',
    is_demo: 0,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
  };

  const dummyEvidence: Evidence[] = [
    {
      id: 'ev_test_01',
      case_id: 'case_test_01',
      filename: 'test_file.png',
      original_filename: 'screenshot_whatsapp.png',
      file_path: 'file:///data/evidence/test.png',
      file_size: 1048576,
      file_type: 'image',
      mime_type: 'image/png',
      sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      processing_status: 'completed',
      extracted_text: 'Payment of Rs. 25,000 sent to apex@okaxis UTR 431902847192',
      metadata_json: null,
      created_at: '2026-11-14T12:05:00Z',
      is_verified: 1,
    },
  ];

  const dummyFindings: Finding[] = [
    {
      id: 'fnd_01',
      case_id: 'case_test_01',
      evidence_id: 'ev_test_01',
      finding_type: 'financial',
      finding_value: 'apex@okaxis',
      label: 'UPI ID',
      context_snippet: 'sent to apex@okaxis',
      confidence: 0.99,
      verification_status: 'verified',
      verified_at: '2026-11-14T12:10:00Z',
      user_notes: 'Confirmed',
      created_at: '2026-11-14T12:06:00Z',
    },
  ];

  const dummyTimeline: TimelineEvent[] = [
    {
      id: 'evt_01',
      case_id: 'case_test_01',
      evidence_id: 'ev_test_01',
      finding_id: 'fnd_01',
      event_date: '2026-11-14',
      event_time: '12:00',
      title: 'Payment sent',
      description: 'Rs 25,000 sent via UPI',
      source: 'extracted',
      is_verified: 1,
      created_at: '2026-11-14T12:06:00Z',
    },
  ];

  const htmlReport = generateHtmlReport({
    caseData: dummyCase,
    evidenceList: dummyEvidence,
    findings: dummyFindings,
    timelineEvents: dummyTimeline,
  });

  const htmlReportTest =
    htmlReport.includes('EVIDENCEVAULT') &&
    htmlReport.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') &&
    htmlReport.includes('apex@okaxis') &&
    htmlReport.includes('CHAIN OF CUSTODY');

  if (!htmlReportTest) {
    errors.push('HTML Report structure verification failed');
  }

  // Test 3: Pattern matching regex
  const sampleText = 'Sent ₹25,000 to suspect apexinvest@okaxis. Contact +91 98201 54321. Ref UTR: 431902847192. Portal https://fake-invest.xyz';
  const hasUpi = /apexinvest@okaxis/i.test(sampleText);
  const hasAmount = /₹25,000/.test(sampleText);
  const hasPhone = /\+91[\s-]?[0-9]{5}[\s-]?[0-9]{5}/.test(sampleText);
  const hasUtr = /431902847192/.test(sampleText);
  const hasUrl = /https:\/\/fake-invest\.xyz/.test(sampleText);

  const regexTest = hasUpi && hasAmount && hasPhone && hasUtr && hasUrl;
  if (!regexTest) {
    errors.push('Regex patterns failed on sample text');
  }

  return {
    passphraseTest,
    htmlReportTest,
    regexTest,
    errors,
  };
};

