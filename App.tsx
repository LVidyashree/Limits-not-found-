import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation';
import { Colors } from './src/theme';
import { getDatabase } from './src/services/database';
import { initStorage } from './src/services/storage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const prepareVault = async () => {
      try {
        await initStorage();
        await getDatabase();
        setReady(true);
      } catch (err) {
        console.error('Vault initialization error:', err);
        setInitError(String(err));
        setReady(true);
      }
    };

    prepareVault();
  }, []);

  if (!ready) {
    return (
      <View style={styles.splashContainer}>
        <ActivityIndicator size="large" color={Colors.teal} />
        <Text style={styles.splashText}>Initializing Offline Vault...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    marginTop: 16,
    color: Colors.secondaryText,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
