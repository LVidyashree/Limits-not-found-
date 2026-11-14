import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case } from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Input,
  Badge,
  EmptyState,
} from '../components';
import { getAllCases } from '../services/database';

type Props = NativeStackScreenProps<RootStackParamList, 'CaseList'>;

export const CaseListScreen: React.FC<Props> = ({ navigation }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const [filteredCases, setFilteredCases] = useState<Case[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'demo'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const loadCases = async () => {
    try {
      const all = await getAllCases();
      setCases(all);
      applyFilter(all, searchQuery, activeFilter);
    } catch (err) {
      console.error('Failed to load cases:', err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadCases();
    }, [])
  );

  const applyFilter = (
    data: Case[],
    query: string,
    filter: 'all' | 'active' | 'demo'
  ) => {
    let result = [...data];

    if (filter === 'active') {
      result = result.filter((c) => c.status === 'active' && !c.is_demo);
    } else if (filter === 'demo') {
      result = result.filter((c) => c.is_demo === 1);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.platform.toLowerCase().includes(q) ||
          (c.suspect_info && c.suspect_info.toLowerCase().includes(q))
      );
    }

    setFilteredCases(result);
  };

  const handleSearch = (txt: string) => {
    setSearchQuery(txt);
    applyFilter(cases, txt, activeFilter);
  };

  const handleFilterChange = (filter: 'all' | 'active' | 'demo') => {
    setActiveFilter(filter);
    applyFilter(cases, searchQuery, filter);
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

