import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  TimelineEvent,
  Evidence,
} from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Input,
  Badge,
  EmptyState,
} from '../components';
import {
  getEventsByCase,
  getEvidenceByCase,
  insertEvent,
  updateEvent,
  deleteEvent,
  toggleEventVerification,
} from '../services/database';

type Props = NativeStackScreenProps<RootStackParamList, 'Timeline'>;

export const TimelineScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  
  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Form fields
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [eventTime, setEventTime] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkedEvidenceId, setLinkedEvidenceId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [caseId]);

  const loadData = async () => {
    try {
      const [evt, ev] = await Promise.all([
        getEventsByCase(caseId),
        getEvidenceByCase(caseId),
      ]);
      setEvents(evt);
      setEvidenceList(ev);
    } catch (err) {
      console.error('Failed to load timeline events:', err);
    }
  };

  const handleOpenAddModal = () => {
    setIsEditing(false);
    setSelectedEventId(null);
    setEventDate(new Date().toISOString().split('T')[0]);
    setEventTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setTitle('');
    setDescription('');
    setLinkedEvidenceId(evidenceList[0]?.id || null);
    setModalVisible(true);
  };

  const handleOpenEditModal = (evt: TimelineEvent) => {
    setIsEditing(true);
    setSelectedEventId(evt.id);
    setEventDate(evt.event_date);
    setEventTime(evt.event_time || '');
    setTitle(evt.title);
    setDescription(evt.description);
    setLinkedEvidenceId(evt.evidence_id);
    setModalVisible(true);
  };

  const handleSaveEvent = async () => {
    if (!title.trim() || !eventDate.trim()) {
      Alert.alert('Validation Error', 'Event title and date are required.');
      return;
    }

    try {
      if (isEditing && selectedEventId) {
        const existing = events.find((e) => e.id === selectedEventId);
        if (existing) {
          const updated: TimelineEvent = {
            ...existing,
            title: title.trim(),
            description: description.trim(),
            event_date: eventDate.trim(),
            event_time: eventTime.trim() || null,
            evidence_id: linkedEvidenceId,
          };
          await updateEvent(updated);
        }
      } else {
        const newEvt: TimelineEvent = {
          id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          case_id: caseId,
          evidence_id: linkedEvidenceId,
          finding_id: null,
          event_date: eventDate.trim(),
          event_time: eventTime.trim() || null,
          title: title.trim(),
          description: description.trim(),
          source: 'manual',
          is_verified: 1,
          created_at: new Date().toISOString(),
        };
        await insertEvent(newEvt);
      }

      setModalVisible(false);
      await loadData();
    } catch (err) {
      Alert.alert('Save Error', String(err));
    }
  };

  const handleDeleteEvent = (evtId: string) => {
    Alert.alert('Delete Event', 'Are you sure you want to remove this milestone from the timeline?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteEvent(evtId);
          await loadData();
        },
      },
    ]);
  };

  const handleToggleVerify = async (evt: TimelineEvent) => {
    const nextStatus = evt.is_verified ? 0 : 1;
    await toggleEventVerification(evt.id, nextStatus);
    await loadData();
  };

  const getLinkedEvidenceName = (evidenceId: string | null): string | null => {
    if (!evidenceId) return null;
    const ev = evidenceList.find((e) => e.id === evidenceId);
    return ev ? ev.original_filename : null;
  };

  return (
    <ScreenWrapper>
      <Header
        title="Incident Timeline"
        subtitle={`${events.length} Chronological Milestones`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'add',
          onPress: handleOpenAddModal,
          color: Colors.teal,
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Timeline Header Info */}
        <Card style={styles.introCard}>
          <Text style={styles.introTitle}>Sequential Incident Tracking</Text>
          <Text style={styles.introText}>
            Every timeline entry represents a verified chronological milestone
            linked directly to original screenshots, receipts, or chat logs.
          </Text>
        </Card>

        {events.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="Timeline is Empty"
            description="Add incident events or run AI analysis to extract chronological timestamps from evidence."
            actionTitle="Add Milestone"
            onAction={handleOpenAddModal}
          />
        ) : (
          <View style={styles.timelineContainer}>
            {events.map((event, index) => {
              const evidenceName = getLinkedEvidenceName(event.evidence_id);
              const isLast = index === events.length - 1;

              return (
                <View key={event.id} style={styles.timelineRow}>
                  {/* Left Column: Timeline Line & Node */}
                  <View style={styles.nodeColumn}>
                    <View
                      style={[
                        styles.nodeCircle,
                        event.is_verified ? styles.nodeVerified : styles.nodeUnverified,
                      ]}
                    >
                      <Ionicons
                        name={event.is_verified ? 'checkmark' : 'time'}
                        size={12}
                        color={Colors.white}
                      />
                    </View>
                    {!isLast && <View style={styles.verticalLine} />}
                  </View>

                  {/* Right Column: Event Content Card */}
                  <View style={styles.eventCardColumn}>
                    <Card style={styles.eventCard}>
                      <View style={styles.eventHeader}>
                        <View style={styles.dateTimeBadge}>
                          <Ionicons
                            name="calendar-outline"
                            size={12}
                            color={Colors.teal}
                          />
                          <Text style={styles.dateTimeText}>
                            {event.event_date}{' '}
                            {event.event_time ? '• ' + event.event_time : ''}
                          </Text>
                        </View>

                        <Badge
                          label={
                            event.source === 'extracted'
                              ? 'AI EXTRACTED'
                              : 'USER ENTERED'
                          }
                          type={event.source === 'extracted' ? 'teal' : 'info'}
                        />
                      </View>

                      <Text style={styles.eventTitle}>{event.title}</Text>
                      {event.description ? (
                        <Text style={styles.eventDesc}>{event.description}</Text>
                      ) : null}

                      {/* Linked Evidence File Badge */}
                      {evidenceName && (
                        <TouchableOpacity
                          style={styles.linkedFileRow}
                          onPress={() => {
                            if (event.evidence_id) {
                              navigation.navigate('EvidenceDetail', {
                                evidenceId: event.evidence_id,
                                caseId,
                              });
                            }
                          }}
                        >
                          <Ionicons
                            name="document-attach-outline"
                            size={14}
                            color={Colors.teal}
                          />
                          <Text style={styles.linkedFileName} numberOfLines={1}>
                            Linked Evidence: {evidenceName}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {/* Event Actions Footer */}
                      <View style={styles.eventFooter}>
                        <TouchableOpacity
                          style={styles.actionPill}
                          onPress={() => handleToggleVerify(event)}
                        >
                          <Ionicons
                            name={
                              event.is_verified
                                ? 'checkmark-circle'
                                : 'ellipse-outline'
                            }
                            size={14}
                            color={
                              event.is_verified
                                ? Colors.success
                                : Colors.secondaryText
                            }
                          />
                          <Text
                            style={[
                              styles.actionPillText,
                              event.is_verified === 1 ? { color: Colors.success } : undefined,
                            ]}
                          >
                            {event.is_verified ? 'Verified' : 'Verify'}
                          </Text>
                        </TouchableOpacity>

                        <View style={styles.actionBtnGroup}>
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => handleOpenEditModal(event)}
                          >
                            <Ionicons
                              name="pencil-outline"
                              size={15}
                              color={Colors.secondaryText}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => handleDeleteEvent(event.id)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={15}
                              color={Colors.danger}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </Card>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Modal for adding/editing event */}
        <Modal
          visible={modalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {isEditing ? 'Edit Incident Milestone' : 'Add Milestone'}
                </Text>
                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Ionicons name="close" size={22} color={Colors.secondaryText} />
                </TouchableOpacity>
              </View>

              <Input
                label="Event Title *"
                placeholder="e.g., Transfer of ₹25,000 sent via UPI"
                value={title}
                onChangeText={setTitle}
              />

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: Spacing.sm }}>
                  <Input
                    label="Date (YYYY-MM-DD) *"
                    placeholder="2026-11-14"
                    value={eventDate}
                    onChangeText={setEventDate}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Time (HH:MM)"
                    placeholder="14:30"
                    value={eventTime}
                    onChangeText={setEventTime}
                  />
                </View>
              </View>

              <Input
                label="Milestone Description"
                placeholder="Detailed description of what occurred..."
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                style={{ height: 80, textAlignVertical: 'top' }}
              />

              {/* Link Evidence Selector */}
              {evidenceList.length > 0 && (
                <View style={{ marginBottom: Spacing.md }}>
                  <Text style={styles.fieldLabel}>Link to Evidence File</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexDirection: 'row' }}
                  >
                    {evidenceList.map((ev) => {
                      const isSelected = linkedEvidenceId === ev.id;
                      return (
                        <TouchableOpacity
                          key={ev.id}
                          style={[
                            styles.chip,
                            isSelected && styles.chipSelected,
                          ]}
                          onPress={() =>
                            setLinkedEvidenceId(isSelected ? null : ev.id)
                          }
                        >
                          <Text
                            style={[
                              styles.chipText,
                              isSelected && styles.chipTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {ev.original_filename}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  onPress={() => setModalVisible(false)}
                  variant="outline"
                  size="sm"
                  style={{ marginRight: Spacing.sm, flex: 1 }}
                />
                <Button
                  title={isEditing ? 'Save Changes' : 'Add Milestone'}
                  onPress={handleSaveEvent}
                  variant="primary"
                  size="sm"
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  introCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  introTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginBottom: 4,
  },
  introText: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  timelineContainer: {
    marginTop: Spacing.sm,
  },
  timelineRow: {
    flexDirection: 'row',
  },
  nodeColumn: {
    width: 32,
    alignItems: 'center',
  },
  nodeCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    marginTop: 6,
  },
  nodeVerified: {
    backgroundColor: Colors.teal,
  },
  nodeUnverified: {
    backgroundColor: Colors.blue,
  },
  verticalLine: {
    flex: 1,
    width: 2,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  eventCardColumn: {
    flex: 1,
    paddingLeft: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  eventCard: {
    padding: Spacing.sm,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dateTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateTimeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.tealLight,
    marginLeft: 4,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 4,
  },
  eventDesc: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 17,
    marginBottom: 6,
  },
  linkedFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.secondaryBackground,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.sm,
    marginBottom: 6,
  },
  linkedFileName: {
    fontSize: 11,
    color: Colors.teal,
    marginLeft: 4,
    flex: 1,
  },
  eventFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  actionPillText: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginLeft: 4,
  },
  actionBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    padding: 6,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.white,
  },
  row: {
    flexDirection: 'row',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 6,
    maxWidth: 160,
  },
  chipSelected: {
    backgroundColor: Colors.tealMuted,
    borderColor: Colors.teal,
  },
  chipText: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  chipTextSelected: {
    color: Colors.white,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
});
