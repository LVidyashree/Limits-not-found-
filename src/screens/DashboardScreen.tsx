import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case, ActivityLog, CaseStatistics } from '../types';
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
  getAllCases,
  getDashboardStats,
  getRecentActivity,
} from '../services/database';
import { lockVault } from '../services/security';
import { createDemoCaseIfNotExists } from '../services/demoData';

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

  const loadDashboardData = async () => {
    try {
      const [statsData, allCases, logsData] = await Promise.all([
        getDashboardStats(),
        getAllCases(),
        getRecentActivity(6),
      ]);
      setStats(statsData);
      setRecentCases(allCases.slice(0, 4));
      setRecentLogs(logsData);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
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

  const handleLoadDemo = async () => {
    try {
      const demoCase = await createDemoCaseIfNotExists();
      await loadDashboardData();
      navigation.navigate('CaseDetail', { caseId: demoCase.id });
    } catch (err) {
      Alert.alert('Demo Error', String(err));
    }
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
            style={[styles.actionButton, { backgroundColor: '#1E2533', borderColor: '#785A1D' }]}
            activeOpacity={0.8}
            onPress={handleLoadDemo}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
              <Ionicons name="cube-outline" size={24} color={Colors.warning} />
            </View>
            <Text style={styles.actionTitle}>Demo Case</Text>
            <Text style={styles.actionSubtitle}>Fictional payment fraud</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Cases Section */}
        <SectionHeader
          title="Recent Incidents"
          actionText={recentCases.length > 0 ? 'View All' : undefined}
          onAction={() => navigation.navigate('CaseList')}
        />

        {recentCases.length === 0 ? (
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

