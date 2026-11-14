import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';
import { ScreenWrapper, Card, Button, Input, Badge } from '../components';
import {
  isVaultInitialized,
  setupVaultPassphrase,
  verifyPassphrase,
  isBiometricsSupported,
  isBiometricsEnabled,
  authenticateWithBiometrics,
  checkPassphraseStrength,
} from '../services/security';
import { createDemoCaseIfNotExists } from '../services/demoData';

type Props = NativeStackScreenProps<RootStackParamList, 'WelcomeVault'>;

export const WelcomeVaultScreen: React.FC<Props> = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  // Form states
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    checkInitialState();
  }, []);

  const checkInitialState = async () => {
    setLoading(true);
    const initialized = await isVaultInitialized();
    const biometricsSupported = await isBiometricsSupported();
    const biometricsActive = await isBiometricsEnabled();

    setIsInitialized(initialized);
    setHasBiometrics(biometricsSupported);
    setEnableBiometrics(biometricsActive);
    setLoading(false);

    // If returning user and biometrics enabled, prompt biometric unlock immediately
    if (initialized && biometricsActive) {
      handleBiometricUnlock();
    }
  };

  const handleBiometricUnlock = async () => {
    const success = await authenticateWithBiometrics();
    if (success) {
      navigation.replace('Dashboard');
    }
  };

  const handleCreateVault = async () => {
    setErrorMsg('');
    const strength = checkPassphraseStrength(passphrase);
    if (!strength.isValid) {
      setErrorMsg(strength.feedback[0] || 'Passphrase is too weak');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setErrorMsg('Passphrases do not match');
      return;
    }

    setActionLoading(true);
    const success = await setupVaultPassphrase(passphrase, enableBiometrics);
    setActionLoading(false);

    if (success) {
      Alert.alert(
        'Vault Created Successfully',
        'Your local vault is initialized with salted cryptographic protection. Remember your passphrase: there are NO cloud backdoors or recovery servers.',
        [{ text: 'Enter Vault', onPress: () => navigation.replace('Dashboard') }]
      );
    } else {
      setErrorMsg('Failed to initialize secure vault');
    }
  };

  const handleUnlockVault = async () => {
    setErrorMsg('');
    if (!passphrase) {
      setErrorMsg('Please enter your vault passphrase');
      return;
    }

    setActionLoading(true);
    const matches = await verifyPassphrase(passphrase);
    setActionLoading(false);

    if (matches) {
      navigation.replace('Dashboard');
    } else {
      setErrorMsg('Incorrect passphrase. Access denied.');
    }
  };

  const handleQuickDemo = async () => {
    setActionLoading(true);
    try {
      // If not initialized, setup default demo vault
      if (!isInitialized) {
        await setupVaultPassphrase('EvidenceVaultDemo2026!', false);
      }
      await createDemoCaseIfNotExists();
      navigation.replace('Dashboard');
    } catch (err) {
      Alert.alert('Demo Error', 'Could not initialize demo case: ' + String(err));
    } finally {
      setActionLoading(false);
    }
  };

  const strength = checkPassphraseStrength(passphrase);

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Branding header */}
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="shield-checkmark" size={38} color={Colors.teal} />
          </View>
          <Text style={styles.brandTitle}>EVIDENCEVAULT</Text>
          <Text style={styles.brandTagline}>
            YOUR EVIDENCE. YOUR CONTROL. AI-ASSISTED CLARITY.
          </Text>
        </View>

        {/* Security Notice Card */}
        <Card style={styles.privacyCard}>
          <View style={styles.privacyHeader}>
            <Ionicons name="lock-closed" size={16} color={Colors.teal} />
            <Text style={styles.privacyTitle}>100% Offline & Private</Text>
          </View>
          <Text style={styles.privacyText}>
            All evidence files, SQLite database tables, and cryptographic hashes
            are preserved strictly on this physical device. No telemetry, no
            cloud databases, and zero external tracking.
          </Text>
        </Card>

        {/* Main Vault Form */}
        <Card style={styles.authCard}>
          <Text style={styles.formTitle}>
            {isInitialized ? 'Unlock Secure Vault' : 'Create Your Vault'}
          </Text>
          <Text style={styles.formSubtitle}>
            {isInitialized
              ? 'Enter your master passphrase to decrypt and access your evidence records.'
              : 'Choose a strong master passphrase to seal your evidence storage.'}
          </Text>

          <Input
            label={isInitialized ? 'Master Passphrase' : 'New Master Passphrase'}
            placeholder="Enter passphrase..."
            secureTextEntry={!showPassphrase}
            value={passphrase}
            onChangeText={(txt) => {
              setPassphrase(txt);
              setErrorMsg('');
            }}
            icon="key-outline"
          />

          {!isInitialized && (
            <>
              {/* Strength Meter */}
              {passphrase.length > 0 && (
                <View style={styles.strengthContainer}>
                  <View style={styles.strengthBarRow}>
                    {[1, 2, 3, 4].map((step) => (
                      <View
                        key={step}
                        style={[
                          styles.strengthBar,
                          step <= strength.score
                            ? {
                                backgroundColor:
                                  strength.score >= 3
                                    ? Colors.success
                                    : Colors.warning,
                              }
                            : { backgroundColor: Colors.border },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={styles.strengthText}>
                    Strength: {strength.score >= 3 ? 'Strong' : 'Weak'}
                  </Text>
                </View>
              )}

              <Input
                label="Confirm Passphrase"
                placeholder="Re-enter passphrase..."
                secureTextEntry={!showPassphrase}
                value={confirmPassphrase}
                onChangeText={(txt) => {
                  setConfirmPassphrase(txt);
                  setErrorMsg('');
                }}
                icon="checkmark-circle-outline"
              />
            </>
          )}

          {/* Show / Hide Toggle */}
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setShowPassphrase(!showPassphrase)}
          >
            <Ionicons
              name={showPassphrase ? 'eye-off-outline' : 'eye-outline'}
              size={16}
              color={Colors.secondaryText}
            />
            <Text style={styles.toggleText}>
              {showPassphrase ? 'Hide Passphrase' : 'Show Passphrase'}
            </Text>
          </TouchableOpacity>

          {/* Biometrics Toggle for new setups */}
          {!isInitialized && hasBiometrics && (
            <View style={styles.biometricRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.biometricLabel}>Enable Biometric Unlock</Text>
                <Text style={styles.biometricSub}>
                  Use fingerprint or face recognition for faster access
                </Text>
              </View>
              <Switch
                value={enableBiometrics}
                onValueChange={setEnableBiometrics}
                trackColor={{ false: Colors.border, true: Colors.teal }}
                thumbColor={Colors.white}
              />
            </View>
          )}

          {errorMsg ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={Colors.danger} />
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Primary Action Button */}
          <Button
            title={isInitialized ? 'Unlock Vault' : 'Initialize Vault'}
            onPress={isInitialized ? handleUnlockVault : handleCreateVault}
            loading={actionLoading}
            variant="primary"
            icon={isInitialized ? 'lock-open-outline' : 'shield-outline'}
            style={{ marginTop: Spacing.md }}
          />

          {/* Biometrics Button for existing vault */}
          {isInitialized && hasBiometrics && (
            <Button
              title="Unlock with Biometrics"
              onPress={handleBiometricUnlock}
              variant="outline"
              icon="finger-print-outline"
              style={{ marginTop: Spacing.sm }}
            />
          )}
        </Card>

        {/* Explore Demo Case */}
        <Card style={styles.demoCard}>
          <View style={styles.demoHeader}>
            <Badge label="DEMO MODE" type="demo" />
            <Text style={styles.demoTitle}>Want to see how it works?</Text>
          </View>
          <Text style={styles.demoDesc}>
            Load an interactive payment fraud simulation with sample extortion
            chat, bank payment receipt, SHA-256 hashes, and extracted findings.
          </Text>
          <Button
            title="Launch Fictional Demo Case"
            onPress={handleQuickDemo}
            variant="secondary"
            icon="play-circle-outline"
            size="sm"
            style={{ marginTop: Spacing.sm }}
          />
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
  brandContainer: {
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.secondaryBackground,
    borderWidth: 2,
    borderColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  brandTitle: {
    ...Typography.titleLarge,
    letterSpacing: 2,
    textAlign: 'center',
  },
  brandTagline: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.teal,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: 4,
  },
  privacyCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  privacyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
    marginLeft: 6,
  },
  privacyText: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 18,
  },
  authCard: {
    marginBottom: Spacing.md,
  },
  formTitle: {
    ...Typography.titleMedium,
    marginBottom: 4,
  },
  formSubtitle: {
    ...Typography.body,
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  strengthContainer: {
    marginBottom: Spacing.sm,
  },
  strengthBarRow: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  strengthBar: {
    flex: 1,
    marginRight: 4,
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    alignSelf: 'flex-start',
  },
  toggleText: {
    fontSize: 12,
    color: Colors.secondaryText,
    marginLeft: 6,
  },
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  biometricLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  biometricSub: {
    fontSize: 11,
    color: Colors.secondaryText,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dangerMuted,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  errorBannerText: {
    color: Colors.danger,
    fontSize: 12,
    marginLeft: 6,
    flex: 1,
  },
  demoCard: {
    backgroundColor: '#1E2533',
    borderColor: '#785A1D',
  },
  demoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  demoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
  demoDesc: {
    fontSize: 12,
    color: Colors.secondaryText,
    lineHeight: 17,
  },
});

