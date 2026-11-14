import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ActivityLog } from '../types';
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

type Props = NativeStackScreenProps<RootStackParamList, 'TrustCentre'>;

export const TrustCentreScreen: React.FC<Props> = ({ navigation }) => {
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

  useEffect(() => {
    loadTrustData();
  }, []);

  const loadTrustData = async () => {
    try {
      const [storage, bioSupp, bioEn, actLogs] = await Promise.all([
        getStorageUsage(),
        isBiometricsSupported(),
        isBiometricsEnabled(),
        getRecentActivity(25),
      ]);
      setStorageInfo(storage);
      setBiometricsAvailable(bioSupp);
      setBiometricsActive(bioEn);
      setLogs(actLogs);
    } catch (err) {
      console.error('Failed to load trust centre data:', err);
    }
  };

  const handleToggleBiometrics = async () => {
    const next = !biometricsActive;
    await setBiometricsEnabled(next);
    setBiometricsActive(next);
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
      'This will permanently delete ALL cases, evidence files, hashes, timeline events, and your master passphrase credentials. This cannot be undone!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Proceed to Confirm',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'Are you absolutely sure you want to purge all data from this device?',
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
              <Text style={styles.statusTitle}>Vault Protected</Text>
              <Text style={styles.statusSubtitle}>
                Salted SHA-256 Passphrase Sealed • SQLite Encrypted
              </Text>
            </View>
            <Badge label="OFFLINE" type="success" />
          </View>

          <View style={styles.securityCheckList}>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                No plaintext passphrases saved anywhere on device
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Original files copied into isolated local sandbox unchanged
              </Text>
            </View>
            <View style={styles.checkItem}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.checkText}>
                Zero network calls: works seamlessly in Airplane Mode
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
            Read every evidence file from the phone's physical flash storage right now,
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

