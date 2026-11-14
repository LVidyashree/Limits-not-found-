import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Evidence, Finding } from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Badge,
  SectionHeader,
} from '../components';
import {
  getEvidenceById,
  getFindingsByEvidence,
  deleteEvidence,
  updateEvidenceVerification,
} from '../services/database';
import {
  verifyFileIntegrity,
  formatBytes,
  deleteFileLocally,
  readTextFromFile,
} from '../services/storage';
import { runEvidenceAnalysis } from '../services/analysisEngine';

type Props = NativeStackScreenProps<RootStackParamList, 'EvidenceDetail'>;

export const EvidenceDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { evidenceId, caseId } = route.params;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [verifyingHash, setVerifyingHash] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    tested: boolean;
    valid: boolean;
    hash: string;
  }>({ tested: false, valid: false, hash: '' });

  useEffect(() => {
    loadData();
  }, [evidenceId]);

  const loadData = async () => {
    try {
      const ev = await getEvidenceById(evidenceId);
      if (ev) {
        setEvidence(ev);
        const fnd = await getFindingsByEvidence(evidenceId);
        setFindings(fnd);

        if (ev.file_type === 'text') {
          const txt = await readTextFromFile(ev.file_path);
          setFileContent(txt);
        }
      }
    } catch (err) {
      console.error('Failed to load evidence detail:', err);
    }
  };

  const handleAuditIntegrity = async () => {
    if (!evidence) return;
    setVerifyingHash(true);

    try {
      const res = await verifyFileIntegrity(evidence.file_path, evidence.sha256_hash);
      setAuditResult({
        tested: true,
        valid: res.isValid,
        hash: res.currentHash,
      });

      if (res.isValid) {
        await updateEvidenceVerification(evidence.id, 1);
        setEvidence({ ...evidence, is_verified: 1 });
        Alert.alert(
          'Bit-Exact Integrity Verified',
          `File on disk matches recorded SHA-256 hash perfectly:\n\n${res.currentHash}\n\nZero modifications or corruptions detected.`
        );
      } else {
        Alert.alert(
          'Integrity Verification Alert',
          `The hash on disk does not match! Expected:\n${evidence.sha256_hash}\n\nGot:\n${res.currentHash}`
        );
      }
    } catch (err) {
      Alert.alert('Audit Error', String(err));
    } finally {
      setVerifyingHash(false);
    }
  };

  const handleReanalyze = async () => {
    if (!evidence) return;
    try {
      await runEvidenceAnalysis(evidence, fileContent || undefined);
      await loadData();
      Alert.alert('Analysis Complete', 'Local entity extraction and duplicate scans updated.');
    } catch (err) {
      Alert.alert('Analysis Error', String(err));
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Evidence File',
      `Are you sure you want to delete "${evidence?.original_filename}"? The local file and associated findings will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            if (evidence) {
              await deleteFileLocally(evidence.file_path);
              await deleteEvidence(evidence.id);
              navigation.goBack();
            }
          },
        },
      ]
    );
  };

  if (!evidence) {
    return (
      <ScreenWrapper>
        <Header title="Evidence Asset" onBack={() => navigation.goBack()} />
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Loading evidence metadata...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <Header
        title={evidence.original_filename}
        subtitle={`${evidence.file_type.toUpperCase()} • ${formatBytes(evidence.file_size)}`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'trash-outline',
          onPress: handleDelete,
          color: Colors.danger,
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Visual Preview / Thumbnail */}
        <Card style={styles.previewCard}>
          {evidence.file_type === 'image' ? (
            <Image
              source={{ uri: evidence.file_path }}
              style={styles.imagePreview}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.genericFilePreview}>
              <Ionicons
                name={
                  evidence.file_type === 'pdf'
                    ? 'document-text'
                    : evidence.file_type === 'audio'
                    ? 'musical-notes'
                    : evidence.file_type === 'video'
                    ? 'videocam'
                    : 'document'
                }
                size={54}
                color={Colors.teal}
              />
              <Text style={styles.previewFileName}>{evidence.original_filename}</Text>
              <Text style={styles.previewMeta}>
                {evidence.mime_type} • {formatBytes(evidence.file_size)}
              </Text>
            </View>
          )}
        </Card>

        {/* SHA-256 Checksum Card */}
        <Card style={styles.hashCard}>
          <View style={styles.hashHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="finger-print" size={18} color={Colors.teal} />
              <Text style={styles.hashTitle}>SHA-256 Cryptographic Checksum</Text>
            </View>
            {evidence.is_verified || auditResult.valid ? (
              <Badge label="VERIFIED MATCH" type="success" />
            ) : (
              <Badge label="SEALED AT UPLOAD" type="teal" />
            )}
          </View>

          <View style={styles.hashBox}>
            <Text style={styles.hashString} selectable>
              {evidence.sha256_hash}
            </Text>
          </View>

          <Text style={styles.hashExplanation}>
            This 256-bit hash uniquely identifies the byte sequence of this file.
            Any modification, deletion, or tampering changes this hash completely.
          </Text>

          <Button
            title={verifyingHash ? 'Verifying Bits...' : 'Verify File Integrity On-Disk'}
            onPress={handleAuditIntegrity}
            loading={verifyingHash}
            variant="outline"
            size="sm"
            icon="shield-checkmark-outline"
            style={{ marginTop: Spacing.sm }}
          />
        </Card>

        {/* Custody Metadata Card */}
        <Card>
          <Text style={styles.cardSectionTitle}>Custody Metadata</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Original Filename:</Text>
            <Text style={styles.metaVal}>{evidence.original_filename}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Vault Filename:</Text>
            <Text style={styles.metaVal}>{evidence.filename}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Preserved Date:</Text>
            <Text style={styles.metaVal}>
              {new Date(evidence.created_at).toLocaleString()}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Exact File Size:</Text>
            <Text style={styles.metaVal}>
              {evidence.file_size} bytes ({formatBytes(evidence.file_size)})
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Processing Status:</Text>
            <Text style={[styles.metaVal, { color: Colors.teal }]}>
              {evidence.processing_status.toUpperCase()}
            </Text>
          </View>
        </Card>

        {/* Extracted Text Content Viewer (if text or transcript) */}
        {(fileContent || evidence.extracted_text) && (
          <Card>
            <View style={styles.textHeader}>
              <Text style={styles.cardSectionTitle}>Extracted Content & Notes</Text>
              <Badge label="LOCAL EXTRACTION" type="teal" />
            </View>
            <ScrollView style={styles.textBox} nestedScrollEnabled>
              <Text style={styles.textContent} selectable>
                {fileContent || evidence.extracted_text}
              </Text>
            </ScrollView>
          </Card>
        )}

        {/* Associated Findings */}
        <SectionHeader
          title={`Extracted Findings (${findings.length})`}
          actionText={findings.length > 0 ? 'Triage Findings' : 'Run Extractor'}
          onAction={
            findings.length > 0
              ? () => navigation.navigate('Verification', { caseId })
              : handleReanalyze
          }
        />

        {findings.length === 0 ? (
          <Card>
            <Text style={styles.noFindingsText}>
              No suspicious entities detected in this specific file yet.
            </Text>
            <Button
              title="Run AI-Assisted Scanner"
              onPress={handleReanalyze}
              variant="secondary"
              size="sm"
              icon="scan-outline"
              style={{ marginTop: Spacing.sm }}
            />
          </Card>
        ) : (
          findings.map((f) => (
            <Card key={f.id} style={{ marginBottom: Spacing.sm }}>
              <View style={styles.findingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.findingLabel}>{f.label}</Text>
                  <Text style={styles.findingVal} selectable>
                    {f.finding_value}
                  </Text>
                  {f.context_snippet ? (
                    <Text style={styles.findingSnippet} numberOfLines={2}>
                      "{f.context_snippet}"
                    </Text>
                  ) : null}
                </View>
                <Badge
                  label={
                    f.verification_status === 'verified'
                      ? 'VERIFIED'
                      : f.verification_status === 'needs_verification'
                      ? 'PENDING'
                      : 'REJECTED'
                  }
                  type={
                    f.verification_status === 'verified'
                      ? 'success'
                      : f.verification_status === 'needs_verification'
                      ? 'warning'
                      : 'danger'
                  }
                />
              </View>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.secondaryText,
    fontSize: 14,
  },
  previewCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
    minHeight: 180,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 240,
    borderRadius: BorderRadius.md,
  },
  genericFilePreview: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
  },
  previewFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  previewMeta: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginTop: 4,
  },
  hashCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
  },
  hashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  hashTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 6,
  },
  hashBox: {
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hashString: {
    ...Typography.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  hashExplanation: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 6,
    lineHeight: 16,
  },
  cardSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: Spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  metaKey: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  metaVal: {
    fontSize: 12,
    color: Colors.white,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  textHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  textBox: {
    maxHeight: 160,
    backgroundColor: Colors.inputBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textContent: {
    fontSize: 12,
    color: Colors.secondaryText,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  noFindingsText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  findingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  findingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.tealLight,
  },
  findingVal: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.white,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  findingSnippet: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

