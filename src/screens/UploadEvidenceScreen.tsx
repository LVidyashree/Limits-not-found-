import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Evidence } from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Input,
  Badge,
} from '../components';
import {
  saveEvidenceFileLocally,
  saveTextAsEvidenceFile,
  detectFileType,
  formatBytes,
} from '../services/storage';
import { insertEvidence, getCaseById } from '../services/database';
import { runEvidenceAnalysis } from '../services/analysisEngine';
import { maybeAutoBackupEvidence } from '../services/backupService';

type Props = NativeStackScreenProps<RootStackParamList, 'UploadEvidence'>;

export const UploadEvidenceScreen: React.FC<Props> = ({ route, navigation }) => {
  const { caseId } = route.params;
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [uploadedEvidence, setUploadedEvidence] = useState<Evidence | null>(null);

  // Manual note modal
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');

  const processAndSaveFile = async (
    uri: string,
    originalName: string,
    mimeType?: string,
    extractedContent?: string
  ) => {
    try {
      setProcessing(true);
      setCurrentStep('1. Preserving bit-exact copy in local vault...');

      // Save locally to isolated storage
      const saved = await saveEvidenceFileLocally(uri, originalName);

      setCurrentStep('2. Computing SHA-256 cryptographic checksum...');
      const sha256 = saved.sha256;

      setCurrentStep('3. Extracting file metadata & recording custody...');
      const fileType = detectFileType(originalName, mimeType);
      const evidenceId = 'ev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const now = new Date().toISOString();

      const newEvidence: Evidence = {
        id: evidenceId,
        case_id: caseId,
        filename: saved.filename,
        original_filename: originalName,
        file_path: saved.localPath,
        file_size: saved.size,
        file_type: fileType,
        mime_type: mimeType || 'application/octet-stream',
        sha256_hash: sha256,
        processing_status: 'completed',
        extracted_text: extractedContent || null,
        metadata_json: JSON.stringify({
          preservedAt: now,
          vaultPath: saved.localPath,
          sizeBytes: saved.size,
          mime: mimeType,
        }),
        created_at: now,
        is_verified: 0,
      };

      await insertEvidence(newEvidence);

      setCurrentStep('4. Performing local rule-based entity extraction...');
      await runEvidenceAnalysis(newEvidence, extractedContent);

      // Optional auto-backup is consent-gated and never blocks the local
      // preservation flow or prompts for a passphrase.
      void maybeAutoBackupEvidence(newEvidence.id).catch((err) =>
        console.warn('Automatic encrypted backup skipped:', err)
      );

      setUploadedEvidence(newEvidence);
      setProcessing(false);
      setCurrentStep('');

      Alert.alert(
        'Evidence Preserved Successfully',
        `Original file "${originalName}" is securely saved on device with SHA-256 hash: ${sha256.slice(0, 16)}...`,
        [
          {
            text: 'View Evidence Record',
            onPress: () =>
              navigation.replace('EvidenceDetail', {
                evidenceId: newEvidence.id,
                caseId,
              }),
          },
          { text: 'Upload Another', onPress: () => setUploadedEvidence(null) },
        ]
      );
    } catch (error) {
      console.error('Evidence preservation error:', error);
      setProcessing(false);
      setCurrentStep('');
      Alert.alert('Preservation Failed', String(error));
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        await processAndSaveFile(file.uri, file.name, file.mimeType);
      }
    } catch (err) {
      Alert.alert('File Picker Error', String(err));
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const filename =
          asset.fileName ||
          `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        await processAndSaveFile(asset.uri, filename, asset.mimeType);
      }
    } catch (err) {
      Alert.alert('Image Picker Error', String(err));
    }
  };

  const handleCameraCapture = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission Required', 'Camera access is needed to capture evidence.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const filename = `camera_evidence_${Date.now()}.jpg`;
        await processAndSaveFile(asset.uri, filename, asset.mimeType);
      }
    } catch (err) {
      Alert.alert('Camera Error', String(err));
    }
  };

  const handleSaveTextNote = async () => {
    if (!noteContent.trim()) {
      Alert.alert('Validation', 'Please enter text content for this evidence note.');
      return;
    }

    try {
      setShowNoteModal(false);
      setProcessing(true);
      setCurrentStep('Saving text record to vault file...');

      const filename = noteTitle.trim()
        ? `${noteTitle.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`
        : `chat_transcript_${Date.now()}.txt`;

      const saved = await saveTextAsEvidenceFile(noteContent, filename);

      const evidenceId = 'ev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const now = new Date().toISOString();

      const newEvidence: Evidence = {
        id: evidenceId,
        case_id: caseId,
        filename: saved.filename,
        original_filename: filename,
        file_path: saved.localPath,
        file_size: saved.size,
        file_type: 'text',
        mime_type: 'text/plain',
        sha256_hash: saved.sha256,
        processing_status: 'completed',
        extracted_text: noteContent,
        metadata_json: JSON.stringify({
          type: 'Manual Incident Transcript Note',
          created: now,
        }),
        created_at: now,
        is_verified: 0,
      };

      await insertEvidence(newEvidence);
      await runEvidenceAnalysis(newEvidence, noteContent);

      void maybeAutoBackupEvidence(newEvidence.id).catch((err) =>
        console.warn('Automatic encrypted backup skipped:', err)
      );

      setProcessing(false);
      setNoteTitle('');
      setNoteContent('');

      Alert.alert(
        'Evidence Note Preserved',
        `Text record preserved and hashed: ${saved.sha256.slice(0, 16)}...`,
        [
          {
            text: 'View Record',
            onPress: () =>
              navigation.replace('EvidenceDetail', {
                evidenceId: newEvidence.id,
                caseId,
              }),
          },
        ]
      );
    } catch (err) {
      setProcessing(false);
      Alert.alert('Error', String(err));
    }
  };

  return (
    <ScreenWrapper>
      <Header
        title="Upload Evidence"
        subtitle="Cryptographic Preservation"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="shield-checkmark" size={16} color={Colors.teal} />
            <Text style={styles.infoTitle}>Chain of Custody Guarantee</Text>
          </View>
          <Text style={styles.infoText}>
            EvidenceVault never alters your original file. It is copied to an
            isolated local sandbox and sealed with a bit-level SHA-256 hash.
          </Text>
        </Card>

        {/* Processing Indicator */}
        {processing ? (
          <Card style={styles.processingCard}>
            <View style={styles.spinnerRow}>
              <Ionicons name="sync" size={24} color={Colors.teal} />
              <Text style={styles.processingTitle}>Preserving Evidence...</Text>
            </View>
            <Text style={styles.stepText}>{currentStep}</Text>
          </Card>
        ) : null}

        {/* Upload Options Grid */}
        <Text style={styles.sectionTitle}>Select Ingestion Method</Text>

        <TouchableOpacity
          style={styles.pickerOption}
          activeOpacity={0.8}
          onPress={handlePickImage}
          disabled={processing}
        >
          <View style={[styles.iconCircle, { backgroundColor: Colors.tealMuted }]}>
            <Ionicons name="images-outline" size={26} color={Colors.teal} />
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionHeading}>Screenshots & Photos</Text>
            <Text style={styles.optionSub}>
              WhatsApp messages, social media chats, transaction screenshots
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.secondaryText} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.pickerOption}
          activeOpacity={0.8}
          onPress={handlePickDocument}
          disabled={processing}
        >
          <View style={[styles.iconCircle, { backgroundColor: Colors.blueMuted }]}>
            <Ionicons name="document-text-outline" size={26} color={Colors.blue} />
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionHeading}>Documents, PDFs & Files</Text>
            <Text style={styles.optionSub}>
              Bank statements, legal notices, audio recordings, video files
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.secondaryText} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.pickerOption}
          activeOpacity={0.8}
          onPress={handleCameraCapture}
          disabled={processing}
        >
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Ionicons name="camera-outline" size={26} color={Colors.info} />
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionHeading}>Take Camera Photo</Text>
            <Text style={styles.optionSub}>
              Directly capture physical letters, cheques, or secondary screens
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.secondaryText} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.pickerOption}
          activeOpacity={0.8}
          onPress={() => setShowNoteModal(true)}
          disabled={processing}
        >
          <View style={[styles.iconCircle, { backgroundColor: Colors.warningMuted }]}>
            <Ionicons name="create-outline" size={26} color={Colors.warning} />
          </View>
          <View style={styles.optionTextCol}>
            <Text style={styles.optionHeading}>Paste Text / Chat Transcript</Text>
            <Text style={styles.optionSub}>
              Paste email headers, raw SMS text, phone numbers, or notes
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.secondaryText} />
        </TouchableOpacity>

        {/* Modal for manual note */}
        <Modal
          visible={showNoteModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNoteModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Paste Incident Transcript</Text>
                <TouchableOpacity onPress={() => setShowNoteModal(false)}>
                  <Ionicons name="close" size={22} color={Colors.secondaryText} />
                </TouchableOpacity>
              </View>

              <Input
                label="Note Filename"
                placeholder="e.g., telegram_threat_transcript"
                value={noteTitle}
                onChangeText={setNoteTitle}
              />

              <Input
                label="Transcript or Evidence Text *"
                placeholder="Paste verbatim messages, timestamps, contact details, payment instructions..."
                value={noteContent}
                onChangeText={setNoteContent}
                multiline
                numberOfLines={8}
                style={{ height: 160, textAlignVertical: 'top' }}
              />

              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  onPress={() => setShowNoteModal(false)}
                  variant="outline"
                  size="sm"
                  style={{ marginRight: Spacing.sm, flex: 1 }}
                />
                <Button
                  title="Preserve Note"
                  onPress={handleSaveTextNote}
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
  infoCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 6,
  },
  infoText: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  processingCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.teal,
    marginBottom: Spacing.md,
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  processingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginLeft: 8,
  },
  stepText: {
    fontSize: 12,
    color: Colors.tealLight,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  optionTextCol: {
    flex: 1,
  },
  optionHeading: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  optionSub: {
    fontSize: 11,
    color: Colors.secondaryText,
    marginTop: 2,
    lineHeight: 16,
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
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
});

