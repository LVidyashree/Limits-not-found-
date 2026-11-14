import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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
  Badge,
  SectionHeader,
  EmptyState,
} from '../components';
import {
  getCaseById,
  getEvidenceByCase,
  getFindingsByCase,
  getEventsByCase,
  deleteCase,
} from '../services/database';
import { formatBytes } from '../services/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'CaseDetail'>;

export const CaseDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadCaseData = async () => {
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
      console.error('Failed to load case detail:', err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadCaseData();
    }, [caseId])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCaseData();
    setRefreshing(false);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Incident Record',
      `Are you sure you want to delete "${caseItem?.title}"? All associated evidence metadata and timeline records will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            await deleteCase(caseId);
            navigation.goBack();
          },
        },
      ]
    );
  };

  if (!caseItem) {
    return (
      <ScreenWrapper>
        <Header title="Case Record" onBack={() => navigation.goBack()} />
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Loading incident records...</Text>
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
  loadingText: {
    color: Colors.secondaryText,
    fontSize: 14,
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

