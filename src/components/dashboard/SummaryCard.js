import React, {memo} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

const SummaryCard = memo(({type, count, label}) => {
  const isPending = type === 'pending';
  const iconName = isPending ? 'alert-circle' : 'checkmark-circle';
  const backgroundColor = isPending ? '#FFE5E5' : '#E5F5E5';
  const iconColor = isPending ? '#FF3B30' : '#34C759';
  const textColor = isPending ? '#FF3B30' : '#34C759';

  return (
    <View style={[styles.card, {backgroundColor}]}>
      <View style={[styles.iconContainer, {backgroundColor: iconColor}]}>
        <Ionicons name={iconName} size={24} color="#FFFFFF" />
      </View>
      <Text style={[styles.label, {color: textColor}]}>{label}</Text>
      <Text style={[styles.count, {color: textColor}]}>{count}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 6,
    minHeight: 120,
    justifyContent: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  count: {
    fontSize: 32,
    fontWeight: 'bold',
  },
});

SummaryCard.displayName = 'SummaryCard';

export default SummaryCard;
