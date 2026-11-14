export const Colors = {
  // Brand colors requested by user
  background: '#101827',
  secondaryBackground: '#172338',
  card: '#1E2C40',
  teal: '#45A3A0',
  blue: '#176B87',
  white: '#FFFFFF',
  secondaryText: '#AAB6C5',

  // Accent & functional colors
  border: '#283B54',
  borderLight: '#394E6B',
  borderTeal: 'rgba(69, 163, 160, 0.4)',
  
  tealLight: '#5EC0BD',
  tealMuted: 'rgba(69, 163, 160, 0.15)',
  blueMuted: 'rgba(23, 107, 135, 0.25)',

  // Alerts & status
  success: '#10B981',
  successMuted: 'rgba(16, 185, 129, 0.15)',
  warning: '#F59E0B',
  warningMuted: 'rgba(245, 158, 11, 0.15)',
  danger: '#EF4444',
  dangerMuted: 'rgba(239, 68, 68, 0.15)',
  info: '#3B82F6',
  infoMuted: 'rgba(59, 130, 246, 0.15)',

  // Overlays
  overlay: 'rgba(16, 24, 39, 0.85)',
  inputBackground: '#131F33',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const Typography = {
  titleLarge: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.white,
    letterSpacing: 0.3,
  },
  titleMedium: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.white,
    letterSpacing: 0.2,
  },
  titleSmall: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.white,
  },
  body: {
    fontSize: 14,
    color: Colors.secondaryText,
    lineHeight: 20,
  },
  bodyLight: {
    fontSize: 14,
    color: Colors.white,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    color: Colors.secondaryText,
  },
  mono: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: Colors.teal,
    letterSpacing: 0.5,
  },
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

