import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  Case,
  CaseStatus,
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
  Badge,
  SectionHeader,
  EmptyState,
} from '../components';
import {
  getCaseById,
  getEvidenceByCase,
  getFindingsByCase,
  getEventsByCase,
} from '../services/database';
import {
  deleteCaseWithCloud,
  updateCaseStatusWithCloud,
} from '../services/caseService';
import { formatBytes } from '../services/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'CaseDetail'>;

const STATUS_OPTIONS: CaseStatus[] = ['active', 'closed', 'archived'];

export const CaseDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const loadCaseData = useCallback(async () => {
    setLoadError(null);
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
      if (!c) {
        setLoadError('This case could not be found on this device.');
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load this case.'
      );
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useFocusEffect(
    useCallback(() => {
      loadCaseData();
    }, [loadCaseData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCaseData();
    setRefreshing(false);
  };

  const handleStatusChange = async (nextStatus: CaseStatus) => {
    if (!caseItem || statusSaving || caseItem.status === nextStatus) return;

    setStatusSaving(true);
    try {
      const result = await updateCaseStatusWithCloud(caseId, nextStatus);
      setCaseItem(result.localCase);

      if (result.cloudSynced) {
        Alert.alert(
          'Status Updated',
          `This case is now marked ${nextStatus.toUpperCase()} and the change was saved to your account.`
        );
      } else if (result.cloudError) {
        Alert.alert(
          'Saved Locally',
          `The status was saved on this device, but the account sync failed: ${result.cloudError}`
        );
      } else {
        Alert.alert(
          'Status Updated',
          `This case is now marked ${nextStatus.toUpperCase()} on this device.`
        );
      }
    } catch (err) {
      Alert.alert(
        'Status Update Failed',
        err instanceof Error ? err.message : 'Could not update the case status.'
      );
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Incident Record',
      `Are you sure you want to delete "${caseItem?.title}"? All associated evidence metadata and timeline records will be permanently removed, and the case will also be deleted from your signed-in account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCaseWithCloud(caseId);
              navigation.goBack();
            } catch (err) {
              Alert.alert(
                'Delete Failed',
                err instanceof Error
                  ? err.message
                  : 'Could not delete this case.'
              );
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <Header title="Case Record" onBack={() => navigation.goBack()} />
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.teal} />
          <Text style={styles.loadingText}>Loading incident records...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (!caseItem) {
    return (
      <ScreenWrapper>
        <Header title="Case Record" onBack={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="alert-circle-outline"
            title="Case Not Available"
            description={loadError ?? 'This case is no longer on this device.'}
            actionTitle="Try Again"
            onAction={loadCaseData}
          />
        </View>
      </ScreenWrapper>
    );
  }

  const verifiedCount = findings.filter((f) => f.verification_status === 'verified').length;
  const pendingCount = findings.filter((f) => f.verification_status === 'needs_verification').length;

  return (
    <ScreenWrapper>
      <Header
        title={caseItem.title}
        subtitle={`${caseItem.category}`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'trash-outline',
          onPress: handleDelete,
          color: Colors.danger,
        }}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.teal}
          />
        }
      >
        {/* Demo Indicator */}
        {caseItem.is_demo ? (
          <View style={styles.demoBanner}>
            <Ionicons name="information-circle-outline" size={16} color="#FBBF24" />
            <Text style={styles.demoBannerText}>
              DEMO CASE — Synthetic data for workflow demonstration
            </Text>
          </View>
        ) : null}

        {/* Case Overview Card */}
        <Card>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.caseTitleLarge}>{caseItem.title}</Text>
              <Text style={styles.caseCategoryText}>
                {caseItem.category} • {caseItem.platform}
              </Text>
            </View>
            <Badge
              label={caseItem.severity.toUpperCase()}
              type={
                caseItem.severity === 'critical' || caseItem.severity === 'high'
                  ? 'danger'
                  : caseItem.severity === 'medium'
                  ? 'warning'
                  : 'info'
              }
            />
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Incident Date</Text>
              <Text style={styles.metaVal}>{caseItem.incident_date}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Approx Time</Text>
              <Text style={styles.metaVal}>{caseItem.incident_time || 'N/A'}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Status</Text>
              <Text style={[styles.metaVal, { color: Colors.teal }]}>
                {caseItem.status.toUpperCase()}
              </Text>
            </View>
          </View>

          {caseItem.suspect_info ? (
            <View style={styles.suspectCard}>
              <View style={styles.suspectCardHeader}>
                <Ionicons name="shield-outline" size={14} color={Colors.teal} />
                <Text style={styles.suspectLabel}>Suspected Account / Contact</Text>
              </View>
              <Text style={styles.suspectContent}>{caseItem.suspect_info}</Text>
            </View>
          ) : null}

          {caseItem.description ? (
            <View style={styles.descBox}>
              <Text style={styles.descLabel}>Incident Summary</Text>
              <Text style={styles.descText}>{caseItem.description}</Text>
            </View>
          ) : null}
        </Card>

        {/* Case Management Actions */}
        <Card style={styles.actionsCard}>
          <View style={styles.actionsHeader}>
            <Text style={styles.actionsTitle}>Case Management</Text>
            {statusSaving ? (
              <ActivityIndicator color={Colors.teal} size="small" />
            ) : null}
          </View>

          <Button
            title="Edit Case Details"
            onPress={() => navigation.navigate('CreateIncident', { caseId })}
            variant="outline"
            size="sm"
            icon="create-outline"
            disabled={statusSaving}
            style={{ marginBottom: Spacing.sm }}
          />

          <Text style={styles.statusLabel}>Update Case Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((status) => {
              const selected = caseItem.status === status;
              return (
                <TouchableOpacity
                  key={status}
                  activeOpacity={0.8}
                  disabled={statusSaving}
                  onPress={() => handleStatusChange(status)}
                  style={[
                    styles.statusPill,
                    selected && styles.statusPillSelected,
                    statusSaving && styles.statusPillDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      selected && styles.statusPillTextSelected,
                    ]}
                  >
                    {status.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Fast Action Hub */}
        <SectionHeader title="Investigation Workflow" />
        <View style={styles.workflowGrid}>
          {/* Upload Evidence */}
          <TouchableOpacity
            style={styles.workflowBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('UploadEvidence', { caseId })}
          >
            <View style={[styles.workflowIconCircle, { backgroundColor: Colors.tealMuted }]}>
              <Ionicons name="cloud-upload-outline" size={22} color={Colors.teal} />
            </View>
            <Text style={styles.workflowTitle}>Upload Evidence</Text>
            <Text style={styles.workflowCount}>
              {evidenceList.length} files preserved
            </Text>
          </TouchableOpacity>

          {/* AI Analysis & Extraction */}
          <TouchableOpacity
            style={styles.workflowBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Analysis', { caseId })}
          >
            <View style={[styles.workflowIconCircle, { backgroundColor: Colors.blueMuted }]}>
              <Ionicons name="scan-outline" size={22} color={Colors.blue} />
            </View>
            <Text style={styles.workflowTitle}>AI Extraction</Text>
            <Text style={styles.workflowCount}>
              {findings.length} entities found
            </Text>
          </TouchableOpacity>

          {/* Chronological Timeline */}
          <TouchableOpacity
            style={styles.workflowBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Timeline', { caseId })}
          >
            <View style={[styles.workflowIconCircle, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <Ionicons name="time-outline" size={22} color={Colors.info} />
            </View>
            <Text style={styles.workflowTitle}>Timeline</Text>
            <Text style={styles.workflowCount}>
              {events.length} milestones
            </Text>
          </TouchableOpacity>

          {/* Verification Triage */}
          <TouchableOpacity
            style={styles.workflowBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Verification', { caseId })}
          >
            <View style={[styles.workflowIconCircle, { backgroundColor: Colors.successMuted }]}>
              <Ionicons name="checkbox-outline" size={22} color={Colors.success} />
            </View>
            <Text style={styles.workflowTitle}>Verify Findings</Text>
            <Text style={styles.workflowCount}>
              {verifiedCount} verified • {pendingCount} pending
            </Text>
          </TouchableOpacity>
        </View>

        {/* Generate Report Banner */}
        <Card style={styles.reportBanner}>
          <View style={styles.reportLeft}>
            <Ionicons name="document-text-outline" size={28} color={Colors.teal} />
            <View style={{ marginLeft: Spacing.sm, flex: 1 }}>
              <Text style={styles.reportTitle}>Generate Incident Report</Text>
              <Text style={styles.reportSub}>
                Formal PDF export with SHA-256 chain of custody and timeline
              </Text>
            </View>
          </View>
          <Button
            title="Export Report"
            onPress={() => navigation.navigate('Report', { caseId })}
            variant="primary"
            size="sm"
            icon="download-outline"
            style={{ marginTop: Spacing.sm }}
          />
        </Card>

        {/* Preserved Evidence Section */}
        <SectionHeader
          title={`Preserved Evidence Files (${evidenceList.length})`}
          actionText="Add File"
          onAction={() => navigation.navigate('UploadEvidence', { caseId })}
        />

        {evidenceList.length === 0 ? (
          <EmptyState
            icon="document-attach-outline"
            title="No Evidence Attached Yet"
            description="Preserve original screenshots, payment slips, emails, or chat logs locally."
            actionTitle="Upload Evidence File"
            onAction={() => navigation.navigate('UploadEvidence', { caseId })}
          />
        ) : (
          evidenceList.map((ev) => (
            <Card
              key={ev.id}
              onPress={() =>
                navigation.navigate('EvidenceDetail', {
                  evidenceId: ev.id,
                  caseId,
                })
              }
            >
              <View style={styles.evRow}>
                <View style={styles.evIconBox}>
                  <Ionicons
                    name={
                      ev.file_type === 'image'
                        ? 'image-outline'
                        : ev.file_type === 'pdf'
                        ? 'document-outline'
                        : ev.file_type === 'audio'
                        ? 'musical-notes-outline'
                        : ev.file_type === 'video'
                        ? 'videocam-outline'
                        : 'document-text-outline'
                    }
                    size={22}
                    color={Colors.teal}
                  />
                </View>
                <View style={styles.evInfo}>
                  <Text style={styles.evFilename} numberOfLines={1}>
                    {ev.original_filename}
                  </Text>
                  <Text style={styles.evDetails}>
                    {ev.file_type.toUpperCase()} • {formatBytes(ev.file_size)}
                  </Text>
                  <View style={styles.hashBadge}>
                    <Text style={styles.hashLabel}>SHA-256: </Text>
                    <Text style={styles.hashValue} numberOfLines={1}>
                      {ev.sha256_hash.slice(0, 16)}...
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.teal} />
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: Colors.secondaryText,
    fontSize: 14,
    marginTop: Spacing.sm,
  },
  actionsCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.sm,
  },
  actionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  actionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondaryText,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
  },
  statusPill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: 3,
  },
  statusPillSelected: {
    backgroundColor: Colors.tealMuted,
    borderColor: Colors.teal,
  },
  statusPillDisabled: {
    opacity: 0.6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondaryText,
  },
  statusPillTextSelected: {
    color: Colors.tealLight,
  },
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#342614',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#785A1D',
    marginBottom: Spacing.md,
  },
  demoBannerText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  caseTitleLarge: {
    ...Typography.titleMedium,
  },
  caseCategoryText: {
    fontSize: 12,
    color: Colors.tealLight,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginVertical: Spacing.sm,
  },
  metaCol: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 10,
    color: Colors.secondaryText,
    textTransform: 'uppercase',
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.white,
    marginTop: 2,
  },
  suspectCard: {
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.teal,
    marginBottom: Spacing.sm,
  },
  suspectCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  suspectLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 4,
  },
  suspectContent: {
    fontSize: 12,
    color: Colors.white,
    marginTop: 2,
  },
  descBox: {
    marginTop: 4,
  },
  descLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondaryText,
    marginBottom: 2,
  },
  descText: {
    fontSize: 13,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  workflowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  workflowBtn: {
    width: '48%',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  workflowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  workflowTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  workflowCount: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  reportBanner: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
  },
  reportLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  reportSub: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  evRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  evIconBox: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.secondaryBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  evInfo: {
    flex: 1,
  },
  evFilename: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  evDetails: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  hashBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  hashLabel: {
    fontSize: 10,
    color: Colors.teal,
    fontWeight: '600',
  },
  hashValue: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: Colors.secondaryText,
    flex: 1,
  },
});

