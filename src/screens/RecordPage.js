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
  Keyboard,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiService from '../services/apiService';
import {Audio} from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import useKeyboardCentering from '../hooks/useKeyboardCentering';

const CURRENT_PATIENT_KEY = '@nurseai_current_patient';
const GEMINI_RETRY_CACHE_KEY = '@nurseai_gemini_retry';
const GEMINI_RETRY_WINDOW_MS = 30 * 60 * 1000;
const GEMINI_RETRY_DELAY_MS = 60 * 1000;
const GEMINI_RETRY_MAX_ATTEMPTS = 3;

const RecordPage = ({navigation}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [missingFormVisible, setMissingFormVisible] = useState(false);
  const [missingFormCompleted, setMissingFormCompleted] = useState(false);
  const [requiredMissingKeys, setRequiredMissingKeys] = useState([]);
  const [missingSuggestionId, setMissingSuggestionId] = useState(null);
  const [pendingGeminiRetry, setPendingGeminiRetry] = useState(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
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
  const scrollViewRef = useRef(null);
  const modalScrollRef = useRef(null);
  const {onScroll: onMainScroll, handleFocus: handleMainFocus} =
    useKeyboardCentering(scrollViewRef);
  const {onScroll: onModalScroll, handleFocus: handleModalFocus} =
    useKeyboardCentering(modalScrollRef);
  const recordingStartRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [photoOptionsVisible, setPhotoOptionsVisible] = useState(false);
  const [pendingAudioUri, setPendingAudioUri] = useState(null);

  const canStartRecording = patientName.trim().length > 0 && patientId.trim().length > 0;
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const loadPendingRetry = async () => {
      try {
        const cached = await AsyncStorage.getItem(GEMINI_RETRY_CACHE_KEY);
        if (!cached) return;
        const parsed = JSON.parse(cached);
        if (!parsed?.expiresAt || Date.now() > parsed.expiresAt) {
          await AsyncStorage.removeItem(GEMINI_RETRY_CACHE_KEY);
          return;
        }
        setPendingGeminiRetry(parsed);
      } catch (error) {
        console.error('Failed to load retry cache:', error);
      }
    };
    loadPendingRetry();
  }, []);

  useEffect(() => {
    if (!pendingGeminiRetry) {
      setRetryCountdown(0);
      return;
    }
    const updateCountdown = () => {
      const remainingMs = Math.max(0, pendingGeminiRetry.nextRetryAt - Date.now());
      setRetryCountdown(Math.ceil(remainingMs / 1000));
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [pendingGeminiRetry]);

  const persistRetryState = useCallback(async (nextState) => {
    if (!nextState) {
      setPendingGeminiRetry(null);
      await AsyncStorage.removeItem(GEMINI_RETRY_CACHE_KEY);
      return;
    }
    setPendingGeminiRetry(nextState);
    await AsyncStorage.setItem(GEMINI_RETRY_CACHE_KEY, JSON.stringify(nextState));
  }, []);

  const handleGeminiRateLimit = useCallback(
    async (audioRecordId, retryAfterSeconds = 60, attempts = 0) => {
      const nextRetryAt = Date.now() + retryAfterSeconds * 1000;
      const expiresAt = Date.now() + GEMINI_RETRY_WINDOW_MS;
      await persistRetryState({
        audioRecordId,
        patientName: patientName.trim(),
        patientId: patientId.trim(),
        attempts,
        nextRetryAt,
        expiresAt,
      });
      Alert.alert(
        'Busy Right Now',
        'Your recording could not be sent due to too many concurrent users. Please try again in 60 seconds.'
      );
    },
    [patientId, patientName, persistRetryState]
  );

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
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Microphone permission is needed to record audio.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });

      const {recording} = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      const message = String(error?.message || '');
      const isSessionError = message.toLowerCase().includes('session activation failed');
      Alert.alert(
        'Error',
        isSessionError
          ? 'Recording session failed to activate. Close other apps using the microphone and try again. If you are on iOS Simulator, use a physical device.'
          : 'Failed to start recording. Please try again.'
      );
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
          const payload = uploadResult.data?.data || {};
          const geminiGenerated = payload.geminiGenerated;
          const geminiError = payload.geminiError;
          const geminiErrorCode = payload.geminiErrorCode;
          const retryAfterSeconds = payload.geminiRetryAfterSeconds || 60;
          if (geminiGenerated === false) {
            if (geminiErrorCode === 'RATE_LIMIT' && payload.id) {
              await handleGeminiRateLimit(payload.id, retryAfterSeconds, 0);
              return;
            }
            Alert.alert(
              'Uploaded',
              geminiError || 'Recording uploaded, but no Gemini suggestion was generated.'
            );
            return;
          }
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
    [patientName, patientId, handleMissingDataFlow, handleGeminiRateLimit]
  );

  const handleRetryGemini = useCallback(async () => {
    if (!pendingGeminiRetry) {
      return;
    }
    if (Date.now() < pendingGeminiRetry.nextRetryAt) {
      Alert.alert(
        'Please wait',
        `Try again in ${retryCountdown || 60} seconds.`
      );
      return;
    }
    if (pendingGeminiRetry.attempts >= GEMINI_RETRY_MAX_ATTEMPTS) {
      await persistRetryState(null);
      Alert.alert('Please try again later', 'Retry limit reached. Please try again later.');
      return;
    }
    setIsUploading(true);
    try {
      const result = await apiService.retryGeminiForAudio(
        pendingGeminiRetry.audioRecordId
      );
      if (result.success) {
        const payload = result.data || {};
        if (payload.geminiGenerated) {
          await persistRetryState(null);
          await handleMissingDataFlow();
          return;
        }
        if (payload.geminiErrorCode === 'RATE_LIMIT') {
          const nextAttempts = pendingGeminiRetry.attempts + 1;
          if (nextAttempts >= GEMINI_RETRY_MAX_ATTEMPTS) {
            await persistRetryState(null);
            Alert.alert(
              'Please try again later',
              'Retry limit reached. Please try again later.'
            );
            return;
          }
          await handleGeminiRateLimit(
            pendingGeminiRetry.audioRecordId,
            payload.geminiRetryAfterSeconds || 60,
            nextAttempts
          );
          return;
        }
        Alert.alert(
          'Gemini Error',
          payload.geminiError || 'Gemini processing failed.'
        );
        await persistRetryState(null);
        return;
      }
      Alert.alert('Retry Failed', result.error || 'Failed to retry Gemini.');
    } catch (error) {
      console.error('Retry Gemini error:', error);
      Alert.alert('Error', 'Failed to retry Gemini.');
    } finally {
      setIsUploading(false);
    }
  }, [
    pendingGeminiRetry,
    retryCountdown,
    handleMissingDataFlow,
    handleGeminiRateLimit,
    persistRetryState,
  ]);

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

  const promptPhotoUpload = useCallback((audioUri) => {
    setPendingAudioUri(audioUri);
    setPhotoOptionsVisible(true);
  }, []);

  const handleDiscardRecording = useCallback(() => {
    setPhotoOptionsVisible(false);
    setPendingAudioUri(null);
  }, []);

  const handleUploadWithoutPhoto = useCallback(() => {
    const audioUri = pendingAudioUri;
    setPhotoOptionsVisible(false);
    setPendingAudioUri(null);
    if (audioUri) {
      uploadRecording(audioUri, null);
    }
  }, [pendingAudioUri, uploadRecording]);

  const handleChooseFromLibrary = useCallback(async () => {
    const audioUri = pendingAudioUri;
    if (!audioUri) return;
    setPhotoOptionsVisible(false);
    const photoUri = await pickPhotoFromLibrary();
    if (!photoUri) {
      setPhotoOptionsVisible(true);
      return;
    }
    setPendingAudioUri(null);
    uploadRecording(audioUri, photoUri);
  }, [pendingAudioUri, pickPhotoFromLibrary, uploadRecording]);

  const handleTakePhoto = useCallback(async () => {
    const audioUri = pendingAudioUri;
    if (!audioUri) return;
    setPhotoOptionsVisible(false);
    const photoUri = await pickPhotoFromCamera();
    if (!photoUri) {
      setPhotoOptionsVisible(true);
      return;
    }
    setPendingAudioUri(null);
    uploadRecording(audioUri, photoUri);
  }, [pendingAudioUri, pickPhotoFromCamera, uploadRecording]);

  const handleStopRecording = useCallback(async () => {
    try {
      setIsRecording(false);

      const recording = recordingRef.current;
      if (!recording) {
        Alert.alert('Error', 'No active recording found.');
        return;
      }

      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
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
    if (!isRecording) {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      return;
    }

    recordingIntervalRef.current = setInterval(() => {
      if (!recordingStartRef.current) return;
      const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
      setRecordingSeconds(elapsed);
    }, 500);

    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, [isRecording]);

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
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, [navigation, missingFormVisible, missingFormCompleted]);

  const formatDuration = useCallback((totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, []);

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
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onMainScroll}
        scrollEventThrottle={16}>
        <View style={styles.contentInner}>
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
                  onFocus={handleMainFocus}
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
                  onFocus={handleMainFocus}
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
            <View style={styles.timerRow}>
              <Ionicons name="time-outline" size={16} color="#FF3B30" />
              <Text style={styles.timerText}>{formatDuration(recordingSeconds)}</Text>
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
          {pendingGeminiRetry && (
            <View style={styles.retryCard}>
              <Text style={styles.retryTitle}>Gemini is busy</Text>
              <Text style={styles.retrySubtitle}>
                {retryCountdown > 0
                  ? `Retry available in ${retryCountdown}s`
                  : 'You can retry now.'}
              </Text>
              <TouchableOpacity
                style={[
                  styles.retryButton,
                  (retryCountdown > 0 || isUploading) && styles.retryButtonDisabled,
                ]}
                onPress={handleRetryGemini}
                disabled={retryCountdown > 0 || isUploading}>
                <Text style={styles.retryButtonText}>
                  {isUploading ? 'Retrying...' : 'Retry Gemini'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{height: keyboardHeight}} />
        </View>
      </ScrollView>

      <Modal
        visible={photoOptionsVisible}
        transparent
        animationType="fade"
        onRequestClose={handleDiscardRecording}>
        <View style={styles.modalOverlay}>
          <View style={styles.photoModalCard}>
            <Text style={styles.modalTitle}>Attach Photo?</Text>
            <Text style={styles.modalSubtitle}>
              You can add a patient photo before uploading. This is optional.
            </Text>
            <TouchableOpacity
              style={[
                styles.photoOptionButton,
                styles.photoOptionPrimary,
                isUploading && styles.photoOptionDisabled,
              ]}
              onPress={handleUploadWithoutPhoto}
              disabled={isUploading}>
              <Text style={[styles.photoOptionText, styles.photoOptionPrimaryText]}>
                Upload Without Photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.photoOptionButton,
                isUploading && styles.photoOptionDisabled,
              ]}
              onPress={handleChooseFromLibrary}
              disabled={isUploading}>
              <Text style={styles.photoOptionText}>Choose from Library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.photoOptionButton,
                isUploading && styles.photoOptionDisabled,
              ]}
              onPress={handleTakePhoto}
              disabled={isUploading}>
              <Text style={styles.photoOptionText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.photoOptionButton,
                styles.photoOptionDestructive,
                isUploading && styles.photoOptionDisabled,
              ]}
              onPress={handleDiscardRecording}
              disabled={isUploading}>
              <Text style={[styles.photoOptionText, styles.photoOptionDestructiveText]}>
                Don’t Upload
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
            <ScrollView
              ref={modalScrollRef}
              style={styles.modalForm}
              keyboardShouldPersistTaps="handled"
              onScroll={onModalScroll}
              scrollEventThrottle={16}>
              <View>
              <Text style={styles.modalSectionTitle}>Demographics</Text>
              {requiredMissingKeys.includes('age') && (
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Age *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={missingData.age}
                    onChangeText={(value) => updateMissingData('age', value)}
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
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
                    onFocus={handleModalFocus}
                    placeholder="BMI"
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
              <View style={{height: keyboardHeight}} />
              </View>
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
    backgroundColor: '#F7F8FA',
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
  contentInner: {
    width: '100%',
    alignItems: 'center',
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6EBF2',
    paddingHorizontal: 12,
    height: 50,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
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
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#EEF1F6',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  patientInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  patientInfoText: {
    fontSize: 16,
    color: '#333333',
    marginLeft: 8,
    fontWeight: '500',
  },
  timerText: {
    fontSize: 16,
    color: '#FF3B30',
    marginLeft: 8,
    fontWeight: '700',
    letterSpacing: 1,
  },
  recordButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 200,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
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
  retryCard: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  retryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 4,
  },
  retrySubtitle: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 10,
  },
  retryButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  retryButtonDisabled: {
    opacity: 0.6,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
  },
  photoModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
  },
  photoOptionButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#F8F8F8',
    alignItems: 'center',
    marginBottom: 10,
  },
  photoOptionPrimary: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  photoOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
  },
  photoOptionPrimaryText: {
    color: '#FFFFFF',
  },
  photoOptionDestructive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FF3B30',
  },
  photoOptionDestructiveText: {
    color: '#FF3B30',
  },
  photoOptionDisabled: {
    opacity: 0.6,
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
