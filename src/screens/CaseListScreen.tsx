import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case } from '../types';
import { Colors, Spacing, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Input,
  Badge,
  EmptyState,
} from '../components';
import { getAllCases } from '../services/database';
import { syncCloudCasesIntoLocal } from '../services/caseService';

type Props = NativeStackScreenProps<RootStackParamList, 'CaseList'>;

export const CaseListScreen: React.FC<Props> = ({ navigation }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'demo'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const loadCases = async () => {
    if (firstLoad.current) setLoading(true);
    setLoadError(null);
    setCloudError(null);

    try {
      // Show local rows first so the vault is usable offline.
      const local = await getAllCases();
      setCases(local);

      firstLoad.current = false;
      setLoading(false);

      const sync = await syncCloudCasesIntoLocal(local);
      if (sync.cloudError) {
        setCloudError(sync.cloudError);
      }

      if (sync.imported > 0) {
        setCases(await getAllCases());
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
      loadCases();
    }, [])
  );

  // Derived state keeps the displayed list in sync with a background refresh
  // without ever reading a stale search query or pill selection.
  const filteredCases = useMemo(() => {
    let result = [...cases];

    if (activeFilter === 'active') {
      result = result.filter((c) => c.status === 'active' && !c.is_demo);
    } else if (activeFilter === 'demo') {
      result = result.filter((c) => c.is_demo === 1);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.platform.toLowerCase().includes(q) ||
          (c.suspect_info && c.suspect_info.toLowerCase().includes(q))
      );
    }

    return result;
  }, [cases, searchQuery, activeFilter]);

  const handleSearch = (txt: string) => {
    setSearchQuery(txt);
  };

  const handleFilterChange = (filter: 'all' | 'active' | 'demo') => {
    setActiveFilter(filter);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCases();
    setRefreshing(false);
  };

  return (
    <ScreenWrapper>
      <Header
        title="My Incidents"
        subtitle={`${cases.length} Total Records`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'add',
          onPress: () => navigation.navigate('CreateIncident', {}),
        }}
      />

      <View style={styles.container}>
        {/* Search Input */}
        <Input
          placeholder="Search by title, platform, suspect..."
          value={searchQuery}
          onChangeText={handleSearch}
          icon="search-outline"
          style={{ marginBottom: Spacing.xs }}
        />

        {/* Filter Pills */}
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              activeFilter === 'all' && styles.filterPillActive,
            ]}
            onPress={() => handleFilterChange('all')}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === 'all' && styles.filterTextActive,
              ]}
            >
              All ({cases.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              activeFilter === 'active' && styles.filterPillActive,
            ]}
            onPress={() => handleFilterChange('active')}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === 'active' && styles.filterTextActive,
              ]}
            >
              Active Incidents
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              activeFilter === 'demo' && styles.filterPillActive,
            ]}
            onPress={() => handleFilterChange('demo')}
          >
            <Text
              style={[
                styles.filterText,
                activeFilter === 'demo' && styles.filterTextActive,
              ]}
            >
              Demo Data
            </Text>
          </TouchableOpacity>
        </View>

        {/* Case List */}
        {loading ? (
          <View style={styles.loadingBox}>
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
              Account sync failed. Showing cases saved on this device. {cloudError}
            </Text>
          </View>
        ) : null}

        <FlatList
          data={filteredCases}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.teal}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            loading ? undefined : (
              <EmptyState
                icon="search-outline"
                title="No Matching Incidents"
                description={
                  searchQuery
                    ? `No cases found matching "${searchQuery}".`
                    : 'You have not reported any incidents in this category.'
                }
                actionTitle="Create New Incident"
                onAction={() => navigation.navigate('CreateIncident', {})}
              />
            )
          }
          renderItem={({ item }) => (
            <Card
              onPress={() => navigation.navigate('CaseDetail', { caseId: item.id })}
              variant={item.is_demo ? 'highlight' : 'normal'}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1, marginRight: Spacing.sm }}>
                  <Text style={styles.caseTitle}>{item.title}</Text>
                  <Text style={styles.caseCategory}>{item.category}</Text>
                </View>
                {item.is_demo ? (
                  <Badge label="DEMO" type="demo" />
                ) : (
                  <Badge
                    label={item.severity.toUpperCase()}
                    type={
                      item.severity === 'critical' || item.severity === 'high'
                        ? 'danger'
                        : item.severity === 'medium'
                        ? 'warning'
                        : 'info'
                    }
                  />
                )}
              </View>

              {item.suspect_info ? (
                <View style={styles.suspectBox}>
                  <Ionicons name="person-circle-outline" size={14} color={Colors.teal} />
                  <Text style={styles.suspectText} numberOfLines={1}>
                    Suspect: {item.suspect_info}
                  </Text>
                </View>
              ) : null}

              <View style={styles.cardBottom}>
                <View style={styles.tagItem}>
                  <Ionicons name="phone-portrait-outline" size={12} color={Colors.secondaryText} />
                  <Text style={styles.tagText}>{item.platform}</Text>
                </View>

                <View style={styles.tagItem}>
                  <Ionicons name="calendar-outline" size={12} color={Colors.secondaryText} />
                  <Text style={styles.tagText}>{item.incident_date}</Text>
                </View>

                <View style={styles.arrowRow}>
                  <Text style={styles.viewText}>Open</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.teal} />
                </View>
              </View>
            </Card>
          )}
        />
      </View>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  filterPillActive: {
    backgroundColor: Colors.tealMuted,
    borderColor: Colors.teal,
  },
  filterText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  filterTextActive: {
    color: Colors.white,
    fontWeight: '600',
  },
  loadingBox: {
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
  listContent: {
    paddingBottom: Spacing.xxl,
  },
  cardTop: {
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
  caseCategory: {
    fontSize: 12,
    color: Colors.tealLight,
    marginTop: 2,
  },
  suspectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.secondaryBackground,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.sm,
    marginVertical: 6,
  },
  suspectText: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginLeft: 6,
    flex: 1,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagText: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginLeft: 4,
  },
  arrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewText: {
    fontSize: 12,
    color: Colors.teal,
    fontWeight: '600',
    marginRight: 2,
  },
});

