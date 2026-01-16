import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiService from '../services/apiService';
import {Audio} from 'expo-av';
import * as ImagePicker from 'expo-image-picker';

const CURRENT_PATIENT_KEY = '@nurseai_current_patient';

const RecordPage = ({navigation}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [missingFormVisible, setMissingFormVisible] = useState(false);
  const [missingFormCompleted, setMissingFormCompleted] = useState(false);
  const [requiredMissingKeys, setRequiredMissingKeys] = useState([]);
  const [missingSuggestionId, setMissingSuggestionId] = useState(null);
  const [missingData, setMissingData] = useState({
    age: '',
    gender: '',
    occupation: '',
    spo2: '',
    bp: '',
    hr: '',
    rr: '',
    weight: '',
    height: '',
    bmi: '',
  });
  const recordingRef = useRef(null);

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
    
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Microphone permission is needed to record audio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const {recording} = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
    setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  }, [canStartRecording, patientName, patientId]);

  const parseMissingFields = useCallback((content) => {
    if (!content) return [];
    const lower = content.toLowerCase();
    const sectionIndex = lower.indexOf('8. missing data');
    if (sectionIndex === -1) return [];

    const after = content.slice(sectionIndex);
    const sectionBody = after.split(/tone:/i)[0] || after;
    const tokens = sectionBody
      .replace(/\r/g, '')
      .split(/[\n,\/]/g)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

    const matches = new Set();
    const addIfMatch = (token, key) => {
      if (token.includes(key)) {
        matches.add(key);
      }
    };

    tokens.forEach((token) => {
      if (token.includes('spo2') || token.includes('sp02')) matches.add('spo2');
      if (token.includes('bp') || token.includes('blood pressure')) matches.add('bp');
      if (token.includes('hr') || token.includes('heart rate')) matches.add('hr');
      if (token.includes('rr') || token.includes('respiratory rate')) matches.add('rr');
      if (token.includes('weight')) matches.add('weight');
      if (token.includes('height')) matches.add('height');
      if (token.includes('bmi')) matches.add('bmi');
      if (token.includes('age')) matches.add('age');
      if (token.includes('gender') || token.includes('sex')) matches.add('gender');
      addIfMatch(token, 'occupation');
    });

    return Array.from(matches);
  }, []);

  const handleMissingDataFlow = useCallback(async () => {
    const geminiResult = await apiService.getLatestGeminiSuggestion({
      patientName: patientName.trim(),
      patientId: patientId.trim(),
    });
    if (!geminiResult.success) {
      setRequiredMissingKeys([]);
      setMissingSuggestionId(null);
      Alert.alert('Success', 'Recording uploaded successfully.');
      return;
    }

    const latest = geminiResult.data;
    const missingKeys = parseMissingFields(latest?.content || '');

    if (missingKeys.length === 0) {
      setRequiredMissingKeys([]);
      setMissingSuggestionId(null);
      Alert.alert('Success', 'Recording uploaded successfully.');
      return;
    }

    setRequiredMissingKeys(missingKeys);
    setMissingSuggestionId(latest?.id || null);
    setMissingFormVisible(true);
    setMissingFormCompleted(false);
  }, [parseMissingFields, patientId, patientName]);

  const uploadRecording = useCallback(
    async (audioUri, photoUri) => {
      setIsUploading(true);
      try {
        const uploadResult = await apiService.uploadAudio({
          uri: audioUri,
          photoUri,
          patientName: patientName.trim(),
          patientId: patientId.trim(),
        });

        if (uploadResult.success) {
          await handleMissingDataFlow();
        } else {
          Alert.alert('Upload Failed', uploadResult.error || 'Failed to upload recording.');
        }
      } catch (error) {
        console.error('Upload error:', error);
        Alert.alert('Error', 'Failed to upload recording. Please try again.');
      } finally {
        setIsUploading(false);
      }
    },
    [patientName, patientId, handleMissingDataFlow]
  );

  const pickPhotoFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Allow photo access to attach a photo.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled) {
      return null;
    }

    return result.assets?.[0]?.uri || null;
  }, []);

  const pickPhotoFromCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Allow camera access to take a photo.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled) {
      return null;
    }

    return result.assets?.[0]?.uri || null;
  }, []);

  const promptPhotoUpload = useCallback(
    (audioUri) => {
      Alert.alert(
        'Attach Photo?',
        'You can attach a patient photo before uploading. This is optional.',
        [
          {
            text: 'Upload Without Photo',
            onPress: () => uploadRecording(audioUri, null),
          },
          {
            text: 'Choose from Library',
            onPress: async () => {
              const photoUri = await pickPhotoFromLibrary();
              if (!photoUri) {
                uploadRecording(audioUri, null);
                return;
              }
              uploadRecording(audioUri, photoUri);
            },
          },
          {
            text: 'Open Camera',
            onPress: async () => {
              const photoUri = await pickPhotoFromCamera();
              if (!photoUri) {
                uploadRecording(audioUri, null);
                return;
              }
              uploadRecording(audioUri, photoUri);
            },
          },
        ]
      );
    },
    [pickPhotoFromLibrary, pickPhotoFromCamera, uploadRecording]
  );

  const handleStopRecording = useCallback(async () => {
    try {
    setIsRecording(false);

      const recording = recordingRef.current;
      if (!recording) {
        Alert.alert('Error', 'No active recording found.');
        return;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      if (!uri) {
        Alert.alert('Error', 'Recording failed. No audio file was created.');
        return;
      }

      promptPhotoUpload(uri);
    } catch (error) {
      console.error('Error stopping recording:', error);
      Alert.alert('Error', 'Failed to stop recording. Please try again.');
    }
  }, [promptPhotoUpload]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (missingFormVisible && !missingFormCompleted) {
        e.preventDefault();
        Alert.alert(
          'Missing Patient Data',
          'Please complete the missing patient data form before leaving.'
        );
      }
    });

    return () => {
      unsubscribe();
      // Cleanup recording on unmount
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, [navigation, missingFormVisible, missingFormCompleted]);

  const isMissingFormValid = requiredMissingKeys.every(
    (key) => missingData[key]?.trim().length > 0
  );

  const updateMissingData = useCallback((key, value) => {
    setMissingData((prev) => ({...prev, [key]: value}));
  }, []);

  const handleSubmitMissingData = useCallback(() => {
    if (!isMissingFormValid) {
      Alert.alert('Required Fields', 'Please fill all missing patient data.');
      return;
    }
    const payload = requiredMissingKeys.reduce((acc, key) => {
      acc[key] = missingData[key];
      return acc;
    }, {});

    const followupMessage = [
      'Updated patient demographics and vitals:',
      ...Object.entries(payload).map(([key, value]) => {
        const labelMap = {
          age: 'Age',
          gender: 'Gender',
          occupation: 'Occupation',
          spo2: 'SpO2',
          bp: 'BP',
          hr: 'HR',
          rr: 'RR',
          weight: 'Weight',
          height: 'Height',
          bmi: 'BMI',
        };
        return `${labelMap[key] || key}: ${String(value).trim()}`;
      }),
    ].join('\n');

    const updateRequest = missingSuggestionId
      ? apiService.followupGeminiSuggestion(
          missingSuggestionId,
          followupMessage,
          patientId.trim()
        )
      : Promise.resolve({success: true});

    updateRequest.then((result) => {
      if (!result.success) {
        Alert.alert('Update Failed', result.error || 'Failed to update missing data.');
        return;
      }
      setMissingFormCompleted(true);
      setMissingFormVisible(false);
    });
  }, [isMissingFormValid, missingSuggestionId, missingData, requiredMissingKeys]);

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
            (!canStartRecording && !isRecording) || isUploading ? styles.recordButtonDisabled : null
          ]}
          onPress={isRecording ? handleStopRecording : handleStartRecording}
          activeOpacity={0.8}
          disabled={(!canStartRecording && !isRecording) || isUploading}>
          <Ionicons 
            name={isRecording ? 'stop' : 'mic'} 
            size={32} 
            color="#FFFFFF" 
          />
          <Text style={styles.recordButtonText}>
            {isUploading ? 'Uploading...' : isRecording ? 'Stop Recording' : 'Start Recording'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={missingFormVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Missing Patient Data</Text>
            <Text style={styles.modalSubtitle}>
              Recording submitted. Please fill all missing demographics and vitals.
            </Text>
            <ScrollView style={styles.modalForm} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalSectionTitle}>Demographics</Text>
              {requiredMissingKeys.includes('age') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Age *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.age}
                    onChangeText={(value) => updateMissingData('age', value)}
                    placeholder="Age"
                    keyboardType="number-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('gender') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Gender *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.gender}
                    onChangeText={(value) => updateMissingData('gender', value)}
                    placeholder="Gender"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('occupation') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Occupation *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.occupation}
                    onChangeText={(value) => updateMissingData('occupation', value)}
                    placeholder="Occupation"
                  />
                </View>
              )}

              <Text style={styles.modalSectionTitle}>Vitals</Text>
              {requiredMissingKeys.includes('spo2') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>SpO2 *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.spo2}
                    onChangeText={(value) => updateMissingData('spo2', value)}
                    placeholder="SpO2"
                    keyboardType="number-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('bp') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>BP *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.bp}
                    onChangeText={(value) => updateMissingData('bp', value)}
                    placeholder="BP"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('hr') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>HR *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.hr}
                    onChangeText={(value) => updateMissingData('hr', value)}
                    placeholder="HR"
                    keyboardType="number-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('rr') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>RR *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.rr}
                    onChangeText={(value) => updateMissingData('rr', value)}
                    placeholder="RR"
                    keyboardType="number-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('weight') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Weight *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.weight}
                    onChangeText={(value) => updateMissingData('weight', value)}
                    placeholder="Weight"
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('height') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Height *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.height}
                    onChangeText={(value) => updateMissingData('height', value)}
                    placeholder="Height"
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
              {requiredMissingKeys.includes('bmi') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>BMI *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.bmi}
                    onChangeText={(value) => updateMissingData('bmi', value)}
                    placeholder="BMI"
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[
                styles.modalSubmit,
                !isMissingFormValid && styles.modalSubmitDisabled,
              ]}
              onPress={handleSubmitMissingData}
              activeOpacity={0.8}
              disabled={!isMissingFormValid}>
              <Text style={styles.modalSubmitText}>Save and Continue</Text>
            </TouchableOpacity>
          </View>
      </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  modalForm: {
    marginBottom: 16,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
    marginTop: 4,
  },
  modalField: {
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 13,
    color: '#333333',
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    color: '#333333',
    backgroundColor: '#FAFAFA',
  },
  modalSubmit: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSubmitDisabled: {
    backgroundColor: '#CCCCCC',
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default React.memo(RecordPage);
