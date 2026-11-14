import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
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
import { useAuth } from '../context/AuthContext';
import {
  getAuthErrorMessage,
  isValidEmail,
} from '../services/authServiceCore';

type Props = NativeStackScreenProps<RootStackParamList, 'WelcomeVault'>;
type AuthMode = 'signin' | 'signup' | 'reset';

const MIN_PASSWORD_LENGTH = 8;

export const WelcomeVaultScreen: React.FC<Props> = ({ navigation }) => {
  const {
    session,
    user,
    configError,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    completeRecovery,
  } = useAuth();

  const isSignedIn = Boolean(session);
  const accountEmail = user?.email ?? '';

  // Local vault state
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Supabase account state
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetRequested, setResetRequested] = useState(false);

  const biometricPrompted = useRef(false);

  useEffect(() => {
    let active = true;

    const loadVaultState = async () => {
      const [initialized, biometricsSupported, biometricsActive] = await Promise.all([
        isVaultInitialized(),
        isBiometricsSupported(),
        isBiometricsEnabled(),
      ]);
      if (!active) return;
      setIsInitialized(initialized);
      setHasBiometrics(biometricsSupported);
      setEnableBiometrics(biometricsActive);
      setLoading(false);
    };

    loadVaultState();
    return () => {
      active = false;
    };
  }, []);

  const handleBiometricUnlock = useCallback(async () => {
    if (!isSignedIn) return;
    const success = await authenticateWithBiometrics();
    if (success) {
      navigation.replace('Dashboard');
    }
  }, [isSignedIn, navigation]);

  // Prompt biometrics only after the account session is restored/present.
  useEffect(() => {
    if (!isSignedIn) {
      biometricPrompted.current = false;
      return;
    }
    if (
      isInitialized &&
      hasBiometrics &&
      enableBiometrics &&
      !biometricPrompted.current
    ) {
      biometricPrompted.current = true;
      handleBiometricUnlock();
    }
  }, [isSignedIn, isInitialized, hasBiometrics, enableBiometrics, handleBiometricUnlock]);

  const clearAuthMessages = () => {
    setAuthError('');
    setAuthInfo('');
  };

  const switchAuthMode = (mode: AuthMode) => {
    setAuthMode(mode);
    clearAuthMessages();
    setPassword('');
    setConfirmPassword('');
    if (mode !== 'reset') {
      setRecoveryInput('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetRequested(false);
    }
  };

  const handleSignIn = async () => {
    clearAuthMessages();
    if (!isValidEmail(email)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setAuthError('Please enter your password.');
      return;
    }

    setAuthLoading(true);
    try {
      await signIn(email, password);
      setPassword('');
    } catch (err) {
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async () => {
    clearAuthMessages();
    if (!isValidEmail(email)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setAuthLoading(true);
    try {
      const result = await signUp(email, password);
      setPassword('');
      setConfirmPassword('');
      if (result.needsEmailConfirmation) {
        setAuthInfo(
          'Account created. Check your email to confirm your address, then sign in.'
        );
        setAuthMode('signin');
      }
    } catch (err) {
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRequestReset = async () => {
    clearAuthMessages();
    if (!isValidEmail(email)) {
      setAuthError('Please enter the email address for your account.');
      return;
    }

    setAuthLoading(true);
    try {
      await requestPasswordReset(email);
      setResetRequested(true);
      setAuthInfo(
        'If an account exists for this email, a recovery email has been sent. Open it and paste the code or the full link below.'
      );
    } catch (err) {
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCompleteReset = async () => {
    clearAuthMessages();
    if (!isValidEmail(email)) {
      setAuthError('Please enter the email address for your account.');
      return;
    }
    if (!recoveryInput.trim()) {
      setAuthError(
        'Enter the recovery code from the email, or paste the full recovery link.'
      );
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setAuthError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setAuthError('New passwords do not match.');
      return;
    }

    setAuthLoading(true);
    try {
      await completeRecovery(email, recoveryInput, newPassword);
      setRecoveryInput('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetRequested(false);
      setAuthMode('signin');
      setAuthInfo('Password updated. Sign in with your new password.');
    } catch (err) {
      setAuthError(getAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Your local evidence and vault passphrase stay on this device. You will need to sign in again to open the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (err) {
              Alert.alert('Sign Out Error', getAuthErrorMessage(err));
            }
          },
        },
      ]
    );
  };

  const handleCreateVault = async () => {
    setErrorMsg('');
    if (!isSignedIn) {
      setAuthError('Sign in to create your local vault.');
      return;
    }

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
        'Your local vault is protected by a salted cryptographic hash. Your vault passphrase is separate from your account password and is never sent to Supabase. There is no recovery for the vault passphrase, so store it safely.',
        [{ text: 'Enter Vault', onPress: () => navigation.replace('Dashboard') }]
      );
    } else {
      setErrorMsg('Failed to initialize secure vault');
    }
  };

  const handleUnlockVault = async () => {
    setErrorMsg('');
    if (!isSignedIn) {
      setAuthError('Sign in to unlock your local vault.');
      return;
    }
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
    clearAuthMessages();
    if (!isSignedIn) {
      setAuthMode('signup');
      setAuthError('Create an account or sign in to launch the demo case.');
      return;
    }

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

  const authTitle =
    authMode === 'signin'
      ? 'Sign In to Your Account'
      : authMode === 'signup'
        ? 'Create Your Account'
        : 'Reset Account Password';

  const authSubtitle =
    authMode === 'signin'
      ? 'Access your account with Supabase Auth. Your vault passphrase is asked for separately.'
      : authMode === 'signup'
        ? 'Create a Supabase account. Use a password different from your local vault passphrase.'
        : 'Recover your account password by email. This does not change your local vault passphrase.';

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

        {!isSignedIn ? (
          <>
            {/* Privacy Notice */}
            <Card style={styles.privacyCard}>
              <View style={styles.privacyHeader}>
                <Ionicons name="lock-closed" size={16} color={Colors.teal} />
                <Text style={styles.privacyTitle}>Evidence Stays On This Device</Text>
              </View>
              <Text style={styles.privacyText}>
                Supabase Auth handles only your account email and password. Evidence files,
                the SQLite database, and your vault passphrase never leave this device.
                Account sign-in by itself does not encrypt your evidence.
              </Text>
            </Card>

            {/* Account auth card */}
            <Card style={styles.authCard}>
              <Text style={styles.formTitle}>{authTitle}</Text>
              <Text style={styles.formSubtitle}>{authSubtitle}</Text>

              {authMode !== 'reset' && (
                <View style={styles.authTabs}>
                  <TouchableOpacity
                    style={[
                      styles.authTab,
                      authMode === 'signin' && styles.authTabActive,
                    ]}
                    onPress={() => switchAuthMode('signin')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.authTabText,
                        authMode === 'signin' && styles.authTabTextActive,
                      ]}
                    >
                      Sign In
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.authTab,
                      authMode === 'signup' && styles.authTabActive,
                    ]}
                    onPress={() => switchAuthMode('signup')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.authTabText,
                        authMode === 'signup' && styles.authTabTextActive,
                      ]}
                    >
                      Create Account
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {configError ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                  <Text style={styles.errorBannerText}>{configError}</Text>
                </View>
              ) : null}

              <Input
                label="Email Address"
                placeholder="you@example.com"
                value={email}
                onChangeText={(txt) => {
                  setEmail(txt);
                  clearAuthMessages();
                }}
                icon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
              />

              {authMode !== 'reset' && (
                <Input
                  label="Account Password"
                  placeholder="Enter account password..."
                  secureTextEntry={!showAuthPassword}
                  value={password}
                  onChangeText={(txt) => {
                    setPassword(txt);
                    clearAuthMessages();
                  }}
                  icon="lock-closed-outline"
                  autoCapitalize="none"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                />
              )}

              {authMode === 'signup' && (
                <Input
                  label="Confirm Account Password"
                  placeholder="Re-enter account password..."
                  secureTextEntry={!showAuthPassword}
                  value={confirmPassword}
                  onChangeText={(txt) => {
                    setConfirmPassword(txt);
                    clearAuthMessages();
                  }}
                  icon="checkmark-circle-outline"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  helper={`At least ${MIN_PASSWORD_LENGTH} characters. Use a password different from your vault passphrase.`}
                />
              )}

              {authMode === 'reset' && resetRequested && (
                <>
                  <Input
                    label="Recovery Code or Link"
                    placeholder="Paste the code or the full link from the email"
                    value={recoveryInput}
                    onChangeText={(txt) => {
                      setRecoveryInput(txt);
                      clearAuthMessages();
                    }}
                    icon="key-outline"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Input
                    label="New Account Password"
                    placeholder="Enter a new password..."
                    secureTextEntry={!showAuthPassword}
                    value={newPassword}
                    onChangeText={(txt) => {
                      setNewPassword(txt);
                      clearAuthMessages();
                    }}
                    icon="lock-open-outline"
                    autoCapitalize="none"
                    autoComplete="new-password"
                  />

                  <Input
                    label="Confirm New Password"
                    placeholder="Re-enter the new password..."
                    secureTextEntry={!showAuthPassword}
                    value={confirmNewPassword}
                    onChangeText={(txt) => {
                      setConfirmNewPassword(txt);
                      clearAuthMessages();
                    }}
                    icon="checkmark-circle-outline"
                    autoCapitalize="none"
                    autoComplete="new-password"
                  />
                </>
              )}

              {authMode !== 'reset' && (
                <TouchableOpacity
                  style={styles.toggleRow}
                  onPress={() => setShowAuthPassword(!showAuthPassword)}
                >
                  <Ionicons
                    name={showAuthPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={16}
                    color={Colors.secondaryText}
                  />
                  <Text style={styles.toggleText}>
                    {showAuthPassword ? 'Hide Password' : 'Show Password'}
                  </Text>
                </TouchableOpacity>
              )}

              {authInfo ? (
                <View style={styles.infoBanner}>
                  <Ionicons name="information-circle" size={16} color={Colors.teal} />
                  <Text style={styles.infoBannerText}>{authInfo}</Text>
                </View>
              ) : null}

              {authError ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                  <Text style={styles.errorBannerText}>{authError}</Text>
                </View>
              ) : null}

              {authMode === 'signin' && (
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => switchAuthMode('reset')}
                >
                  <Text style={styles.linkText}>Forgot password?</Text>
                </TouchableOpacity>
              )}

              {authMode === 'reset' && (
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => switchAuthMode('signin')}
                >
                  <Text style={styles.linkText}>Back to sign in</Text>
                </TouchableOpacity>
              )}

              {authMode === 'signin' && (
                <Button
                  title="Sign In"
                  onPress={handleSignIn}
                  loading={authLoading}
                  disabled={Boolean(configError)}
                  variant="primary"
                  icon="log-in-outline"
                  style={{ marginTop: Spacing.sm }}
                />
              )}

              {authMode === 'signup' && (
                <Button
                  title="Create Account"
                  onPress={handleSignUp}
                  loading={authLoading}
                  disabled={Boolean(configError)}
                  variant="primary"
                  icon="person-add-outline"
                  style={{ marginTop: Spacing.sm }}
                />
              )}

              {authMode === 'reset' && !resetRequested && (
                <Button
                  title="Send Recovery Email"
                  onPress={handleRequestReset}
                  loading={authLoading}
                  disabled={Boolean(configError)}
                  variant="primary"
                  icon="mail-outline"
                  style={{ marginTop: Spacing.sm }}
                />
              )}

              {authMode === 'reset' && resetRequested && (
                <>
                  <Button
                    title="Update Password"
                    onPress={handleCompleteReset}
                    loading={authLoading}
                    variant="primary"
                    icon="checkmark-done-outline"
                    style={{ marginTop: Spacing.sm }}
                  />
                  <Button
                    title="Resend Recovery Email"
                    onPress={handleRequestReset}
                    loading={authLoading}
                    variant="outline"
                    icon="refresh-outline"
                    size="sm"
                    style={{ marginTop: Spacing.sm }}
                  />
                </>
              )}
            </Card>
          </>
        ) : (
          <>
            {/* Account status */}
            <Card style={styles.accountCard}>
              <View style={styles.accountRow}>
                <View style={styles.accountIcon}>
                  <Ionicons
                    name="person-circle-outline"
                    size={22}
                    color={Colors.teal}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountLabel}>SIGNED IN</Text>
                  <Text style={styles.accountEmail} numberOfLines={1}>
                    {accountEmail || 'Authenticated account'}
                  </Text>
                </View>
                <Badge
                  label={user?.emailConfirmed ? 'VERIFIED' : 'PENDING'}
                  type={user?.emailConfirmed ? 'success' : 'warning'}
                />
              </View>
              <Text style={styles.accountNote}>
                Your vault passphrase is separate from your account password and is
                never sent to Supabase.
              </Text>
              <Button
                title="Sign Out"
                onPress={handleSignOut}
                variant="outline"
                icon="log-out-outline"
                size="sm"
              />
            </Card>

            {loading ? (
              <Card style={styles.loadingCard}>
                <ActivityIndicator color={Colors.teal} />
                <Text style={styles.loadingText}>Checking local vault...</Text>
              </Card>
            ) : (
              /* Local vault card (unchanged flow) */
              <Card style={styles.authCard}>
                <Text style={styles.formTitle}>
                  {isInitialized ? 'Unlock Secure Vault' : 'Create Your Vault'}
                </Text>
                <Text style={styles.formSubtitle}>
                  {isInitialized
                    ? 'Enter your master passphrase to open your evidence records.'
                    : 'Choose a strong master passphrase to seal your local evidence storage. It is not sent to Supabase.'}
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
                  autoCapitalize="none"
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
                      autoCapitalize="none"
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

                <Button
                  title={isInitialized ? 'Unlock Vault' : 'Initialize Vault'}
                  onPress={isInitialized ? handleUnlockVault : handleCreateVault}
                  loading={actionLoading}
                  variant="primary"
                  icon={isInitialized ? 'lock-open-outline' : 'shield-outline'}
                  style={{ marginTop: Spacing.md }}
                />

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
            )}
          </>
        )}

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
            loading={actionLoading}
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
  authTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    marginBottom: Spacing.md,
  },
  authTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  authTabActive: {
    backgroundColor: Colors.tealMuted,
  },
  authTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.secondaryText,
  },
  authTabTextActive: {
    color: Colors.tealLight,
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealMuted,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  infoBannerText: {
    color: Colors.tealLight,
    fontSize: 12,
    marginLeft: 6,
    flex: 1,
  },
  linkRow: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.sm,
  },
  linkText: {
    color: Colors.teal,
    fontSize: 12,
    fontWeight: '600',
  },
  accountCard: {
    backgroundColor: Colors.secondaryBackground,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  accountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.teal,
    letterSpacing: 1,
  },
  accountEmail: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
    marginTop: 2,
  },
  accountNote: {
    fontSize: 11,
    color: Colors.secondaryText,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    marginBottom: Spacing.md,
  },
  loadingText: {
    marginTop: Spacing.sm,
    color: Colors.secondaryText,
    fontSize: 12,
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
