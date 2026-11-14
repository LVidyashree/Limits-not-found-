import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Colors } from '../theme';
import { useAuth } from '../context/AuthContext';

import { WelcomeVaultScreen } from '../screens/WelcomeVaultScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { CaseListScreen } from '../screens/CaseListScreen';
import { CaseDetailScreen } from '../screens/CaseDetailScreen';
import { CreateIncidentScreen } from '../screens/CreateIncidentScreen';
import { UploadEvidenceScreen } from '../screens/UploadEvidenceScreen';
import { EvidenceDetailScreen } from '../screens/EvidenceDetailScreen';
import { AnalysisScreen } from '../screens/AnalysisScreen';
import { TimelineScreen } from '../screens/TimelineScreen';
import { VerificationScreen } from '../screens/VerificationScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { TrustCentreScreen } from '../screens/TrustCentreScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const { session } = useAuth();
  const isAuthenticated = Boolean(session);

  return (
    <Stack.Navigator
      initialRouteName="WelcomeVault"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Public welcome / account screen is always available. */}
      <Stack.Screen name="WelcomeVault" component={WelcomeVaultScreen} />

      {/* Protected routes are only registered for authenticated users, so
          unauthenticated deep links or navigation calls cannot reach them. */}
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="CaseList" component={CaseListScreen} />
          <Stack.Screen name="CaseDetail" component={CaseDetailScreen} />
          <Stack.Screen name="CreateIncident" component={CreateIncidentScreen} />
          <Stack.Screen name="UploadEvidence" component={UploadEvidenceScreen} />
          <Stack.Screen name="EvidenceDetail" component={EvidenceDetailScreen} />
          <Stack.Screen name="Analysis" component={AnalysisScreen} />
          <Stack.Screen name="Timeline" component={TimelineScreen} />
          <Stack.Screen name="Verification" component={VerificationScreen} />
          <Stack.Screen name="Report" component={ReportScreen} />
          <Stack.Screen name="TrustCentre" component={TrustCentreScreen} />
        </>
      ) : null}
    </Stack.Navigator>
  );
};
