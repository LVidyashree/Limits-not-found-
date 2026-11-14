import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  Finding,
  Evidence,
  QwenModelStatus,
  QwenFullAnalysis,
  QwenAnalysisResult,
} from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Badge,
  SectionHeader,
  EmptyState,
} from '../components';
import {
  getFindingsByCase,
  getEvidenceByCase,
} from '../services/database';
import { runEvidenceAnalysis } from '../services/analysisEngine';
import {
  getQwenModelStatus,
  runFullQwenAnalysis,
  getStatusLabel,
  getStatusColor,
  isModelReady,
  QwenStatusResponse,
} from '../services/qwenApi';

type Props = NativeStackScreenProps<RootStackParamList, 'Analysis'>;

export const AnalysisScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // ─── Qwen AI State ──────────────────────────────────────────────────────────
  const [qwenStatus, setQwenStatus] = useState<QwenStatusResponse | null>(null);
  const [qwenStatusLoading, setQwenStatusLoading] = useState(false);
  const [qwenAnalysisRunning, setQwenAnalysisRunning] = useState(false);
  const [qwenResult, setQwenResult] = useState<QwenFullAnalysis | null>(null);
  const [qwenExpanded, setQwenExpanded] = useState(false);

  useEffect(() => {
    loadData();
    checkQwenStatus();
  }, [caseId]);

  const loadData = async () => {
    try {
      const [fnd, ev] = await Promise.all([
        getFindingsByCase(caseId),
        getEvidenceByCase(caseId),
      ]);
      setFindings(fnd);
      setEvidenceList(ev);
    } catch (err) {
      console.error('Failed to load analysis findings:', err);
    }
  };

  // ─── Qwen Helpers ────────────────────────────────────────────────────────────

  const checkQwenStatus = async () => {
    setQwenStatusLoading(true);
    try {
      const status = await getQwenModelStatus();
      setQwenStatus(status);
    } catch (err) {
      setQwenStatus({
        status: 'MODEL_NOT_FOUND' as QwenModelStatus,
        model_path: '',
        message: `Cannot reach backend: ${String(err)}`,
      });
    } finally {
      setQwenStatusLoading(false);
    }
  };

  const handleRunQwenAnalysis = async () => {
    if (evidenceList.length === 0) {
      Alert.alert('No Evidence', 'Upload evidence files first so Qwen has text to analyse.');
      return;
    }
    if (qwenStatus?.status === 'MODEL_NOT_FOUND') {
      Alert.alert(
        'Model Not Found',
        `Place Qwen2.5-3B-Instruct.Q4_K_M.gguf in the backend/models/ directory, then try again.\n\nConfigured path: ${qwenStatus.model_path}`
      );
      return;
    }

    setQwenAnalysisRunning(true);
    setQwenExpanded(true);
    try {
      const result = await runFullQwenAnalysis(caseId);
      setQwenResult(result as unknown as QwenFullAnalysis);
      setQwenStatus(prev => prev ? { ...prev, status: result.model_status as QwenModelStatus } : prev);
    } catch (err) {
      Alert.alert('Qwen Error', `AI analysis failed: ${String(err)}`);
    } finally {
      setQwenAnalysisRunning(false);
    }
  };

  const handleRunFullScan = async () => {
    if (evidenceList.length === 0) {
      Alert.alert('No Evidence', 'Please upload evidence files first.');
      return;
    }

    setScanning(true);
    try {
      for (const ev of evidenceList) {
        await runEvidenceAnalysis(ev);
      }
      await loadData();
      Alert.alert('Scan Complete', `Extracted ${findings.length} verifiable forensic entities.`);
    } catch (err) {
      Alert.alert('Scan Error', String(err));
    } finally {
      setScanning(false);
    }
  };

  const categories = [
    { key: 'all', label: `All (${findings.length})` },
    { key: 'financial', label: 'Financial / UPI' },
    { key: 'phone', label: 'Phones' },
    { key: 'url', label: 'URLs' },
    { key: 'account', label: 'Accounts' },
    { key: 'keyword', label: 'Threat Words' },
  ];

  const filteredFindings =
    activeCategory === 'all'
      ? findings
      : findings.filter((f) => f.finding_type === activeCategory);

  const getEvidenceName = (evidenceId: string): string => {
    const ev = evidenceList.find((e) => e.id === evidenceId);
    return ev ? ev.original_filename : 'Original File';
  };

  return (
    <ScreenWrapper>
      <Header
        title="AI-Assisted Analysis"
        subtitle="Offline Pattern & Entity Extraction"
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'checkbox-outline',
          onPress: () => navigation.navigate('Verification', { caseId }),
          color: Colors.teal,
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ─── Qwen AI Section ──────────────────────────────────────────── */}
        <Card style={styles.qwenCard}>
          <TouchableOpacity
            style={styles.qwenHeader}
            onPress={() => setQwenExpanded(!qwenExpanded)}
          >
            <View style={styles.qwenTitleRow}>
              <Ionicons name="hardware-chip-outline" size={16} color="#A78BFA" />
              <Text style={styles.qwenTitle}>Qwen AI Deep Analysis</Text>
              <Badge label="LOCAL" type="teal" />
            </View>
            <Ionicons
              name={qwenExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={Colors.secondaryText}
            />
          </TouchableOpacity>

          {/* Model Status Row */}
          <View style={styles.qwenStatusRow}>
            {qwenStatusLoading ? (
              <ActivityIndicator size="small" color="#A78BFA" />
            ) : qwenStatus ? (
              <>
                <View
                  style={[
                    styles.qwenStatusDot,
                    { backgroundColor: getStatusColor(qwenStatus.status) },
                  ]}
                />
                <Text style={styles.qwenStatusText}>
                  {getStatusLabel(qwenStatus.status)}
                </Text>
              </>
            ) : (
              <Text style={styles.qwenStatusText}>Checking model...</Text>
            )}
            <TouchableOpacity onPress={checkQwenStatus} style={styles.qwenRefreshBtn}>
              <Ionicons name="refresh-outline" size={14} color={Colors.secondaryText} />
            </TouchableOpacity>
          </View>

          {qwenExpanded && (
            <View style={styles.qwenExpandedContent}>
              {/* Model not found guidance */}
              {qwenStatus?.status === 'MODEL_NOT_FOUND' && (
                <View style={styles.qwenWarningBox}>
                  <Ionicons name="warning-outline" size={14} color="#F59E0B" />
                  <Text style={styles.qwenWarningText}>
                    Model file not found. Place{'\n'}
                    <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>
                      Qwen2.5-3B-Instruct.Q4_K_M.gguf
                    </Text>
                    {'\n'}in the backend/models/ directory.
                  </Text>
                </View>
              )}

              {/* Run Analysis Button */}
              <Button
                title={
                  qwenAnalysisRunning
                    ? 'Running Qwen Analysis...'
                    : 'Run 7-Capability AI Analysis'
                }
                onPress={handleRunQwenAnalysis}
                loading={qwenAnalysisRunning}
                variant="primary"
                icon="sparkles-outline"
                style={styles.qwenRunBtn}
              />

              {/* Results */}
              {qwenResult && (
                <View style={styles.qwenResultsContainer}>
                  <Text style={styles.qwenResultsTitle}>AI Analysis Results</Text>
                  <Text style={styles.qwenReviewWarning}>
                    ⚠️ All findings require human review. AI output is for investigative guidance only.
                  </Text>

                  {/* Classification */}
                  {qwenResult.results?.classification?.result && (
                    <View style={styles.qwenResultCard}>
                      <Text style={styles.qwenResultCardTitle}>📋 Incident Classification</Text>
                      <Text style={styles.qwenResultRow}>
                        Category: {String((qwenResult.results.classification.result as Record<string, unknown>)?.primary_category ?? 'Unknown')}
                      </Text>
                      <Text style={styles.qwenResultRow}>
                        Confidence: {String((qwenResult.results.classification.result as Record<string, unknown>)?.confidence ?? 'Unknown')}
                      </Text>
                      <Text style={styles.qwenResultNote}>
                        {String((qwenResult.results.classification.result as Record<string, unknown>)?.reasoning ?? '')}
                      </Text>
                    </View>
                  )}

                  {/* Entities */}
                  {qwenResult.results?.entities?.result && (
                    <View style={styles.qwenResultCard}>
                      <Text style={styles.qwenResultCardTitle}>🔍 Extracted Entities</Text>
                      {(['people', 'organisations', 'locations', 'dates', 'amounts', 'identifiers'] as const).map((key) => {
                        const items = (qwenResult.results.entities!.result as Record<string, unknown>)?.[key];
                        if (!Array.isArray(items) || items.length === 0) return null;
                        return (
                          <Text key={key} style={styles.qwenResultRow}>
                            {key.charAt(0).toUpperCase() + key.slice(1)}: {items.length} found
                          </Text>
                        );
                      })}
                    </View>
                  )}

                  {/* Conflicts */}
                  {qwenResult.results?.conflicts?.result && (
                    <View style={styles.qwenResultCard}>
                      <Text style={styles.qwenResultCardTitle}>⚡ Potential Conflicts</Text>
                      {(() => {
                        const conflictsData = qwenResult.results.conflicts!.result as Record<string, unknown>;
                        const conflicts = conflictsData?.conflicts;
                        const count = Array.isArray(conflicts) ? conflicts.length : 0;
                        return (
                          <Text style={styles.qwenResultRow}>
                            {count} inconsistenc{count === 1 ? 'y' : 'ies'} flagged for review
                          </Text>
                        );
                      })()}
                    </View>
                  )}

                  {/* Missing Info */}
                  {qwenResult.results?.missing_info?.result && (
                    <View style={styles.qwenResultCard}>
                      <Text style={styles.qwenResultCardTitle}>❓ Missing Information</Text>
                      {(() => {
                        const missingData = qwenResult.results.missing_info!.result as Record<string, unknown>;
                        const missing = missingData?.missing_information;
                        const count = Array.isArray(missing) ? missing.length : 0;
                        return (
                          <Text style={styles.qwenResultRow}>
                            {count} gap{count !== 1 ? 's' : ''} identified
                          </Text>
                        );
                      })()}
                    </View>
                  )}

                  {/* Errors from capabilities */}
                  {Object.entries(qwenResult.results).map(([cap, res]) => {
                    const r = res as QwenAnalysisResult;
                    if (!r?.error) return null;
                    return (
                      <View key={cap} style={styles.qwenErrorCard}>
                        <Text style={styles.qwenErrorText}>{cap}: {r.error}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </Card>

        {/* Transparent AI Principle Notice */}
        <Card style={styles.principleCard}>
          <View style={styles.principleHeader}>
            <Ionicons name="sparkles" size={16} color={Colors.teal} />
            <Text style={styles.principleTitle}>Real Local Intelligence</Text>
          </View>
          <Text style={styles.principleText}>
            Our engine extracts entities using offline regular expressions,
            deterministic cryptographic hashes, and keyword heuristics. Zero cloud
            hallucinations: every single entity is verified against its raw original evidence.
          </Text>
        </Card>

        {/* Scan Actions */}
        <View style={styles.scanActionRow}>
          <Button
            title={scanning ? 'Scanning Files...' : 'Run Full Case Scan'}
            onPress={handleRunFullScan}
            loading={scanning}
            variant="primary"
            icon="scan-outline"
            style={{ flex: 1, marginRight: Spacing.sm }}
          />
          <Button
            title="Triage"
            onPress={() => navigation.navigate('Verification', { caseId })}
            variant="outline"
            icon="checkmark-done"
          />
        </View>

        {/* Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
        >
          {categories.map((cat) => {
            const isSelected = activeCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setActiveCategory(cat.key)}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Findings List */}
        <SectionHeader
          title={`Discovered Entities (${filteredFindings.length})`}
          badge={`${findings.filter((f) => f.verification_status === 'verified').length} Verified`}
        />

        {filteredFindings.length === 0 ? (
          <EmptyState
            icon="scan-outline"
            title="No Entities Discovered"
            description="Upload evidence files or run the scanner to extract phone numbers, payment details, and accounts."
            actionTitle="Upload Evidence"
            onAction={() => navigation.navigate('UploadEvidence', { caseId })}
          />
        ) : (
          filteredFindings.map((finding) => (
            <Card key={finding.id} style={styles.findingCard}>
              <View style={styles.findingCardHeader}>
                <View style={styles.findingTypeRow}>
                  <Ionicons
                    name={
                      finding.finding_type === 'financial'
                        ? 'cash-outline'
                        : finding.finding_type === 'phone'
                        ? 'call-outline'
                        : finding.finding_type === 'url'
                        ? 'globe-outline'
                        : finding.finding_type === 'account'
                        ? 'person-outline'
                        : 'warning-outline'
                    }
                    size={16}
                    color={Colors.teal}
                  />
                  <Text style={styles.findingLabel}>{finding.label}</Text>
                </View>
                <Badge
                  label={
                    finding.verification_status === 'verified'
                      ? 'VERIFIED'
                      : finding.verification_status === 'needs_verification'
                      ? 'PENDING'
                      : 'REJECTED'
                  }
                  type={
                    finding.verification_status === 'verified'
                      ? 'success'
                      : finding.verification_status === 'needs_verification'
                      ? 'warning'
                      : 'danger'
                  }
                />
              </View>

              <Text style={styles.findingValue} selectable>
                {finding.finding_value}
              </Text>

              {finding.context_snippet ? (
                <View style={styles.snippetBox}>
                  <Text style={styles.snippetText}>
                    "{finding.context_snippet}"
                  </Text>
                </View>
              ) : null}

              {/* Linked Evidence Source */}
              <TouchableOpacity
                style={styles.evidenceSourceRow}
                onPress={() =>
                  navigation.navigate('EvidenceDetail', {
                    evidenceId: finding.evidence_id,
                    caseId,
                  })
                }
              >
                <Ionicons name="link-outline" size={14} color={Colors.teal} />
                <Text style={styles.evidenceSourceText}>
                  Source: {getEvidenceName(finding.evidence_id)}
                </Text>
                <Ionicons name="chevron-forward" size={12} color={Colors.teal} />
              </TouchableOpacity>
            </Card>
          ))
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  principleCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  principleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  principleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 6,
  },
  principleText: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  scanActionRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: Colors.tealMuted,
    borderColor: Colors.teal,
  },
  chipText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  chipTextSelected: {
    color: Colors.white,
    fontWeight: '600',
  },
  findingCard: {
    marginBottom: Spacing.sm,
  },
  findingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  findingTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  findingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.tealLight,
    marginLeft: 6,
  },
  findingValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  snippetBox: {
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: 6,
  },
  snippetText: {
    fontSize: 11,
    color: Colors.secondaryText,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  evidenceSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  evidenceSourceText: {
    fontSize: 11,
    color: Colors.teal,
    marginLeft: 4,
    flex: 1,
  },

  // ─── Qwen AI Styles ──────────────────────────────────────────────────────────
  qwenCard: {
    backgroundColor: '#1A1033',
    borderColor: '#7C3AED',
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  qwenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  qwenTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qwenTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A78BFA',
    marginLeft: 6,
    marginRight: 6,
  },
  qwenStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    minHeight: 22,
  },
  qwenStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  qwenStatusText: {
    fontSize: 12,
    color: Colors.secondaryText,
    flex: 1,
  },
  qwenRefreshBtn: {
    padding: 4,
  },
  qwenExpandedContent: {
    marginTop: Spacing.sm,
  },
  qwenWarningBox: {
    flexDirection: 'row',
    backgroundColor: '#451A03',
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: '#F59E0B',
    alignItems: 'flex-start',
    gap: 6,
  },
  qwenWarningText: {
    fontSize: 12,
    color: '#FDE68A',
    flex: 1,
    lineHeight: 18,
  },
  qwenRunBtn: {
    marginBottom: Spacing.sm,
  },
  qwenResultsContainer: {
    marginTop: 4,
  },
  qwenResultsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A78BFA',
    marginBottom: 4,
  },
  qwenReviewWarning: {
    fontSize: 11,
    color: '#F59E0B',
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  qwenResultCard: {
    backgroundColor: Colors.secondaryBackground,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: '#7C3AED',
  },
  qwenResultCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C4B5FD',
    marginBottom: 4,
  },
  qwenResultRow: {
    fontSize: 12,
    color: Colors.white,
    marginBottom: 2,
  },
  qwenResultNote: {
    fontSize: 11,
    color: Colors.secondaryText,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: 2,
  },
  qwenErrorCard: {
    backgroundColor: '#2D0A0A',
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  qwenErrorText: {
    fontSize: 11,
    color: '#FCA5A5',
  },
});

