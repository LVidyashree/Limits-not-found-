import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Case, SeverityLevel } from '../types';
import { Colors, Spacing, BorderRadius } from '../theme';
import {
  ScreenWrapper,
  Header,
  Card,
  Button,
  Input,
} from '../components';
import { getCaseById } from '../services/database';
import {
  createCaseWithCloud,
  updateCaseWithCloud,
} from '../services/caseService';

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

export const CreateIncidentScreen: React.FC<Props> = ({
  navigation,
  route,
}) => {
  const editingCaseId = route.params?.caseId;
  const isEditing = Boolean(editingCaseId);

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
  const [loadingCase, setLoadingCase] = useState(isEditing);
  const [existingCase, setExistingCase] = useState<Case | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editingCaseId) return undefined;

    let active = true;

    const loadCase = async () => {
      setLoadingCase(true);
      setError('');
      try {
        const found = await getCaseById(editingCaseId);
        if (!active) return;

        if (!found) {
          setError('That case could not be found on this device.');
          return;
        }

        setExistingCase(found);
        setTitle(found.title);
        setCategory(found.category);
        setDescription(found.description);
        setIncidentDate(found.incident_date);
        setIncidentTime(found.incident_time);
        setPlatform(found.platform);
        setSuspectInfo(found.suspect_info);
        setSeverity(found.severity);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'Could not load this case.'
        );
      } finally {
        if (active) setLoadingCase(false);
      }
    };

    loadCase();

    return () => {
      active = false;
    };
  }, [editingCaseId]);

  const categoryOptions = CATEGORIES.includes(category)
    ? CATEGORIES
    : [category, ...CATEGORIES];
  const platformOptions = PLATFORMS.includes(platform)
    ? PLATFORMS
    : [platform, ...PLATFORMS];

  const showSavedAlert = (
    localCaseId: string,
    cloudSynced: boolean,
    cloudError: string | null,
    closeEditor: boolean
  ) => {
    const detail = cloudSynced
      ? 'Saved to this device and synced to your account.'
      : cloudError
        ? `Saved on this device, but the account sync failed: ${cloudError}`
        : 'Saved to this device. Sign in to mirror cases to your account.';

    Alert.alert(
      cloudSynced ? 'Case Saved' : 'Saved Locally',
      detail,
      [
        {
          text: 'View Case',
          onPress: () => {
            if (closeEditor) {
              navigation.goBack();
            } else {
              navigation.replace('CaseDetail', { caseId: localCaseId });
            }
          },
        },
      ]
    );
  };

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
      if (isEditing) {
        if (!existingCase || !editingCaseId) {
          throw new Error('The original case could not be loaded.');
        }

        const result = await updateCaseWithCloud({
          ...existingCase,
          title,
          category,
          description,
          incident_date: incidentDate,
          incident_time: incidentTime,
          platform,
          suspect_info: suspectInfo,
          severity,
        });

        setExistingCase(result.localCase);
        showSavedAlert(
          result.localCase.id,
          result.cloudSynced,
          result.cloudError,
          true
        );
      } else {
        const result = await createCaseWithCloud({
          title,
          category,
          description,
          incident_date: incidentDate,
          incident_time: incidentTime,
          platform,
          suspect_info: suspectInfo,
          severity,
        });

        showSavedAlert(
          result.localCase.id,
          result.cloudSynced,
          result.cloudError,
          false
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save incident.';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingCase) {
    return (
      <ScreenWrapper>
        <Header
          title="Edit Incident"
          subtitle="Loading case details"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.teal} />
          <Text style={styles.loadingText}>Loading case details...</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <Header
        title={isEditing ? 'Edit Incident' : 'Report an Incident'}
        subtitle={
          isEditing
            ? 'Update case details'
            : 'Step 1 of Evidence Preservation'
        }
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
            Details are saved to your local vault first, then synced to your
            signed-in account when a connection is available.
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
          maxLength={200}
        />

        {/* Incident Category Selection */}
        <Text style={styles.fieldLabel}>Incident Category *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
        >
          {categoryOptions.map((cat) => {
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
          {platformOptions.map((plat) => {
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
          maxLength={20000}
          style={{ height: 100, textAlignVertical: 'top' }}
        />

        {/* Save Button */}
        <Button
          title={isEditing ? 'Save Case Changes' : 'Save Incident & Proceed'}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.secondaryText,
    fontSize: 14,
    marginTop: Spacing.sm,
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

