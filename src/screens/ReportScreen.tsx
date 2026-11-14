import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  Case,
  Evidence,
  Finding,
  TimelineEvent,
} from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Input,
  Badge,
} from '../components';
import {
  getCaseById,
  getEvidenceByCase,
  getFindingsByCase,
  getEventsByCase,
} from '../services/database';
import { exportReportAsPdf, shareReportPdf } from '../services/reportGenerator';
import { formatBytes } from '../services/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Report'>;

export const ReportScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  // Report configuration
  const [includeUnverified, setIncludeUnverified] = useState(true);
  const [officerNotes, setOfficerNotes] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [lastGeneratedPdfUri, setLastGeneratedPdfUri] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [caseId]);

  const loadData = async () => {
    try {
      const [c, ev, fnd, evt] = await Promise.all([
        getCaseById(caseId),
        getEvidenceByCase(caseId),
        getFindingsByCase(caseId),
        getEventsByCase(caseId),
      ]);
      setCaseItem(c);
      setEvidenceList(ev);
      setFindings(fnd);
      setEvents(evt);
    } catch (err) {
      console.error('Failed to load report data:', err);
    }
  };

  const handleExportPdf = async () => {
    if (!caseItem) return;
    setGeneratingPdf(true);

    try {
      const pdfUri = await exportReportAsPdf({
        caseData: caseItem,
        evidenceList,
        findings,
        timelineEvents: events,
        includeUnverified,
        officerNotes: officerNotes.trim() || undefined,
      });

      setLastGeneratedPdfUri(pdfUri);
      setGeneratingPdf(false);

      Alert.alert(
        'PDF Report Generated',
        'Your official incident report has been rendered locally as a sealed PDF document. Would you like to save or share it now?',
        [
          { text: 'Keep in Vault' },
          {
            text: 'Save / Share PDF',
            onPress: () => handleSharePdf(pdfUri),
          },
        ]
      );
    } catch (err) {
      setGeneratingPdf(false);
      Alert.alert('PDF Export Error', String(err));
    }
  };

  const handleSharePdf = async (uri?: string) => {
    const targetUri = uri || lastGeneratedPdfUri;
    if (!targetUri) {
      await handleExportPdf();
      return;
    }

    try {
      await shareReportPdf(targetUri);
    } catch (err) {
      Alert.alert('Share Error', String(err));
    }
  };

  if (!caseItem) {
    return (
      <ScreenWrapper>
        <Header title="Incident Report" onBack={() => navigation.goBack()} />
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Compiling report assets...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  const verifiedFindings = findings.filter((f) => f.verification_status === 'verified');
  const pendingFindings = findings.filter((f) => f.verification_status === 'needs_verification');

  return (
    <ScreenWrapper>
      <Header
        title="Investigation Report"
        subtitle="Formal PDF Export"
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'share-outline',
          onPress: () => handleSharePdf(),
          color: Colors.teal,
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Customization Settings */}
        <Card style={styles.configCard}>
          <Text style={styles.configTitle}>Report Parameters</Text>

          <View style={styles.switchRow}>
            <View style={{ flex: 1, marginRight: Spacing.sm }}>
              <Text style={styles.switchLabel}>Include Pending Items</Text>
              <Text style={styles.switchSub}>
                List items requiring further verification in section 4
              </Text>
            </View>
            <Switch
              value={includeUnverified}
              onValueChange={setIncludeUnverified}
              trackColor={{ false: Colors.border, true: Colors.teal }}
              thumbColor={Colors.white}
            />
          </View>

          <Input
            label="Additional Investigator Remarks"
            placeholder="Add concluding remarks, legal notes, or instructions for investigating officer..."
            value={officerNotes}
            onChangeText={setOfficerNotes}
            multiline
            numberOfLines={3}
            style={{ height: 75, textAlignVertical: 'top', marginTop: 4 }}
          />

          <View style={styles.exportActionRow}>
            <Button
              title={generatingPdf ? 'Rendering PDF...' : 'Export Official PDF'}
              onPress={handleExportPdf}
              loading={generatingPdf}
              variant="primary"
              icon="download-outline"
              size="md"
              style={{ flex: 1, marginRight: Spacing.sm }}
            />
            {lastGeneratedPdfUri && (
              <Button
                title="Share"
                onPress={() => handleSharePdf()}
                variant="outline"
                icon="share-social-outline"
                size="md"
              />
            )}
          </View>
        </Card>

        {/* In-App Live Report Preview */}
        <View style={styles.previewContainer}>
          <View style={styles.previewHeaderBar}>
            <View>
              <Text style={styles.docBrand}>EVIDENCEVAULT</Text>
              <Text style={styles.docTagline}>
                YOUR EVIDENCE. YOUR CONTROL. AI-ASSISTED CLARITY.
              </Text>
            </View>
            <Badge label="OFFLINE SEALED" type="teal" />
          </View>

          {caseItem.is_demo ? (
            <View style={styles.demoWarningBanner}>
              <Text style={styles.demoWarningText}>
                ⚠️ DEMONSTRATION CASE — CONTAINS SYNTHETIC FICTIONAL DATA
              </Text>
            </View>
          ) : null}

          {/* Attestation Box */}
          <View style={styles.docAttestation}>
            <Text style={styles.docAttestationTitle}>
              CHAIN OF CUSTODY & INTEGRITY ATTESTATION:
            </Text>
            <Text style={styles.docAttestationText}>
              Generated offline on device. All digital evidence files recorded
              herein possess verifiable SHA-256 cryptographic hashes calculated upon local storage.
            </Text>
          </View>

          {/* Section 1: Overview */}
          <Text style={styles.docSectionTitle}>1. Incident Overview</Text>
          <View style={styles.docTable}>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Title</Text>
              <Text style={styles.docTableValBold}>{caseItem.title}</Text>
            </View>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Case ID</Text>
              <Text style={[styles.docTableVal, { fontFamily: 'monospace' }]}>
                {caseItem.id}
              </Text>
            </View>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Category</Text>
              <Text style={styles.docTableVal}>{caseItem.category}</Text>
            </View>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Platform</Text>
              <Text style={styles.docTableVal}>{caseItem.platform}</Text>
            </View>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Date & Time</Text>
              <Text style={styles.docTableVal}>
                {caseItem.incident_date} {caseItem.incident_time || ''}
              </Text>
            </View>
            <View style={styles.docTableRow}>
              <Text style={styles.docTableHead}>Suspect Info</Text>
              <Text style={styles.docTableVal}>
                {caseItem.suspect_info || 'Not specified'}
              </Text>
            </View>
          </View>

          {/* Section 2: Narrative */}
          <Text style={styles.docSectionTitle}>2. Incident Description</Text>
          <View style={styles.docNarrativeBox}>
            <Text style={styles.docNarrativeText}>
              {caseItem.description || 'No detailed description provided.'}
            </Text>
          </View>

          {/* Section 3: Evidence Index */}
          <Text style={styles.docSectionTitle}>
            3. Preserved Evidence Index ({evidenceList.length} Files)
          </Text>
          {evidenceList.map((ev, index) => (
            <View key={ev.id} style={styles.docEvRow}>
              <View style={styles.docEvHeader}>
                <Text style={styles.docEvIndex}>#{index + 1}</Text>
                <Text style={styles.docEvName}>{ev.original_filename}</Text>
                <Text style={styles.docEvSize}>{formatBytes(ev.file_size)}</Text>
              </View>
              <Text style={styles.docEvHash} selectable>
                SHA-256: {ev.sha256_hash}
              </Text>
            </View>
          ))}

          {/* Section 4: Verified Findings */}
          <Text style={styles.docSectionTitle}>
            4. Verified Findings ({verifiedFindings.length} Items)
          </Text>
          {verifiedFindings.map((f) => (
            <View key={f.id} style={styles.docFindingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.docFindingLabel}>{f.label}</Text>
                <Text style={styles.docFindingVal}>{f.finding_value}</Text>
                {f.user_notes ? (
                  <Text style={styles.docFindingNotes}>Note: {f.user_notes}</Text>
                ) : null}
              </View>
              <Badge label="VERIFIED" type="success" />
            </View>
          ))}

          {includeUnverified && pendingFindings.length > 0 && (
            <>
              <Text style={[styles.docSectionTitle, { marginTop: 12 }]}>
                Items Requiring Verification ({pendingFindings.length} Items)
              </Text>
              {pendingFindings.map((f) => (
                <View key={f.id} style={styles.docFindingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docFindingLabel}>{f.label}</Text>
                    <Text style={styles.docFindingVal}>{f.finding_value}</Text>
                  </View>
                  <Badge label="PENDING" type="warning" />
                </View>
              ))}
            </>
          )}

          {/* Section 5: Timeline */}
          <Text style={styles.docSectionTitle}>
            5. Chronological Incident Timeline ({events.length} Milestones)
          </Text>
          {events.map((evt) => (
            <View key={evt.id} style={styles.docTimelineRow}>
              <Text style={styles.docTimelineDate}>
                {evt.event_date} {evt.event_time ? '• ' + evt.event_time : ''}
              </Text>
              <Text style={styles.docTimelineTitle}>{evt.title}</Text>
              {evt.description ? (
                <Text style={styles.docTimelineDesc}>{evt.description}</Text>
              ) : null}
            </View>
          ))}

          {/* Legal Disclaimer */}
          <View style={styles.docDisclaimer}>
            <Text style={styles.docDisclaimerText}>
              DISCLAIMER: EvidenceVault is an offline evidence preservation tool.
              Cryptographic SHA-256 hashes certify bit-level custody preservation on device.
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.secondaryText,
    fontSize: 14,
  },
  configCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  configTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: Spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  switchSub: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  exportActionRow: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
  },
  previewContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  previewHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#176B87',
    paddingBottom: 8,
    marginBottom: 10,
  },
  docBrand: {
    fontSize: 16,
    fontWeight: '800',
    color: '#101827',
    letterSpacing: 0.5,
  },
  docTagline: {
    fontSize: 7.5,
    fontWeight: '700',
    color: '#45A3A0',
    letterSpacing: 0.5,
  },
  demoWarningBanner: {
    backgroundColor: '#FEF3C7',
    padding: 6,
    borderRadius: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  demoWarningText: {
    color: '#92400E',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  docAttestation: {
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: '#45A3A0',
    padding: 8,
    borderRadius: 4,
    marginBottom: 12,
  },
  docAttestationTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#176B87',
  },
  docAttestationText: {
    fontSize: 8.5,
    color: '#334155',
    lineHeight: 12,
    marginTop: 2,
  },
  docSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#176B87',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 4,
    marginTop: 10,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  docTable: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 4,
    marginBottom: 8,
  },
  docTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    padding: 6,
  },
  docTableHead: {
    width: '30%',
    fontSize: 9,
    fontWeight: '600',
    color: '#475569',
  },
  docTableVal: {
    width: '70%',
    fontSize: 9,
    color: '#0F172A',
  },
  docTableValBold: {
    width: '70%',
    fontSize: 9,
    fontWeight: '700',
    color: '#0F172A',
  },
  docNarrativeBox: {
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  docNarrativeText: {
    fontSize: 9,
    color: '#334155',
    lineHeight: 13,
  },
  docEvRow: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  docEvHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  docEvIndex: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#176B87',
    marginRight: 4,
  },
  docEvName: {
    fontSize: 9,
    fontWeight: '600',
    color: '#0F172A',
    flex: 1,
  },
  docEvSize: {
    fontSize: 8,
    color: '#64748B',
  },
  docEvHash: {
    fontSize: 7.5,
    fontFamily: 'monospace',
    color: '#0F172A',
    marginTop: 2,
  },
  docFindingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  docFindingLabel: {
    fontSize: 8.5,
    fontWeight: '600',
    color: '#176B87',
  },
  docFindingVal: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: 'monospace',
  },
  docFindingNotes: {
    fontSize: 7.5,
    color: '#64748B',
    fontStyle: 'italic',
  },
  docTimelineRow: {
    paddingVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: '#45A3A0',
    paddingLeft: 6,
    marginBottom: 4,
  },
  docTimelineDate: {
    fontSize: 8,
    fontWeight: '700',
    color: '#176B87',
  },
  docTimelineTitle: {
    fontSize: 8.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  docTimelineDesc: {
    fontSize: 8,
    color: '#475569',
  },
  docDisclaimer: {
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  docDisclaimerText: {
    fontSize: 7,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 10,
  },
});

