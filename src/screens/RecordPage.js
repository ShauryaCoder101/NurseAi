import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiService from '../services/apiService';

const CURRENT_PATIENT_KEY = '@nurseai_current_patient';

const RecordPage = ({navigation}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');

  const canStartRecording = patientName.trim().length > 0 && patientId.trim().length > 0;

  const handleStartRecording = useCallback(async () => {
    if (!canStartRecording) {
      Alert.alert('Required Fields', 'Please enter both Patient Name and Patient ID before recording.');
      return;
    }
    
    // Store current patient info for filtering in HomePage and HistoryPage
    const patientInfo = {
      patientName: patientName.trim(),
      patientId: patientId.trim(),
    };
    await AsyncStorage.setItem(CURRENT_PATIENT_KEY, JSON.stringify(patientInfo));
    
    setIsRecording(true);
    // TODO: Implement actual recording functionality
    Alert.alert('Recording', 'Recording started. This feature will be implemented.');
  }, [canStartRecording, patientName, patientId]);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    // TODO: Implement stop and save functionality
    // When saving transcript, use patientName and patientId
    Alert.alert('Recording', 'Recording stopped. This feature will be implemented.');
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.iconContainer}>
          <Ionicons 
            name={isRecording ? 'mic' : 'mic-outline'} 
            size={80} 
            color={isRecording ? '#FF3B30' : '#007AFF'} 
          />
        </View>
        
        <Text style={styles.title}>
          {isRecording ? 'Recording...' : 'Ready to Record'}
        </Text>
        <Text style={styles.subtitle}>
          {isRecording 
            ? 'Tap stop when finished' 
            : 'Enter patient details below to start recording'}
        </Text>

        {/* Patient Information Form */}
        {!isRecording && (
          <View style={styles.formContainer}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Patient Name *</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={20} color="#999999" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter patient name"
                  placeholderTextColor="#999999"
                  value={patientName}
                  onChangeText={setPatientName}
                  editable={!isRecording}
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Patient ID *</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="id-card-outline" size={20} color="#999999" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter patient ID"
                  placeholderTextColor="#999999"
                  value={patientId}
                  onChangeText={setPatientId}
                  editable={!isRecording}
                />
              </View>
            </View>
          </View>
        )}

        {/* Display patient info during recording */}
        {isRecording && (
          <View style={styles.patientInfoContainer}>
            <View style={styles.patientInfoRow}>
              <Ionicons name="person" size={16} color="#666666" />
              <Text style={styles.patientInfoText}>{patientName}</Text>
            </View>
            <View style={styles.patientInfoRow}>
              <Ionicons name="id-card" size={16} color="#666666" />
              <Text style={styles.patientInfoText}>ID: {patientId}</Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.recordButton, 
            isRecording && styles.recordButtonActive,
            !canStartRecording && !isRecording && styles.recordButtonDisabled
          ]}
          onPress={isRecording ? handleStopRecording : handleStartRecording}
          activeOpacity={0.8}
          disabled={!canStartRecording && !isRecording}>
          <Ionicons 
            name={isRecording ? 'stop' : 'mic'} 
            size={32} 
            color="#FFFFFF" 
          />
          <Text style={styles.recordButtonText}>
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 24,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 12,
    height: 50,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333333',
  },
  patientInfoContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  patientInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  patientInfoText: {
    fontSize: 16,
    color: '#333333',
    marginLeft: 8,
    fontWeight: '500',
  },
  recordButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 200,
    justifyContent: 'center',
  },
  recordButtonActive: {
    backgroundColor: '#FF3B30',
  },
  recordButtonDisabled: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
});

export default React.memo(RecordPage);
