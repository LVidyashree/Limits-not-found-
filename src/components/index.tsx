import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  TextInputProps,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, BorderRadius } from '../theme';

// ======================== SCREEN WRAPPER ========================
interface ScreenWrapperProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ children, style }) => {
  return (
    <SafeAreaView style={[styles.screenWrapper, style]}>
      <StatusBar barStyle="light-content" />
      {children}
    </SafeAreaView>
  );
};

// ======================== APP HEADER ========================
interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    color?: string;
  };
  showBranding?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightAction,
  showBranding = false,
}) => {
  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerLeft}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
        ) : showBranding ? (
          <View style={styles.shieldIconContainer}>
            <Ionicons name="shield-checkmark" size={20} color={Colors.teal} />
          </View>
        ) : null}

        <View style={styles.titleColumn}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {rightAction && (
        <TouchableOpacity
          style={styles.headerRightAction}
          onPress={rightAction.onPress}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={rightAction.icon}
            size={22}
            color={rightAction.color || Colors.teal}
          />
        </TouchableOpacity>
      )}
    </View>
  );
};

// ======================== CYBER CARD ========================
interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  borderColor?: string;
  variant?: 'normal' | 'highlight' | 'danger';
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  onPress,
  borderColor,
  variant = 'normal',
}) => {
  const getBorder = () => {
    if (borderColor) return borderColor;
    if (variant === 'highlight') return Colors.teal;
    if (variant === 'danger') return Colors.danger;
    return Colors.border;
  };

  const content = (
    <View
      style={[
        styles.card,
        { borderColor: getBorder() },
        variant === 'highlight' && styles.cardHighlight,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

// ======================== BUTTON ========================
interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
  textStyle,
  size = 'md',
}) => {
  const getContainerStyle = () => {
    switch (variant) {
      case 'primary':
        return [styles.btnPrimary, disabled && styles.btnDisabled];
      case 'secondary':
        return [styles.btnSecondary, disabled && styles.btnDisabled];
      case 'outline':
        return [styles.btnOutline, disabled && styles.btnDisabled];
      case 'danger':
        return [styles.btnDanger, disabled && styles.btnDisabled];
      case 'ghost':
        return [styles.btnGhost, disabled && styles.btnDisabled];
    }
  };

  const getTextColor = () => {
    if (disabled) return Colors.secondaryText;
    switch (variant) {
      case 'primary':
        return Colors.white;
      case 'secondary':
        return Colors.white;
      case 'outline':
        return Colors.teal;
      case 'danger':
        return Colors.white;
      case 'ghost':
        return Colors.secondaryText;
    }
  };

  const getPadding = () => {
    if (size === 'sm') return { paddingVertical: 8, paddingHorizontal: 12 };
    if (size === 'lg') return { paddingVertical: 16, paddingHorizontal: 24 };
    return { paddingVertical: 12, paddingHorizontal: 18 };
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.btnBase, getContainerStyle(), getPadding(), style]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <View style={styles.btnInner}>
          {icon && (
            <Ionicons
              name={icon}
              size={size === 'sm' ? 16 : 18}
              color={getTextColor()}
              style={{ marginRight: 8 }}
            />
          )}
          <Text
            style={[
              styles.btnText,
              { color: getTextColor() },
              size === 'sm' && { fontSize: 13 },
              size === 'lg' && { fontSize: 16 },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// ======================== BADGE ========================
interface BadgeProps {
  label: string;
  type?: 'teal' | 'success' | 'warning' | 'danger' | 'info' | 'demo';
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  type = 'teal',
  icon,
  style,
}) => {
  const getBadgeStyle = () => {
    switch (type) {
      case 'success':
        return { bg: Colors.successMuted, text: Colors.success, border: Colors.success };
      case 'warning':
        return { bg: Colors.warningMuted, text: Colors.warning, border: Colors.warning };
      case 'danger':
        return { bg: Colors.dangerMuted, text: Colors.danger, border: Colors.danger };
      case 'info':
        return { bg: Colors.infoMuted, text: Colors.info, border: Colors.info };
      case 'demo':
        return { bg: '#342614', text: '#FBBF24', border: '#F59E0B' };
      default:
        return { bg: Colors.tealMuted, text: Colors.teal, border: Colors.teal };
    }
  };

  const conf = getBadgeStyle();

  return (
    <View
      style={[
        styles.badgeContainer,
        { backgroundColor: conf.bg, borderColor: conf.border },
        style,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={12}
          color={conf.text}
          style={{ marginRight: 4 }}
        />
      )}
      <Text style={[styles.badgeText, { color: conf.text }]}>{label}</Text>
    </View>
  );
};

// ======================== INPUT ========================
interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helper,
  icon,
  style,
  ...props
}) => {
  return (
    <View style={styles.inputContainer}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          error ? { borderColor: Colors.danger } : null,
        ]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={18}
            color={Colors.secondaryText}
            style={styles.inputIcon}
          />
        )}
        <TextInput
          placeholderTextColor={Colors.secondaryText}
          style={[styles.textInput, icon ? { paddingLeft: 0 } : null, style]}
          {...props}
        />
      </View>
      {error ? (
        <Text style={styles.inputError}>{error}</Text>
      ) : helper ? (
        <Text style={styles.inputHelper}>{helper}</Text>
      ) : null}
    </View>
  );
};

// ======================== EMPTY STATE ========================
interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  actionTitle?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionTitle,
  onAction,
}) => {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={36} color={Colors.teal} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionTitle && onAction && (
        <Button
          title={actionTitle}
          onPress={onAction}
          variant="outline"
          size="sm"
          style={{ marginTop: Spacing.md }}
        />
      )}
    </View>
  );
};

// ======================== SECTION HEADER ========================
interface SectionHeaderProps {
  title: string;
  actionText?: string;
  onAction?: () => void;
  badge?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  actionText,
  onAction,
  badge,
}) => {
  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
        {badge && <Badge label={badge} type="teal" style={{ marginLeft: 8 }} />}
      </View>
      {actionText && onAction && (
        <TouchableOpacity activeOpacity={0.7} onPress={onAction}>
          <Text style={styles.sectionHeaderAction}>{actionText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// ======================== STYLES ========================
const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    marginRight: Spacing.sm,
    padding: 4,
  },
  shieldIconContainer: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.secondaryBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderTeal,
  },
  titleColumn: {
    flex: 1,
  },
  headerTitle: {
    ...Typography.titleMedium,
  },
  headerSubtitle: {
    ...Typography.caption,
    marginTop: 1,
  },
  headerRightAction: {
    padding: 6,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.secondaryBackground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  cardHighlight: {
    borderLeftWidth: 4,
  },
  btnBase: {
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: Colors.teal,
  },
  btnSecondary: {
    backgroundColor: Colors.blue,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.teal,
  },
  btnDanger: {
    backgroundColor: Colors.danger,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    borderWidth: 0.8,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  inputContainer: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    color: Colors.white,
    fontSize: 14,
    paddingVertical: 12,
  },
  inputError: {
    color: Colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  inputHelper: {
    color: Colors.secondaryText,
    fontSize: 12,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  emptyIconCircle: {
    width: 70,
    height: 70,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.secondaryBackground,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderTeal,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Typography.titleSmall,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDescription: {
    ...Typography.body,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeaderTitle: {
    ...Typography.titleSmall,
  },
  sectionHeaderAction: {
    color: Colors.teal,
    fontSize: 13,
    fontWeight: '600',
  },
});
