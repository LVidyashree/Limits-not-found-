import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ActivityLog } from '../types';
import { Colors, Spacing, BorderRadius } from '../theme';
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
  getAllEvidence,
  getRecentActivity,
  exportAllDatabaseJson,
  wipeAllDatabaseData,
} from '../services/database';
import {
  getStorageUsage,
  formatBytes,
  verifyFileIntegrity,
  wipeAllVaultFiles,
} from '../services/storage';
import {
  isBiometricsEnabled,
  setBiometricsEnabled,
  isBiometricsSupported,
  resetVaultSecurity,
} from '../services/security';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage } from '../services/authServiceCore';
import {
  BACKUP_STATUS_LABELS,
  CloudBackupRecord,
  backupStatusBadgeType,
  listCloudBackups,
  restoreCloudBackup,
} from '../services/backupService';
import {
  disableAutoBackup,
  enableAutoBackupWithConsent,
  getAutoBackupConsentAt,
  isAutoBackupEnabled,
} from '../services/backupPreferences';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Props = NativeStackScreenProps<RootStackParamList, 'TrustCentre'>;

export const TrustCentreScreen: React.FC<Props> = ({ navigation }) => {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [storageInfo, setStorageInfo] = useState({
    evidenceFilesCount: 0,
    evidenceBytes: 0,
    dbBytes: 0,
    totalVaultBytes: 0,
  });
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsActive, setBiometricsActive] = useState(false);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [auditing, setAuditing] = useState(false);
  const [auditStats, setAuditStats] = useState<{
    totalChecked: number;
    passed: number;
    failed: number;
  } | null>(null);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupConsentAt, setAutoBackupConsentAt] = useState<string | null>(
    null
  );
  const [autoBackupBusy, setAutoBackupBusy] = useState(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupRecord[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<CloudBackupRecord | null>(
    null
  );
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const refreshCloudBackups = async (): Promise<void> => {
    setCloudLoading(true);
    setCloudError('');
    try {
      setCloudBackups(await listCloudBackups());
    } catch (err) {
      setCloudError(errorMessage(err));
    } finally {
      setCloudLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadTrustData = async () => {
      try {
        const [storage, bioSupp, bioEn, actLogs, autoEnabled, consentAt] =
          await Promise.all([
            getStorageUsage(),
            isBiometricsSupported(),
            isBiometricsEnabled(),
            getRecentActivity(25),
            isAutoBackupEnabled(),
            getAutoBackupConsentAt(),
          ]);
        if (!active) return;
        setStorageInfo(storage);
        setBiometricsAvailable(bioSupp);
        setBiometricsActive(bioEn);
        setLogs(actLogs);
        setAutoBackupEnabled(autoEnabled);
        setAutoBackupConsentAt(consentAt);
      } catch (err) {
        console.error('Failed to load trust centre data:', err);
      }
    };

    loadTrustData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;

    let active = true;
    const loadCloud = async () => {
      setCloudLoading(true);
      setCloudError('');

      try {
        const rows = await listCloudBackups();
        if (active) setCloudBackups(rows);
      } catch (err) {
        if (active) setCloudError(errorMessage(err));
      } finally {
        if (active) setCloudLoading(false);
      }
    };

    void loadCloud();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleToggleBiometrics = async () => {
    const next = !biometricsActive;
    await setBiometricsEnabled(next);
    setBiometricsActive(next);
  };

  const handleToggleAutoBackup = () => {
    if (autoBackupBusy) return;

    if (autoBackupEnabled) {
      Alert.alert(
        'Disable Automatic Cloud Backup?',
        'New evidence will stay on this device only. Existing encrypted backups are not deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable Auto-Backup',
            style: 'destructive',
            onPress: async () => {
              setAutoBackupBusy(true);
              try {
                await disableAutoBackup();
                setAutoBackupEnabled(false);
              } catch (err) {
                Alert.alert('Setting Error', errorMessage(err));
              } finally {
                setAutoBackupBusy(false);
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Enable Automatic Encrypted Backup?',
      'This is optional and requires your explicit consent.\n\nAfter you add evidence, the app can encrypt it on this device with AES-256-GCM and upload only the ciphertext to your private Supabase bucket. Your vault passphrase and raw encryption key are never stored or sent to Supabase.\n\nAuto-backup only runs while a derived key is already cached in memory (for example after a manual backup or restore in this app session). It never prompts for your passphrase in the background.\n\nSupabase will still see non-content metadata such as file size, case ID and backup timestamps.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I Understand & Enable',
          onPress: async () => {
            setAutoBackupBusy(true);
            try {
              const result = await enableAutoBackupWithConsent();
              setAutoBackupEnabled(true);
              setAutoBackupConsentAt(result.consentAt);
            } catch (err) {
              Alert.alert('Setting Error', errorMessage(err));
            } finally {
              setAutoBackupBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleRestoreBackup = async (passphrase: string) => {
    if (!restoreTarget) return;

    setRestoreBusy(true);
    setRestoreError('');

    try {
      const outcome = await restoreCloudBackup(
        restoreTarget.cloudEvidenceId,
        passphrase
      );
      setRestoreTarget(null);
      await refreshCloudBackups();
      Alert.alert(
        'Restore Verified',
        `The encrypted backup was downloaded, decrypted and checked twice.\n\nEnvelope SHA-256:\n${outcome.plaintextSha256.slice(
          0,
          32
        )}...\n\nRecorded file SHA-256:\n${outcome.legacySha256.slice(0, 32)}...`,
        [
          {
            text: 'View Restored Evidence',
            onPress: () =>
              navigation.navigate('EvidenceDetail', {
                evidenceId: outcome.localEvidenceId,
                caseId: outcome.localCaseId,
              }),
          },
          { text: 'Close' },
        ]
      );
    } catch (err) {
      setRestoreError(errorMessage(err));
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out of Account',
      'Your local evidence and vault passphrase stay on this device. You will need to sign in again to open the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await signOut();
            } catch (err) {
              Alert.alert('Sign Out Error', getAuthErrorMessage(err));
            } finally {
              setSigningOut(false);
            }
          },
        },
      ]
    );
  };

  const handleRunIntegrityAudit = async () => {
    setAuditing(true);
    try {
      const allEv = await getAllEvidence();
      if (allEv.length === 0) {
        Alert.alert('No Evidence', 'There are no evidence files in the vault to audit.');
        setAuditing(false);
        return;
      }

      let passed = 0;
      let failed = 0;

      for (const ev of allEv) {
        const res = await verifyFileIntegrity(ev.file_path, ev.sha256_hash);
        if (res.isValid) {
          passed++;
        } else {
          failed++;
        }
      }

      setAuditStats({
        totalChecked: allEv.length,
        passed,
        failed,
      });

      if (failed === 0) {
        Alert.alert(
          'Integrity Audit Passed (100%)',
          `Checked ${allEv.length} evidence files on local storage. All SHA-256 hashes match bit-for-bit with the records in the database. Zero tampering detected.`
        );
      } else {
        Alert.alert(
          'Integrity Alert!',
          `${failed} file(s) failed verification! Check your device storage.`
        );
      }
    } catch (err) {
      Alert.alert('Audit Error', String(err));
    } finally {
      setAuditing(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const jsonBackup = await exportAllDatabaseJson();
      await Share.share({
        title: 'EvidenceVault JSON Backup',
        message: jsonBackup,
      });
    } catch (err) {
      Alert.alert('Export Error', String(err));
    }
  };

  const handleEmergencyWipe = () => {
    Alert.alert(
      '⚠️ EMERGENCY VAULT WIPE',
      'This will permanently delete ALL local cases, evidence files, hashes, timeline events, your master passphrase credentials, and your auto-backup setting. This cannot be undone!\n\nEncrypted cloud backups are NOT deleted by this action and may remain in Supabase. Delete them from each evidence item first if you want them removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Proceed to Confirm',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'Are you absolutely sure you want to purge all local data from this device? Encrypted cloud backups will remain in Supabase unless you delete them separately.',
              [
                { text: 'Abort', style: 'cancel' },
                {
                  text: 'Wipe Everything Now',
                  style: 'destructive',
                  onPress: async () => {
                    await wipeAllVaultFiles();
                    await wipeAllDatabaseData();
                    await resetVaultSecurity();
                    Alert.alert(
                      'Vault Purged',
                      'All local evidence files and database records have been deleted.',
                      [
                        {
                          text: 'OK',
                          onPress: () => navigation.replace('WelcomeVault'),
                        },
                      ]
                    );
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <ScreenWrapper>
      <Header
        title="Trust Centre"
        subtitle="Security, Integrity & Audit"
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Security Status Card */}
        <Card style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusIconCircle}>
              <Ionicons name="shield-checkmark" size={26} color={Colors.teal} />
            </View>
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <Text style={styles.statusTitle}>Local Vault Active</Text>
              <Text style={styles.statusSubtitle}>
                Salted SHA-256 Passphrase Hash • Local Evidence • Optional
                Encrypted Cloud Backup
              </Text>
            </View>
            <Badge label="LOCAL FIRST" type="success" />
          </View>

          <View style={styles.securityCheckList}>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                No plaintext passwords or vault passphrases stored anywhere on device
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Original files copied into an isolated local sandbox unchanged
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Evidence stays local by default; cloud backups are optional and
                encrypted on this device before upload
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Vault passphrase is separate from your account password and never sent to Supabase
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Cloud backup objects are private and scoped to your user ID and case ID by Storage RLS
              </Text>
            </View>
          </View>

          {biometricsAvailable && (
            <View style={styles.bioRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bioLabel}>Biometric Unlock</Text>
                <Text style={styles.bioSub}>Face ID / Fingerprint fast login</Text>
              </View>
              <Button
                title={biometricsActive ? 'Enabled' : 'Disabled'}
                onPress={handleToggleBiometrics}
                variant={biometricsActive ? 'primary' : 'outline'}
                size="sm"
              />
            </View>
          )}
        </Card>

        {/* Account & Session */}
        <SectionHeader title="Account & Session" />
        <Card style={styles.accountCard}>
          <View style={styles.accountRow}>
            <View style={styles.accountIcon}>
              <Ionicons name="person-circle-outline" size={22} color={Colors.teal} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountLabel}>SUPABASE AUTH</Text>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {user?.email ?? 'Authenticated account'}
              </Text>
            </View>
            <Badge
              label={user?.emailConfirmed ? 'VERIFIED' : 'PENDING'}
              type={user?.emailConfirmed ? 'success' : 'warning'}
            />
          </View>
          <Text style={styles.accountNote}>
            Supabase stores your account identity and, only if you opt in,
            encrypted backup metadata and ciphertext. It never receives your
            vault passphrase, raw encryption key or plaintext evidence.
            Signing out locks the local vault but keeps your local evidence
            intact.
          </Text>
          <Button
            title="Sign Out of Account"
            onPress={handleSignOut}
            loading={signingOut}
            variant="danger"
            icon="log-out-outline"
          />
        </Card>

        {/* Encrypted Cloud Backup */}
        <SectionHeader
          title="Encrypted Cloud Backup"
          actionText={cloudLoading ? 'Refreshing...' : 'Refresh'}
          onAction={() => {
            if (!cloudLoading) void refreshCloudBackups();
          }}
        />
        <Card style={styles.backupCard}>
          <View style={styles.autoBackupRow}>
            <View style={styles.autoBackupText}>
              <Text style={styles.autoBackupTitle}>
                Automatic Encrypted Backup
              </Text>
              <Text style={styles.autoBackupSub}>
                Optional. Off by default. Requires explicit consent and runs
                only while a derived key is cached in memory.
              </Text>
            </View>
            <Switch
              value={autoBackupEnabled}
              onValueChange={handleToggleAutoBackup}
              disabled={autoBackupBusy}
              trackColor={{ false: Colors.border, true: Colors.teal }}
              thumbColor={Colors.white}
            />
          </View>

          {autoBackupConsentAt ? (
            <Text style={styles.consentNote}>
              Consent recorded {new Date(autoBackupConsentAt).toLocaleString()}.
              You can disable automatic backups at any time.
            </Text>
          ) : null}

          <Text style={styles.backupInfo}>
            Each backup is sealed on this device with AES-256-GCM using a unique
            nonce and an Argon2id-derived key. Only the encrypted envelope is
            uploaded. Supabase Storage RLS restricts every object to the
            signed-in user and one of their own cases.
          </Text>

          {cloudError ? (
            <View style={styles.cloudErrorBox}>
              <Ionicons name="alert-circle" size={15} color={Colors.danger} />
              <Text style={styles.cloudErrorText}>{cloudError}</Text>
            </View>
          ) : null}

          {cloudLoading ? (
            <View style={styles.cloudLoadingRow}>
              <ActivityIndicator color={Colors.teal} size="small" />
              <Text style={styles.cloudLoadingText}>
                Loading encrypted backups...
              </Text>
            </View>
          ) : cloudBackups.length === 0 ? (
            <Text style={styles.cloudEmptyText}>
              No encrypted cloud backups yet. Open an evidence item and tap
              &quot;Back Up Now&quot; to create one.
            </Text>
          ) : (
            cloudBackups.map((backup) => (
              <View key={backup.cloudEvidenceId} style={styles.cloudRow}>
                <View style={styles.cloudRowMain}>
                  <Text style={styles.cloudFilename} numberOfLines={1}>
                    {backup.originalFilename}
                  </Text>
                  <Text style={styles.cloudMeta} numberOfLines={1}>
                    {backup.caseTitle} • {formatBytes(backup.plaintextBytes)}
                  </Text>
                  <Text style={styles.cloudMeta}>
                    Last success:{' '}
                    {backup.lastSuccessAt
                      ? new Date(backup.lastSuccessAt).toLocaleString()
                      : 'Never'}
                  </Text>
                  {backup.error ? (
                    <Text style={styles.cloudRowError} numberOfLines={2}>
                      {backup.error}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.cloudRowActions}>
                  <Badge
                    label={BACKUP_STATUS_LABELS[backup.status]}
                    type={backupStatusBadgeType(backup.status)}
                  />
                  {backup.lastSuccessAt || backup.status === 'backed_up' ? (
                    <Button
                      title="Restore"
                      onPress={() => {
                        setRestoreError('');
                        setRestoreTarget(backup);
                      }}
                      variant="outline"
                      size="sm"
                      icon="cloud-download-outline"
                      style={{ marginTop: Spacing.sm }}
                    />
                  ) : null}
                </View>
              </View>
            ))
          )}
        </Card>

        {/* Local Storage Metrics Card */}
        <SectionHeader title="Physical Storage Breakdown" />
        <Card>
          <View style={styles.storageGrid}>
            <View style={styles.storageItem}>
              <Text style={styles.storageVal}>
                {storageInfo.evidenceFilesCount}
              </Text>
              <Text style={styles.storageKey}>Evidence Files</Text>
            </View>
            <View style={styles.storageItem}>
              <Text style={styles.storageVal}>
                {formatBytes(storageInfo.evidenceBytes)}
              </Text>
              <Text style={styles.storageKey}>Evidence Size</Text>
            </View>
            <View style={styles.storageItem}>
              <Text style={styles.storageVal}>
                {formatBytes(storageInfo.dbBytes)}
              </Text>
              <Text style={styles.storageKey}>Database Size</Text>
            </View>
            <View style={styles.storageItem}>
              <Text style={[styles.storageVal, { color: Colors.teal }]}>
                {formatBytes(storageInfo.totalVaultBytes)}
              </Text>
              <Text style={styles.storageKey}>Total Vault</Text>
            </View>
          </View>
        </Card>

        {/* Integrity Auditor Card */}
        <SectionHeader title="Cryptographic Integrity Audit" />
        <Card style={styles.auditCard}>
          <Text style={styles.auditTitle}>On-Disk Hash Verification Tool</Text>
          <Text style={styles.auditDesc}>
            Read every evidence file from the device storage right now,
            recalculate its SHA-256 hash, and verify match against the recorded database digest.
          </Text>

          {auditStats && (
            <View style={styles.auditResultBox}>
              <Text style={styles.auditResultText}>
                Last Audit: {auditStats.passed} of {auditStats.totalChecked} files passed
                ({auditStats.failed === 0 ? '100% Intact' : `${auditStats.failed} corrupted`})
              </Text>
            </View>
          )}

          <Button
            title={auditing ? 'Auditing Checksums...' : 'Audit All Evidence Files Now'}
            onPress={handleRunIntegrityAudit}
            loading={auditing}
            variant="primary"
            icon="shield-outline"
            style={{ marginTop: Spacing.sm }}
          />
        </Card>

        {/* Security Principles & Limitations */}
        <SectionHeader title="Forensic Integrity Principles" />
        <Card>
          <Text style={styles.principleHeader}>What SHA-256 Hashing Proves:</Text>
          <Text style={styles.principleItem}>
            ✓ Proves the exact file has remained byte-for-byte unchanged since the moment you imported it into EvidenceVault.
          </Text>
          <Text style={styles.principleItem}>
            ✓ Detects any tampering, bit corruption, or alteration by unauthorized parties.
          </Text>

          <Text style={[styles.principleHeader, { marginTop: 12 }]}>
            What Hashing Does NOT Prove:
          </Text>
          <Text style={styles.principleItem}>
            ✕ It does not prove that a screenshot was authentic before you took it.
          </Text>
          <Text style={styles.principleItem}>
            ✕ AI does not determine guilt or replace legal discovery.
          </Text>
        </Card>

        {/* Complete Activity History */}
        <SectionHeader title="Audit Activity Log" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {logs.map((log, idx) => (
            <View
              key={log.id}
              style={[
                styles.logRow,
                idx < logs.length - 1 && styles.logBorder,
              ]}
            >
              <View style={styles.logIcon}>
                <Ionicons name="shield-outline" size={14} color={Colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.logDescription}>{log.description}</Text>
                <Text style={styles.logTimestamp}>
                  {new Date(log.timestamp).toLocaleString()} • Action: {log.action_type}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Data Export & Emergency Reset */}
        <SectionHeader title="Data Custody & Wipe Actions" />
        <View style={styles.dangerRow}>
          <Button
            title="Export Vault Backup (JSON)"
            onPress={handleExportBackup}
            variant="outline"
            icon="download-outline"
            style={{ marginBottom: Spacing.sm }}
          />

          <Button
            title="Emergency Vault Wipe (Delete All)"
            onPress={handleEmergencyWipe}
            variant="danger"
            icon="trash-outline"
          />
        </View>
      </ScrollView>

      <PassphrasePrompt
        visible={restoreTarget !== null}
        title="Restore Encrypted Backup"
        message={
          restoreTarget
            ? `Enter the vault passphrase used to encrypt "${restoreTarget.originalFilename}". It is used only on this device to derive the decryption key.`
            : ''
        }
        confirmLabel="Decrypt & Restore"
        loading={restoreBusy}
        error={restoreError}
        onCancel={() => {
          if (restoreBusy) return;
          setRestoreTarget(null);
          setRestoreError('');
        }}
        onSubmit={(passphrase) => {
          void handleRestoreBackup(passphrase);
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
  statusCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statusIconCircle: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.teal,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
  statusSubtitle: {
    fontSize: 11,
    color: Colors.tealLight,
    marginTop: 2,
  },
  securityCheckList: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  checkText: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 6,
  },
  bioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 6,
  },
  bioLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  bioSub: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  accountCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  accountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.teal,
    letterSpacing: 1,
  },
  accountEmail: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginTop: 2,
  },
  accountNote: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },
  backupCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
  },
  autoBackupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  autoBackupText: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  autoBackupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  autoBackupSub: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginTop: 2,
  },
  consentNote: {
    fontSize: 10.5,
    color: Colors.tealLight,
    marginTop: 6,
  },
  backupInfo: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cloudErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.dangerMuted,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cloudErrorText: {
    flex: 1,
    color: Colors.danger,
    fontSize: 11,
    lineHeight: 15,
    marginLeft: 6,
  },
  cloudLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  cloudLoadingText: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 8,
  },
  cloudEmptyText: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginTop: Spacing.md,
    fontStyle: 'italic',
  },
  cloudRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
  },
  cloudRowMain: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  cloudFilename: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.white,
  },
  cloudMeta: {
    fontSize: 10.5,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  cloudRowError: {
    fontSize: 10,
    color: Colors.danger,
    marginTop: 4,
  },
  cloudRowActions: {
    alignItems: 'flex-end',
  },
  storageGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  storageItem: {
    width: '48%',
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: 8,
    alignItems: 'center',
  },
  storageVal: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
  storageKey: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  auditCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.teal,
    marginBottom: Spacing.md,
  },
  auditTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 4,
  },
  auditDesc: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  auditResultBox: {
    backgroundColor: Colors.card,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginVertical: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
  },
  auditResultText: {
    fontSize: 12,
    color: Colors.white,
    fontWeight: '600',
  },
  principleHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.tealLight,
    marginBottom: 4,
  },
  principleItem: {
    fontSize: 11.5,
    color: Colors.secondaryText,
    lineHeight: 17,
    marginVertical: 2,
  },
  logRow: {
    flexDirection: 'row',
    padding: Spacing.sm,
  },
  logBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  logIcon: {
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  logDescription: {
    fontSize: 12,
    color: Colors.white,
    lineHeight: 16,
  },
  logTimestamp: {
    fontSize: 10,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  dangerRow: {
    marginBottom: Spacing.lg,
  },
});

