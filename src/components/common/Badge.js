import React, {memo} from 'react';
import {View, Text, StyleSheet} from 'react-native';

const Badge = memo(({label, variant = 'default'}) => {
  const getVariantStyle = () => {
    switch (variant) {
      case 'high':
        return styles.high;
      case 'medium':
        return styles.medium;
      case 'low':
        return styles.low;
      case 'pending':
        return styles.pending;
      case 'done':
        return styles.done;
      default:
        return styles.default;
    }
  };

  return (
    <View style={[styles.badge, getVariantStyle()]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  high: {
    backgroundColor: '#FF3B30',
  },
  medium: {
    backgroundColor: '#FF9500',
  },
  low: {
    backgroundColor: '#34C759',
  },
  pending: {
    backgroundColor: '#FF9500',
  },
  done: {
    backgroundColor: '#34C759',
  },
  default: {
    backgroundColor: '#8E8E93',
  },
});

Badge.displayName = 'Badge';

export default Badge;
