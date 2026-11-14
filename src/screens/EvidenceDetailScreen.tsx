import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
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
  PassphrasePrompt,
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
import {
  BACKUP_STATUS_LABELS,
  backupEvidenceToCloud,
  backupStatusBadgeType,
  deleteCloudBackup,
  restoreCloudBackup,
} from '../services/backupService';
import { runEvidenceAnalysis } from '../services/analysisEngine';

type Props = NativeStackScreenProps<RootStackParamList, 'EvidenceDetail'>;

type BackupPromptAction = 'backup' | 'restore';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupPromptAction, setBackupPromptAction] =
    useState<BackupPromptAction | null>(null);
  const [backupPromptError, setBackupPromptError] = useState('');

  const loadData = useCallback(async () => {
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
  }, [evidenceId]);

  useEffect(() => {
    const init = async () => {
      await loadData();
    };
    void init();
  }, [loadData]);

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

  const openBackupPrompt = (action: BackupPromptAction) => {
    setBackupPromptError('');
    setBackupPromptAction(action);
  };

  const handleRunBackup = async (passphrase: string) => {
    if (!evidence) return;
    setBackupBusy(true);
    setBackupPromptError('');

    try {
      const outcome = await backupEvidenceToCloud(evidence.id, passphrase);
      setBackupPromptAction(null);
      await loadData();
      Alert.alert(
        'Encrypted Backup Confirmed',
        `Supabase confirmed the upload at ${new Date(
          outcome.backedUpAt
        ).toLocaleString()}.\n\nStored ciphertext: ${formatBytes(
          outcome.ciphertextBytes
        )}\nCiphertext SHA-256:\n${outcome.ciphertextSha256.slice(
          0,
          32
        )}...\n\nOnly encrypted bytes were uploaded. Your passphrase never left this device.`
      );
    } catch (err) {
      setBackupPromptError(errorMessage(err));
      await loadData();
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRunRestore = async (passphrase: string) => {
    if (!evidence?.cloud_evidence_id) {
      setBackupPromptError('This evidence item has no cloud backup to restore.');
      return;
    }

    setBackupBusy(true);
    setBackupPromptError('');

    try {
      const outcome = await restoreCloudBackup(
        evidence.cloud_evidence_id,
        passphrase
      );
      setBackupPromptAction(null);
      await loadData();
      Alert.alert(
        'Restore Verified',
        `The backup was decrypted and verified with two independent checks.\n\nEnvelope SHA-256:\n${outcome.plaintextSha256.slice(
          0,
          32
        )}...\n\nOn-disk recorded SHA-256:\n${outcome.legacySha256.slice(
          0,
          32
        )}...\n\nThe restored file is now open in your vault.`
      );
    } catch (err) {
      setBackupPromptError(errorMessage(err));
      await loadData();
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDeleteBackup = () => {
    if (!evidence?.cloud_evidence_id) return;

    Alert.alert(
      'Delete Encrypted Cloud Backup',
      'This removes the encrypted backup object from Supabase. Your local evidence file and its SHA-256 record stay on this device. This cannot be undone for the cloud copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Cloud Backup',
          style: 'destructive',
          onPress: async () => {
            setBackupBusy(true);
            try {
              await deleteCloudBackup(evidence.id);
              await loadData();
              Alert.alert(
                'Cloud Backup Deleted',
                'Supabase confirmed the encrypted object was removed. The local evidence file is unchanged.'
              );
            } catch (err) {
              Alert.alert('Delete Failed', errorMessage(err));
            } finally {
              setBackupBusy(false);
            }
          },
        },
      ]
    );
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

        {/* Optional Encrypted Cloud Backup */}
        <Card style={styles.backupCard}>
          <View style={styles.backupHeader}>
            <View style={styles.backupTitleRow}>
              <Ionicons name="cloud-upload-outline" size={18} color={Colors.teal} />
              <Text style={styles.backupTitle}>Encrypted Cloud Backup</Text>
            </View>
            <Badge
              label={BACKUP_STATUS_LABELS[evidence.backup_status ?? 'not_backed_up']}
              type={backupStatusBadgeType(
                evidence.backup_status ?? 'not_backed_up'
              )}
            />
          </View>

          <Text style={styles.backupDescription}>
            Optional and off by default. The file is encrypted on this device
            with AES-256-GCM using an Argon2id-derived key before upload. Only
            ciphertext is stored in Supabase; your passphrase and raw key never
            leave this device.
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Last successful backup:</Text>
            <Text style={styles.metaVal}>
              {evidence.backup_last_at
                ? new Date(evidence.backup_last_at).toLocaleString()
                : 'Never'}
            </Text>
          </View>

          {evidence.backup_bytes ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Encrypted size on server:</Text>
              <Text style={styles.metaVal}>
                {formatBytes(evidence.backup_bytes)}
              </Text>
            </View>
          ) : null}

          {evidence.backup_storage_path ? (
            <Text style={styles.backupPath} numberOfLines={1} selectable>
              {evidence.backup_storage_path}
            </Text>
          ) : null}

          {evidence.backup_error ? (
            <View style={styles.backupErrorBox}>
              <Ionicons name="alert-circle" size={15} color={Colors.danger} />
              <Text style={styles.backupErrorText}>{evidence.backup_error}</Text>
            </View>
          ) : null}

          <Button
            title={
              evidence.backup_status === 'backed_up'
                ? 'Back Up Again'
                : 'Back Up Now'
            }
            onPress={() => openBackupPrompt('backup')}
            loading={backupBusy && backupPromptAction === null}
            disabled={backupBusy}
            variant="primary"
            icon="cloud-upload-outline"
            style={{ marginTop: Spacing.sm }}
          />

          {evidence.cloud_evidence_id &&
          (evidence.backup_status === 'backed_up' || evidence.backup_last_at) ? (
            <Button
              title="Restore From Cloud"
              onPress={() => openBackupPrompt('restore')}
              disabled={backupBusy}
              variant="outline"
              icon="cloud-download-outline"
              style={{ marginTop: Spacing.sm }}
            />
          ) : null}

          {evidence.cloud_evidence_id &&
          evidence.backup_status === 'backed_up' ? (
            <Button
              title="Delete Cloud Backup"
              onPress={handleDeleteBackup}
              disabled={backupBusy}
              variant="danger"
              icon="cloud-offline-outline"
              style={{ marginTop: Spacing.sm }}
            />
          ) : null}

          <Text style={styles.backupRecoveryNote}>
            Recovery key: your vault passphrase is also the key that unlocks
            these backups. It is never stored or sent to Supabase. If you lose
            it, encrypted cloud backups cannot be restored.
          </Text>
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
                      &quot;{f.context_snippet}&quot;
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

      <PassphrasePrompt
        visible={backupPromptAction !== null}
        title={
          backupPromptAction === 'restore'
            ? 'Restore Encrypted Backup'
            : 'Encrypt & Upload Backup'
        }
        message={
          backupPromptAction === 'restore'
            ? 'Enter the vault passphrase that was used when this backup was encrypted. It is used only on this device to derive the decryption key.'
            : 'Enter your vault passphrase. It is checked against your vault and used locally to derive the AES-256-GCM key before anything is uploaded.'
        }
        confirmLabel={backupPromptAction === 'restore' ? 'Decrypt & Restore' : 'Encrypt & Upload'}
        loading={backupBusy}
        error={backupPromptError}
        onCancel={() => {
          if (backupBusy) return;
          setBackupPromptAction(null);
          setBackupPromptError('');
        }}
        onSubmit={(passphrase) => {
          if (backupPromptAction === 'backup') {
            void handleRunBackup(passphrase);
          } else if (backupPromptAction === 'restore') {
            void handleRunRestore(passphrase);
          }
        }}
      />
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
  backupCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
  },
  backupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  backupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.sm,
  },
  backupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 6,
  },
  backupDescription: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },
  backupPath: {
    ...Typography.mono,
    fontSize: 10,
    color: Colors.secondaryText,
    marginTop: 6,
  },
  backupErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.dangerMuted,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  },
  backupErrorText: {
    flex: 1,
    color: Colors.danger,
    fontSize: 11,
    lineHeight: 15,
    marginLeft: 6,
  },
  backupRecoveryNote: {
    fontSize: 10.5,
    color: Colors.secondaryText,
    lineHeight: 15,
    marginTop: Spacing.sm,
    fontStyle: 'italic',
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

