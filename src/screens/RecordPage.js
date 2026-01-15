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
          Alert.alert('Success', 'Recording uploaded successfully.');
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
    [patientName, patientId]
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
    return () => {
      // Cleanup recording on unmount
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
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
