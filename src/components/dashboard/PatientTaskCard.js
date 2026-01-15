import React, {memo} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Badge from '../common/Badge';

const PatientTaskCard = memo(({task, onPress}) => {
  const {patientName, taskDescription, scheduledTime, emergencyLevel, status} = task;

  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={styles.iconContainer}>
        <Ionicons name="pulse" size={24} color="#007AFF" />
      </View>
      
      <View style={styles.content}>
        <Text style={styles.patientName}>{patientName}</Text>
        <Text style={styles.taskDescription}>{taskDescription}</Text>
        <Text style={styles.scheduledTime}>{scheduledTime}</Text>
      </View>

      <View style={styles.badgesContainer}>
        {emergencyLevel && (
          <Badge label={emergencyLevel} variant={emergencyLevel.toLowerCase()} />
        )}
        {emergencyLevel && status && <View style={styles.badgeSpacing} />}
        {status && (
          <Badge label={status} variant={status.toLowerCase()} />
        )}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E5F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  taskDescription: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  scheduledTime: {
    fontSize: 12,
    color: '#999999',
  },
  badgesContainer: {
    alignItems: 'flex-end',
  },
  badgeSpacing: {
    height: 4,
  },
});

PatientTaskCard.displayName = 'PatientTaskCard';

export default PatientTaskCard;
