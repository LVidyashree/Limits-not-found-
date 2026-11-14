// Pure route-access rules shared by the navigator and unit tests.

export const PUBLIC_SCREENS = ['WelcomeVault'] as const;

export const PROTECTED_SCREENS = [
  'Dashboard',
  'CaseList',
  'CaseDetail',
  'CreateIncident',
  'UploadEvidence',
  'EvidenceDetail',
  'Analysis',
  'Timeline',
  'Verification',
  'Report',
  'TrustCentre',
] as const;

export type PublicScreen = (typeof PUBLIC_SCREENS)[number];
export type ProtectedScreen = (typeof PROTECTED_SCREENS)[number];
export type AppScreen = PublicScreen | ProtectedScreen;

export const getRegisteredScreens = (
  isAuthenticated: boolean
): readonly AppScreen[] =>
  isAuthenticated
    ? ([...PUBLIC_SCREENS, ...PROTECTED_SCREENS] as AppScreen[])
    : (PUBLIC_SCREENS as readonly AppScreen[]);

export const isProtectedScreen = (screen: AppScreen): screen is ProtectedScreen =>
  (PROTECTED_SCREENS as readonly AppScreen[]).includes(screen);

export const canAccessScreen = (
  screen: AppScreen,
  isAuthenticated: boolean
): boolean => !isProtectedScreen(screen) || isAuthenticated;
