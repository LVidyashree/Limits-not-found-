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
        'Your official incident report has been rendered locally as a sealed PDF document.',
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
  const totalEvidenceSize = evidenceList.reduce((sum, ev) => sum + ev.file_size, 0);

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
        {/* Configuration Card */}
        <Card style={styles.configCard}>
          <View style={styles.configHeader}>
            <Ionicons name="settings-outline" size={18} color={Colors.teal} />
            <Text style={styles.configTitle}>Report Settings</Text>
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1, marginRight: Spacing.sm }}>
              <Text style={styles.switchLabel}>Include Pending Items</Text>
              <Text style={styles.switchSub}>
                Show unverified findings in the report
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
            label="Investigator Remarks"
            placeholder="Add concluding notes or instructions..."
            value={officerNotes}
            onChangeText={setOfficerNotes}
            multiline
            numberOfLines={2}
            style={{ height: 60, textAlignVertical: 'top', marginTop: 4 }}
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

        {/* Report Summary — replaces the huge inline PDF preview */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryBrandRow}>
              <Ionicons name="shield-checkmark" size={20} color={Colors.teal} />
              <View style={{ marginLeft: Spacing.sm }}>
                <Text style={styles.summaryBrand}>EVIDENCEVAULT</Text>
                <Text style={styles.summaryTagline}>OFFICIAL INCIDENT REPORT</Text>
              </View>
            </View>
            <Badge label="OFFLINE SEALED" type="teal" />
          </View>

          <View style={styles.summaryDivider} />

          {/* Case info row */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Case</Text>
            <Text style={styles.summaryValue}>{caseItem.title}</Text>
          </View>

          <View style={styles.summaryTwoCol}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Category</Text>
              <Text style={styles.summaryValueSmall}>{caseItem.category}</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Status</Text>
              <Text style={[styles.summaryValueSmall, { color: Colors.teal }]}>
                {caseItem.status.toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.summaryTwoCol}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Date</Text>
              <Text style={styles.summaryValueSmall}>
                {caseItem.incident_date} {caseItem.incident_time || ''}
              </Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Platform</Text>
              <Text style={styles.summaryValueSmall}>{caseItem.platform}</Text>
            </View>
          </View>

          <View style={styles.summaryDivider} />

          {/* Stats grid */}
          <Text style={styles.summarySectionTitle}>Report Contents</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Ionicons name="document-lock-outline" size={18} color={Colors.teal} />
              <Text style={styles.statValue}>{evidenceList.length}</Text>
              <Text style={styles.statLabel}>Evidence Files</Text>
              <Text style={styles.statSub}>{formatBytes(totalEvidenceSize)} total</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="checkmark-done-circle-outline" size={18} color={Colors.success} />
              <Text style={styles.statValue}>{verifiedFindings.length}</Text>
              <Text style={styles.statLabel}>Verified Findings</Text>
              <Text style={styles.statSub}>{pendingFindings.length} pending</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="time-outline" size={18} color={Colors.blue} />
              <Text style={styles.statValue}>{events.length}</Text>
              <Text style={styles.statLabel}>Timeline Events</Text>
              <Text style={styles.statSub}>chronological entries</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="finger-print" size={18} color={Colors.tealLight} />
              <Text style={styles.statValue}>{evidenceList.length}</Text>
              <Text style={styles.statLabel}>SHA-256 Hashes</Text>
              <Text style={styles.statSub}>bit-level custody</Text>
            </View>
          </View>

          <View style={styles.summaryDivider} />

          {/* Integrity note */}
          <View style={styles.integrityNote}>
            <Ionicons name="shield-outline" size={14} color={Colors.teal} />
            <Text style={styles.integrityText}>
              PDF will include chain-of-custody attestation, SHA-256 checksums for every file, and a full chronological timeline of events.
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          {/* Suspect info if present */}
          {caseItem.suspect_info ? (
            <View style={styles.suspectPreviewRow}>
              <Ionicons name="person-circle-outline" size={14} color={Colors.secondaryText} />
              <Text style={styles.suspectPreviewText} numberOfLines={1}>
                Suspect: {caseItem.suspect_info}
              </Text>
            </View>
          ) : null}

          {/* Description excerpt */}
          {caseItem.description ? (
            <Text style={styles.descPreview} numberOfLines={3}>
              {caseItem.description}
            </Text>
          ) : null}
        </Card>

        {/* Action footer */}
        <View style={styles.footerActions}>
          {!lastGeneratedPdfUri && (
            <Button
              title="Generate PDF Report"
              onPress={handleExportPdf}
              loading={generatingPdf}
              variant="primary"
              icon="document-text-outline"
              size="lg"
              style={{ flex: 1 }}
            />
          )}
          {lastGeneratedPdfUri && (
            <>
              <Button
                title="Share Report"
                onPress={() => handleSharePdf()}
                variant="primary"
                icon="share-outline"
                size="lg"
                style={{ flex: 1, marginRight: Spacing.sm }}
              />
              <Button
                title="Regenerate"
                onPress={handleExportPdf}
                variant="outline"
                icon="refresh-outline"
                size="lg"
              />
            </>
          )}
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
  configHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  configTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
    marginLeft: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  switchSub: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 1,
  },
  exportActionRow: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  summaryBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryBrand: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: 1,
  },
  summaryTagline: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.teal,
    letterSpacing: 0.8,
    marginTop: 1,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },
  summarySection: {
    marginBottom: Spacing.sm,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.secondaryText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
  summaryValueSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  summaryTwoCol: {
    flexDirection: 'row',
    marginBottom: Spacing.sm,
  },
  summaryCol: {
    flex: 1,
  },
  summarySectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.tealLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statBox: {
    width: '50%',
    paddingVertical: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
    marginTop: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.white,
    marginTop: 1,
  },
  statSub: {
    fontSize: 10,
    color: Colors.secondaryText,
    marginTop: 1,
  },
  integrityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  integrityText: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginLeft: 8,
    flex: 1,
  },
  suspectPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  suspectPreviewText: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 6,
    flex: 1,
  },
  descPreview: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 17,
  },
  footerActions: {
    flexDirection: 'row',
  },
});