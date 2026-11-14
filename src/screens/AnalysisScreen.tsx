import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  Finding,
  Evidence,
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

type Props = NativeStackScreenProps<RootStackParamList, 'Analysis'>;

export const AnalysisScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  useEffect(() => {
    loadData();
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
});

