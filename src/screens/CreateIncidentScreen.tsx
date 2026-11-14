import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case, SeverityLevel } from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Input,
} from '../components';
import { insertCase } from '../services/database';

const CATEGORIES = [
  'Financial Fraud & UPI Scams',
  'Cyber Harassment & Stalking',
  'Identity Theft & Impersonation',
  'Extortion & Blackmail',
  'Phishing & Credential Theft',
  'Unauthorized Account Takeover',
  'Online Defamation & Slander',
  'Other Digital Incident',
];

const PLATFORMS = [
  'WhatsApp',
  'Telegram',
  'Instagram',
  'Banking / UPI',
  'Email',
  'Facebook',
  'SMS / Text Message',
  'Voice Call',
  'Fraudulent Website',
  'Other Platform',
];

const SEVERITIES: { level: SeverityLevel; label: string; color: string }[] = [
  { level: 'low', label: 'Low', color: Colors.info },
  { level: 'medium', label: 'Medium', color: Colors.warning },
  { level: 'high', label: 'High', color: Colors.danger },
  { level: 'critical', label: 'Critical', color: '#B91C1C' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'CreateIncident'>;

export const CreateIncidentScreen: React.FC<Props> = ({ navigation }) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [incidentTime, setIncidentTime] = useState(
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [suspectInfo, setSuspectInfo] = useState('');
  const [severity, setSeverity] = useState<SeverityLevel>('medium');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!title.trim()) {
      setError('Please provide an incident title');
      return;
    }
    if (!incidentDate.trim()) {
      setError('Please enter the incident date (YYYY-MM-DD)');
      return;
    }

    setLoading(true);
    try {
      const caseId = 'case_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const now = new Date().toISOString();

      const newCase: Case = {
        id: caseId,
        title: title.trim(),
        category,
        description: description.trim(),
        incident_date: incidentDate.trim(),
        incident_time: incidentTime.trim(),
        platform,
        suspect_info: suspectInfo.trim(),
        severity,
        status: 'active',
        is_demo: 0,
        created_at: now,
        updated_at: now,
      };

      await insertCase(newCase);

      Alert.alert(
        'Incident Created',
        'Your case has been logged securely into the local SQLite database. Would you like to upload evidence files now?',
        [
          {
            text: 'View Case',
            onPress: () => navigation.replace('CaseDetail', { caseId }),
          },
          {
            text: 'Upload Evidence Now',
            onPress: () => {
              navigation.replace('CaseDetail', { caseId });
              navigation.navigate('UploadEvidence', { caseId });
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to save incident: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <Header
        title="Report an Incident"
        subtitle="Step 1 of Evidence Preservation"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.introCard}>
          <Text style={styles.introTitle}>Preserve Digital Evidence Early</Text>
          <Text style={styles.introText}>
            Document the key context before uploading screenshots or message logs.
            All details stay 100% offline in your encrypted vault.
          </Text>
        </Card>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Incident Title */}
        <Input
          label="Incident Title *"
          placeholder="e.g., Telegram Crypto Scam or WhatsApp Impersonation"
          value={title}
          onChangeText={setTitle}
          icon="text-outline"
        />

        {/* Incident Category Selection */}
        <Text style={styles.fieldLabel}>Incident Category *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
        >
          {CATEGORIES.map((cat) => {
            const isSelected = category === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                ]}
                onPress={() => setCategory(cat)}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Platform Selection */}
        <Text style={styles.fieldLabel}>Platform / Medium Involved *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
        >
          {PLATFORMS.map((plat) => {
            const isSelected = platform === plat;
            return (
              <TouchableOpacity
                key={plat}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                ]}
                onPress={() => setPlatform(plat)}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {plat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Date and Time */}
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: Spacing.sm }}>
            <Input
              label="Incident Date (YYYY-MM-DD) *"
              placeholder="2026-11-14"
              value={incidentDate}
              onChangeText={setIncidentDate}
              icon="calendar-outline"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Approx. Time"
              placeholder="14:30"
              value={incidentTime}
              onChangeText={setIncidentTime}
              icon="time-outline"
            />
          </View>
        </View>

        {/* Suspect Information */}
        <Input
          label="Suspected Account / Contact Info"
          placeholder="Usernames, mobile numbers, UPI VPAs, phishing links..."
          value={suspectInfo}
          onChangeText={setSuspectInfo}
          icon="person-outline"
          helper="Include known handles, phone numbers, or account details"
        />

        {/* Severity Level */}
        <Text style={styles.fieldLabel}>Assessed Severity Level</Text>
        <View style={styles.severityRow}>
          {SEVERITIES.map((s) => {
            const isSelected = severity === s.level;
            return (
              <TouchableOpacity
                key={s.level}
                style={[
                  styles.severityBtn,
                  isSelected && {
                    backgroundColor: s.color,
                    borderColor: s.color,
                  },
                ]}
                onPress={() => setSeverity(s.level)}
              >
                <Text
                  style={[
                    styles.severityText,
                    isSelected && { color: Colors.white, fontWeight: '700' },
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Narrative Description */}
        <Input
          label="Narrative Description"
          placeholder="Describe how the incident occurred, the sequence of demands or actions, and what financial or personal harm occurred..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          style={{ height: 100, textAlignVertical: 'top' }}
        />

        {/* Save Button */}
        <Button
          title="Save Incident & Proceed"
          onPress={handleSave}
          loading={loading}
          variant="primary"
          icon="save-outline"
          size="lg"
          style={{ marginTop: Spacing.md }}
        />
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
    fontSize: 14,
    fontWeight: '600',
    color: Colors.teal,
    marginBottom: 4,
  },
  introText: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: Colors.tealMuted,
    borderColor: Colors.teal,
  },
  chipText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  chipTextSelected: {
    color: Colors.white,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
  },
  severityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  severityBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: 3,
  },
  severityText: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  errorBox: {
    backgroundColor: Colors.dangerMuted,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 12,
  },
});

