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
  Finding,
  VerificationStatus,
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
  getFindingsByCase,
  getEvidenceByCase,
  updateFindingStatus,
} from '../services/database';

type Props = NativeStackScreenProps<RootStackParamList, 'Verification'>;

export const VerificationScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [activeTab, setActiveTab] = useState<VerificationStatus>('needs_verification');

  // Edit / Notes modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [userNotes, setUserNotes] = useState('');

  useEffect(() => {
    loadData();
  }, [caseId]);

  const loadData = async () => {
    try {
      const [fnd, ev] = await Promise.all([
        getFindingsByCase(caseId),
        getEvidenceByCase(caseId),
      ]);
      setFindings(fnd);
      setEvidenceList(ev);
    } catch (err) {
      console.error('Failed to load verification findings:', err);
    }
  };

  const handleStatusChange = async (
    findingId: string,
    status: VerificationStatus,
    notes?: string
  ) => {
    try {
      await updateFindingStatus(findingId, status, notes);
      await loadData();
    } catch (err) {
      Alert.alert('Update Error', String(err));
    }
  };

  const handleOpenEditModal = (finding: Finding) => {
    setSelectedFinding(finding);
    setUserNotes(finding.user_notes || '');
    setEditModalVisible(true);
  };

  const handleSaveNotes = async () => {
    if (!selectedFinding) return;
    await handleStatusChange(selectedFinding.id, 'verified', userNotes.trim());
    setEditModalVisible(false);
  };

  const handleVerifyAllPending = () => {
    const pending = findings.filter((f) => f.verification_status === 'needs_verification');
    if (pending.length === 0) return;

    Alert.alert(
      'Verify All Discovered Findings',
      `Are you sure you want to approve all ${pending.length} pending entities as verified?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify All',
          onPress: async () => {
            for (const item of pending) {
              await updateFindingStatus(item.id, 'verified');
            }
            await loadData();
          },
        },
      ]
    );
  };

  const getEvidenceName = (evidenceId: string): string => {
    const ev = evidenceList.find((e) => e.id === evidenceId);
    return ev ? ev.original_filename : 'Original Evidence';
  };

  const pendingList = findings.filter((f) => f.verification_status === 'needs_verification');
  const verifiedList = findings.filter((f) => f.verification_status === 'verified');
  const rejectedList = findings.filter((f) => f.verification_status === 'rejected');

  const currentList =
    activeTab === 'needs_verification'
      ? pendingList
      : activeTab === 'verified'
      ? verifiedList
      : rejectedList;

  return (
    <ScreenWrapper>
      <Header
        title="User Verification"
        subtitle="Forensic Truth Triage"
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: 'document-text-outline',
          onPress: () => navigation.navigate('Report', { caseId }),
          color: Colors.teal,
        }}
      />

      <View style={styles.container}>
        {/* Verification Philosophy Box */}
        <Card style={styles.introCard}>
          <Text style={styles.introTitle}>Human Verification Protocol</Text>
          <Text style={styles.introText}>
            AI extraction provides candidates. You have final authority to confirm,
            annotate, or discard entities before creating the official incident report.
          </Text>
        </Card>

        {/* Triage Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'needs_verification' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('needs_verification')}
          >
            <Ionicons
              name="alert-circle-outline"
              size={14}
              color={
                activeTab === 'needs_verification'
                  ? Colors.warning
                  : Colors.secondaryText
              }
            />
            <Text
              style={[
                styles.tabText,
                activeTab === 'needs_verification' && styles.tabTextActive,
              ]}
            >
              Needs Review ({pendingList.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'verified' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('verified')}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={14}
              color={
                activeTab === 'verified'
                  ? Colors.success
                  : Colors.secondaryText
              }
            />
            <Text
              style={[
                styles.tabText,
                activeTab === 'verified' && styles.tabTextActive,
              ]}
            >
              Verified ({verifiedList.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabBtn,
              activeTab === 'rejected' && styles.tabBtnActive,
            ]}
            onPress={() => setActiveTab('rejected')}
          >
            <Ionicons
              name="close-circle-outline"
              size={14}
              color={
                activeTab === 'rejected'
                  ? Colors.danger
                  : Colors.secondaryText
              }
            />
            <Text
              style={[
                styles.tabText,
                activeTab === 'rejected' && styles.tabTextActive,
              ]}
            >
              Rejected ({rejectedList.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quick Batch Action for Pending */}
        {activeTab === 'needs_verification' && pendingList.length > 0 && (
          <View style={styles.batchRow}>
            <Text style={styles.batchInfo}>
              Review each item or bulk accept:
            </Text>
            <Button
              title="Verify All Pending"
              onPress={handleVerifyAllPending}
              variant="outline"
              size="sm"
              icon="checkmark-done"
            />
          </View>
        )}

        {/* Finding List */}
        <ScrollView contentContainerStyle={styles.scrollList}>
          {currentList.length === 0 ? (
            <EmptyState
              icon={
                activeTab === 'needs_verification'
                  ? 'checkmark-done-circle-outline'
                  : activeTab === 'verified'
                  ? 'shield-checkmark-outline'
                  : 'trash-outline'
              }
              title={
                activeTab === 'needs_verification'
                  ? 'All Entities Reviewed'
                  : activeTab === 'verified'
                  ? 'No Verified Items'
                  : 'No Rejected Items'
              }
              description={
                activeTab === 'needs_verification'
                  ? 'Zero pending items! All discovered entities have been triaged.'
                  : 'Items accepted during review will appear in this verified index.'
              }
            />
          ) : (
            currentList.map((finding) => (
              <Card key={finding.id} style={styles.cardItem}>
                <View style={styles.cardHeader}>
                  <View style={styles.typeCol}>
                    <Text style={styles.findingLabel}>{finding.label}</Text>
                    <Text style={styles.findingVal} selectable>
                      {finding.finding_value}
                    </Text>
                  </View>
                  <Badge
                    label={
                      finding.verification_status === 'verified'
                        ? 'VERIFIED'
                        : finding.verification_status === 'needs_verification'
                        ? 'NEEDS REVIEW'
                        : 'REJECTED'
                    }
                    type={
                      finding.verification_status === 'verified'
                        ? 'success'
                        : finding.verification_status === 'needs_verification'
                        ? 'warning'
                        : 'danger'
                    }
                  />
                </View>

                {finding.context_snippet ? (
                  <View style={styles.contextBox}>
                    <Text style={styles.contextText}>
                      "{finding.context_snippet}"
                    </Text>
                  </View>
                ) : null}

                {finding.user_notes ? (
                  <View style={styles.notesBox}>
                    <Text style={styles.notesLabel}>Investigator Note:</Text>
                    <Text style={styles.notesContent}>{finding.user_notes}</Text>
                  </View>
                ) : null}

                {/* Evidence Link */}
                <TouchableOpacity
                  style={styles.sourceRow}
                  onPress={() =>
                    navigation.navigate('EvidenceDetail', {
                      evidenceId: finding.evidence_id,
                      caseId,
                    })
                  }
                >
                  <Ionicons name="link" size={13} color={Colors.teal} />
                  <Text style={styles.sourceText} numberOfLines={1}>
                    Extracted from: {getEvidenceName(finding.evidence_id)}
                  </Text>
                </TouchableOpacity>

                {/* Triage Action Buttons */}
                <View style={styles.actionRow}>
                  {finding.verification_status !== 'verified' && (
                    <Button
                      title="Verify"
                      onPress={() => handleStatusChange(finding.id, 'verified')}
                      variant="primary"
                      size="sm"
                      icon="checkmark"
                      style={{ flex: 1, marginRight: Spacing.xs }}
                    />
                  )}

                  <Button
                    title="Annotate"
                    onPress={() => handleOpenEditModal(finding)}
                    variant="outline"
                    size="sm"
                    icon="pencil"
                    style={{ flex: 1, marginRight: Spacing.xs }}
                  />

                  {finding.verification_status !== 'rejected' && (
                    <Button
                      title="Reject"
                      onPress={() => handleStatusChange(finding.id, 'rejected')}
                      variant="danger"
                      size="sm"
                      icon="close"
                      style={{ flex: 0.8 }}
                    />
                  )}
                </View>
              </Card>
            ))
          )}
        </ScrollView>

        {/* Modal for adding user notes / annotations */}
        <Modal
          visible={editModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setEditModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Annotate Finding</Text>
                <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                  <Ionicons name="close" size={22} color={Colors.secondaryText} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalEntity}>{selectedFinding?.label}</Text>
              <Text style={styles.modalValue} selectable>
                {selectedFinding?.finding_value}
              </Text>

              <Input
                label="User Verification Notes / Remarks"
                placeholder="e.g., Confirmed phone number displayed on suspect Telegram account..."
                value={userNotes}
                onChangeText={setUserNotes}
                multiline
                numberOfLines={4}
                style={{ height: 100, textAlignVertical: 'top' }}
              />

              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  onPress={() => setEditModalVisible(false)}
                  variant="outline"
                  size="sm"
                  style={{ marginRight: Spacing.sm, flex: 1 }}
                />
                <Button
                  title="Save & Mark Verified"
                  onPress={handleSaveNotes}
                  variant="primary"
                  size="sm"
                  style={{ flex: 1.2 }}
                />
              </View>
            </View>
          </View>
        </Modal>
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
  introCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.sm,
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
  tabBar: {
    flexDirection: 'row',
    marginBottom: Spacing.sm,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  tabBtnActive: {
    backgroundColor: Colors.secondaryBackground,
  },
  tabText: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginLeft: 4,
  },
  tabTextActive: {
    color: Colors.white,
    fontWeight: '600',
  },
  batchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  batchInfo: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  scrollList: {
    paddingBottom: Spacing.xxl,
  },
  cardItem: {
    marginBottom: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  typeCol: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  findingLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.tealLight,
  },
  findingVal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  contextBox: {
    backgroundColor: Colors.secondaryBackground,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginVertical: 4,
  },
  contextText: {
    fontSize: 11,
    color: Colors.secondaryText,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  notesBox: {
    backgroundColor: '#16283D',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginVertical: 4,
    borderLeftWidth: 3,
    borderLeftColor: Colors.teal,
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.teal,
    textTransform: 'uppercase',
  },
  notesContent: {
    fontSize: 11,
    color: Colors.white,
    marginTop: 2,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  sourceText: {
    fontSize: 11,
    color: Colors.teal,
    marginLeft: 4,
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
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
    marginBottom: Spacing.sm,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.white,
  },
  modalEntity: {
    fontSize: 12,
    color: Colors.tealLight,
    fontWeight: '600',
  },
  modalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
    fontFamily: 'monospace',
    marginBottom: Spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
});

