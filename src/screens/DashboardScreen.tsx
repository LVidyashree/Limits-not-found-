import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case, ActivityLog, CaseStatistics } from '../types';
import { Colors, Spacing, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Badge,
  SectionHeader,
  EmptyState,
} from '../components';
import {
  getAllCases,
  getDashboardStats,
  getRecentActivity,
} from '../services/database';
import { lockVault } from '../services/security';
import { syncCloudCasesIntoLocal } from '../services/caseService';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const [stats, setStats] = useState<CaseStatistics>({
    totalCases: 0,
    totalEvidence: 0,
    verifiedFindings: 0,
    pendingFindings: 0,
    totalTimelineEvents: 0,
  });
  const [recentCases, setRecentCases] = useState<Case[]>([]);
  const [recentLogs, setRecentLogs] = useState<ActivityLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const loadDashboardData = async () => {
    if (firstLoad.current) setLoading(true);
    setLoadError(null);
    setCloudError(null);

    try {
      // Paint local rows immediately, then merge cloud-only cases.
      const localCases = await getAllCases();
      setRecentCases(localCases.slice(0, 4));

      const [statsData, logsData] = await Promise.all([
        getDashboardStats(),
        getRecentActivity(6),
      ]);
      setStats(statsData);
      setRecentLogs(logsData);

      firstLoad.current = false;
      setLoading(false);

      const sync = await syncCloudCasesIntoLocal(localCases);
      if (sync.cloudError) {
        setCloudError(sync.cloudError);
      }

      if (sync.imported > 0) {
        const [mergedCases, mergedStats] = await Promise.all([
          getAllCases(),
          getDashboardStats(),
        ]);
        setRecentCases(mergedCases.slice(0, 4));
        setStats(mergedStats);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not load your cases.'
      );
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const handleLockVault = async () => {
    Alert.alert('Lock Vault', 'Are you sure you want to lock your evidence vault?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Lock Now',
        style: 'destructive',
        onPress: async () => {
          await lockVault();
          navigation.replace('WelcomeVault');
        },
      },
    ]);
  };

  return (
    <ScreenWrapper>
      <Header
        title="EvidenceVault"
        subtitle="Offline Secure Custody"
        showBranding
        rightAction={{
          icon: 'lock-closed-outline',
          onPress: handleLockVault,
          color: Colors.white,
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
        {/* Vault Status Indicator Banner */}
        <View style={styles.statusBanner}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            VAULT ACTIVE • 100% OFFLINE • AIRPLANE MODE READY
          </Text>
        </View>

        {loading ? (
          <View style={styles.loadingBanner}>
            <ActivityIndicator color={Colors.teal} size="small" />
            <Text style={styles.loadingText}>Loading your cases...</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        {cloudError ? (
          <View style={styles.warningBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={Colors.warning} />
            <Text style={styles.warningText}>
              Case sync failed. Showing cases saved on this device. {cloudError}
            </Text>
          </View>
        ) : null}

        {/* High-Level Forensic Metric Cards */}
        <View style={styles.metricsGrid}>
          <Card style={styles.metricCard}>
            <View style={styles.metricIconBox}>
              <Ionicons name="folder-open-outline" size={20} color={Colors.teal} />
            </View>
            <Text style={styles.metricValue}>{stats.totalCases}</Text>
            <Text style={styles.metricLabel}>Total Cases</Text>
          </Card>

          <Card style={styles.metricCard}>
            <View style={styles.metricIconBox}>
              <Ionicons name="document-lock-outline" size={20} color={Colors.teal} />
            </View>
            <Text style={styles.metricValue}>{stats.totalEvidence}</Text>
            <Text style={styles.metricLabel}>Evidence Files</Text>
          </Card>

          <Card style={styles.metricCard}>
            <View style={styles.metricIconBox}>
              <Ionicons name="checkmark-done-circle-outline" size={20} color={Colors.success} />
            </View>
            <Text style={styles.metricValue}>{stats.verifiedFindings}</Text>
            <Text style={styles.metricLabel}>Verified Entities</Text>
          </Card>

          <Card style={styles.metricCard}>
            <View style={styles.metricIconBox}>
              <Ionicons name="time-outline" size={20} color={Colors.blue} />
            </View>
            <Text style={styles.metricValue}>{stats.totalTimelineEvents}</Text>
            <Text style={styles.metricLabel}>Timeline Events</Text>
          </Card>
        </View>

        {/* Fast Action Grid */}
        <SectionHeader title="Core Operations" />
        <View style={styles.actionGrid}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: Colors.card }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CreateIncident', {})}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: Colors.tealMuted }]}>
              <Ionicons name="add-circle" size={24} color={Colors.teal} />
            </View>
            <Text style={styles.actionTitle}>Report Incident</Text>
            <Text style={styles.actionSubtitle}>Open a new digital case</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: Colors.card }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CaseList')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: Colors.blueMuted }]}>
              <Ionicons name="briefcase-outline" size={24} color={Colors.blue} />
            </View>
            <Text style={styles.actionTitle}>My Cases</Text>
            <Text style={styles.actionSubtitle}>Browse active records</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: Colors.card }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('TrustCentre')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <Ionicons name="shield-checkmark-outline" size={24} color={Colors.info} />
            </View>
            <Text style={styles.actionTitle}>Trust Centre</Text>
            <Text style={styles.actionSubtitle}>Integrity & storage audit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: Colors.card }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('TrustCentre')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: Colors.successMuted }]}>
              <Ionicons name="cloud-upload-outline" size={24} color={Colors.success} />
            </View>
            <Text style={styles.actionTitle}>Cloud Backup</Text>
            <Text style={styles.actionSubtitle}>Encrypted restore point</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Cases Section */}
        <SectionHeader
          title="Recent Incidents"
          actionText={recentCases.length > 0 ? 'View All' : undefined}
          onAction={() => navigation.navigate('CaseList')}
        />

        {!loading && recentCases.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No Incidents Logged Yet"
            description="Start preserving digital screenshots, messages, and transaction records securely."
            actionTitle="Report Your First Incident"
            onAction={() => navigation.navigate('CreateIncident', {})}
          />
        ) : (
          recentCases.map((caseItem) => (
            <Card
              key={caseItem.id}
              onPress={() => navigation.navigate('CaseDetail', { caseId: caseItem.id })}
              variant={caseItem.is_demo ? 'highlight' : 'normal'}
            >
              <View style={styles.caseCardHeader}>
                <View style={{ flex: 1, marginRight: Spacing.sm }}>
                  <Text style={styles.caseTitle} numberOfLines={1}>
                    {caseItem.title}
                  </Text>
                  <Text style={styles.caseMeta}>
                    {caseItem.category} • {caseItem.platform}
                  </Text>
                </View>
                {caseItem.is_demo ? (
                  <Badge label="DEMO" type="demo" />
                ) : (
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
                )}
              </View>

              <Text style={styles.caseDesc} numberOfLines={2}>
                {caseItem.description || 'No description provided.'}
              </Text>

              <View style={styles.caseFooter}>
                <View style={styles.caseFooterLeft}>
                  <Ionicons name="calendar-outline" size={13} color={Colors.secondaryText} />
                  <Text style={styles.caseDate}>{caseItem.incident_date}</Text>
                </View>
                <View style={styles.caseArrow}>
                  <Text style={styles.caseOpenText}>Open Case</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.teal} />
                </View>
              </View>
            </Card>
          ))
        )}

        {/* Audit Activity Log */}
        <SectionHeader
          title="Recent Vault Activity"
          actionText="Full Audit"
          onAction={() => navigation.navigate('TrustCentre')}
        />

        <Card style={styles.activityCard}>
          {recentLogs.length === 0 ? (
            <Text style={styles.emptyLogText}>No activities recorded yet.</Text>
          ) : (
            recentLogs.map((log, index) => (
              <View
                key={log.id}
                style={[
                  styles.logRow,
                  index < recentLogs.length - 1 && styles.logBorder,
                ]}
              >
                <View style={styles.logIconCol}>
                  <Ionicons
                    name={
                      log.action_type.includes('evidence')
                        ? 'document-attach-outline'
                        : log.action_type.includes('finding')
                        ? 'checkbox-outline'
                        : log.action_type.includes('vault')
                        ? 'key-outline'
                        : 'shield-outline'
                    }
                    size={16}
                    color={Colors.teal}
                  />
                </View>
                <View style={styles.logTextCol}>
                  <Text style={styles.logDesc}>{log.description}</Text>
                  <Text style={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    • {new Date(log.timestamp).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.secondaryBackground,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderTeal,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
    marginRight: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.tealLight,
    letterSpacing: 0.8,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.secondaryBackground,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingText: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.dangerMuted,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.danger,
    marginLeft: 8,
    lineHeight: 17,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.warningMuted,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: Colors.warning,
    marginLeft: 8,
    lineHeight: 17,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  metricCard: {
    width: '48%',
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  metricIconBox: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.secondaryBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.white,
  },
  metricLabel: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  actionButton: {
    width: '48%',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  actionSubtitle: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
  },
  caseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  caseTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
  },
  caseMeta: {
    fontSize: 12,
    color: Colors.tealLight,
    marginTop: 2,
  },
  caseDesc: {
    fontSize: 13,
    color: Colors.secondaryText,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  caseFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  caseFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  caseDate: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 4,
  },
  caseArrow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  caseOpenText: {
    fontSize: 12,
    color: Colors.teal,
    fontWeight: '600',
    marginRight: 2,
  },
  activityCard: {
    padding: 0,
    overflow: 'hidden',
  },
  emptyLogText: {
    padding: Spacing.md,
    color: Colors.secondaryText,
    fontSize: 13,
    textAlign: 'center',
  },
  logRow: {
    flexDirection: 'row',
    padding: Spacing.md,
  },
  logBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  logIconCol: {
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  logTextCol: {
    flex: 1,
  },
  logDesc: {
    fontSize: 13,
    color: Colors.white,
    lineHeight: 18,
  },
  logTime: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 4,
  },
});

