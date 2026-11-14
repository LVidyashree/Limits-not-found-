import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCloudCasePayload,
  isValidIncidentDate,
  mapCloudCaseToLocal,
  normalizeCaseStatus,
  normalizeIncidentDate,
  validateCaseDraft,
} from '../src/services/caseServiceCore.ts';

const baseDraft = {
  title: '  Telegram investment scam  ',
  category: 'Financial Fraud & UPI Scams',
  description: '  Sent ₹25,000 via UPI.  ',
  incident_date: '2026-11-14',
  incident_time: '14:30',
  platform: 'Telegram',
  suspect_info: '@scammer',
  severity: 'high',
};

const cloudRow = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Cloud case',
  incident_type: 'Identity Theft & Impersonation',
  incident_description: 'Account takeover',
  incident_date: '2026-10-02',
  incident_platform: 'Email',
  status: 'closed',
  created_at: '2026-10-02T10:00:00.000Z',
  updated_at: '2026-10-03T11:00:00.000Z',
};

test('isValidIncidentDate accepts real calendar dates only', () => {
  for (const value of ['2026-11-14', '2024-02-29', '2000-01-01']) {
    assert.equal(isValidIncidentDate(value), true, value);
  }

  for (const value of [
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-11-1',
    '14/11/2026',
    '',
    '2026-11-14T00:00:00Z',
  ]) {
    assert.equal(isValidIncidentDate(value), false, value);
  }
});

test('normalizeIncidentDate trims a valid date and rejects invalid values', () => {
  assert.equal(normalizeIncidentDate(' 2026-11-14 '), '2026-11-14');
  assert.throws(() => normalizeIncidentDate('2026-02-30'), /YYYY-MM-DD/);
  assert.throws(() => normalizeIncidentDate(null), /YYYY-MM-DD/);
});

test('validateCaseDraft trims user input and preserves optional local fields', () => {
  assert.deepEqual(validateCaseDraft(baseDraft), {
    title: 'Telegram investment scam',
    category: 'Financial Fraud & UPI Scams',
    description: 'Sent ₹25,000 via UPI.',
    incident_date: '2026-11-14',
    incident_time: '14:30',
    platform: 'Telegram',
    suspect_info: '@scammer',
    severity: 'high',
  });
});

test('validateCaseDraft enforces cloud schema limits', () => {
  assert.throws(() => validateCaseDraft({ ...baseDraft, title: '   ' }), /title/i);
  assert.throws(() => validateCaseDraft({ ...baseDraft, title: 'x'.repeat(201) }), /200/);
  assert.throws(() => validateCaseDraft({ ...baseDraft, category: '' }), /category/i);
  assert.throws(
    () => validateCaseDraft({ ...baseDraft, description: 'x'.repeat(20001) }),
    /20,000/
  );
  assert.throws(
    () => validateCaseDraft({ ...baseDraft, platform: 'x'.repeat(101) }),
    /100/
  );
  assert.throws(
    () => validateCaseDraft({ ...baseDraft, incident_date: '2026-02-30' }),
    /YYYY-MM-DD/
  );
});

test('normalizeCaseStatus only returns supported local statuses', () => {
  assert.equal(normalizeCaseStatus('active'), 'active');
  assert.equal(normalizeCaseStatus('closed'), 'closed');
  assert.equal(normalizeCaseStatus('archived'), 'archived');
  assert.equal(normalizeCaseStatus('deleted'), 'active');
  assert.equal(normalizeCaseStatus(null), 'active');
});

test('mapCloudCaseToLocal keeps the cloud UUID and safe local defaults', () => {
  const local = mapCloudCaseToLocal(cloudRow);

  assert.equal(local.id, `case_cloud_${cloudRow.id}`);
  assert.equal(local.cloud_case_id, cloudRow.id);
  assert.equal(local.title, 'Cloud case');
  assert.equal(local.category, 'Identity Theft & Impersonation');
  assert.equal(local.description, 'Account takeover');
  assert.equal(local.incident_date, '2026-10-02');
  assert.equal(local.platform, 'Email');
  assert.equal(local.status, 'closed');
  assert.equal(local.is_demo, 0);
  assert.equal(local.incident_time, '');
  assert.equal(local.suspect_info, '');
  assert.equal(local.severity, 'medium');
  assert.equal(local.created_at, cloudRow.created_at);
  assert.equal(local.updated_at, cloudRow.updated_at);
});

test('mapCloudCaseToLocal is deterministic for the same cloud row', () => {
  assert.deepEqual(mapCloudCaseToLocal(cloudRow), mapCloudCaseToLocal(cloudRow));
});

test('buildCloudCasePayload sends only schema fields and never user_id', () => {
  const local = mapCloudCaseToLocal(cloudRow);
  const payload = buildCloudCasePayload(local, cloudRow.id);

  assert.deepEqual(payload, {
    id: cloudRow.id,
    title: 'Cloud case',
    incident_type: 'Identity Theft & Impersonation',
    incident_description: 'Account takeover',
    incident_date: '2026-10-02',
    incident_platform: 'Email',
    status: 'closed',
  });
  assert.equal('user_id' in payload, false);
});
