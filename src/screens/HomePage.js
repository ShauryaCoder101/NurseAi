import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Ionicons} from '@expo/vector-icons';
import {Swipeable} from 'react-native-gesture-handler';
import SummaryCard from '../components/dashboard/SummaryCard';
import PatientTaskCard from '../components/dashboard/PatientTaskCard';
import apiService from '../services/apiService';
import useKeyboardCentering from '../hooks/useKeyboardCentering';

const CURRENT_PATIENT_KEY = '@nurseai_current_patient';

const HomePage = ({navigation}) => {
  const [summary, setSummary] = useState({pending: 0, done: 0});
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [currentPatient, setCurrentPatient] = useState(null);
  const [geminiSuggestions, setGeminiSuggestions] = useState([]);
  const [geminiError, setGeminiError] = useState(null);
  const [expandedSuggestionId, setExpandedSuggestionId] = useState(null);
  const [askAiInputs, setAskAiInputs] = useState({});
  const [askAiLoading, setAskAiLoading] = useState({});
  const [flaggingSuggestions, setFlaggingSuggestions] = useState({});
  const [flaggedSuggestions, setFlaggedSuggestions] = useState({});
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagTarget, setFlagTarget] = useState(null);
  const scrollViewRef = useRef(null);
  const {onScroll, handleFocus, keyboardHeight} = useKeyboardCentering(scrollViewRef);

  // Load current patient info from storage
  useEffect(() => {
    const loadCurrentPatient = async () => {
      try {
        const patientData = await AsyncStorage.getItem(CURRENT_PATIENT_KEY);
        if (patientData) {
          setCurrentPatient(JSON.parse(patientData));
        }
      } catch (error) {
        console.error('Error loading current patient:', error);
      }
    };
    loadCurrentPatient();
    
    // Listen for focus events to refresh patient info
    const unsubscribe = navigation.addListener('focus', loadCurrentPatient);
    return unsubscribe;
  }, [navigation]);

  // Memoized fetch function - all data from backend
  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true);
        setError(null);
      }

      // Get current patient info for filtering
      let patientParams = {};
      if (currentPatient) {
        patientParams = {
          patientName: currentPatient.patientName,
          patientId: currentPatient.patientId,
        };
      }

      // Fetch summary and tasks in parallel for better performance
      const [summaryResult, tasksResult, geminiResult] = await Promise.all([
        apiService.getDashboardSummary(),
        apiService.getPatientTasks({
          sortBy: 'emergency',
          status: 'Pending',
          ...patientParams,
        }), // Sorted by emergency level with patient filter
        apiService.getGeminiSuggestions(),
      ]);

      if (summaryResult.success) {
        setSummary(summaryResult.data || {pending: 0, done: 0});
      } else {
        setSummary({pending: 0, done: 0});
        setError('Failed to load dashboard summary');
      }

      if (tasksResult.success) {
        // Only use data from backend, no fallback
        setTasks(tasksResult.data || []);
      } else {
        setTasks([]);
        setError('Failed to load patient tasks');
      }

      if (geminiResult.success) {
        const suggestions = geminiResult.data || [];
        setGeminiSuggestions(suggestions.slice(0, 5));
        setGeminiError(null);
      } else {
        setGeminiSuggestions([]);
        setGeminiError(geminiResult.error || 'Failed to load Gemini suggestions');
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setSummary({pending: 0, done: 0});
      setTasks([]);
      setGeminiSuggestions([]);
      setGeminiError('Network error. Please check your connection.');
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPatient]);

  // Initial load
  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      apiService.clearCache();
      fetchDashboardData(true);
    });
    return unsubscribe;
  }, [navigation, fetchDashboardData]);

  // Pull to refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    apiService.clearCache();
    fetchDashboardData(true);
  }, [fetchDashboardData]);

  // Memoized task press handler
  const handleTaskPress = useCallback((task) => {
    navigation.navigate('Transcript', {taskId: task.id, task});
  }, [navigation]);

  const handleCompleteTask = useCallback(async (taskId) => {
    const result = await apiService.completePatientTask(taskId);
    if (result.success) {
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      setSummary((prev) => ({
        pending: Math.max(0, (prev?.pending || 0) - 1),
        done: (prev?.done || 0) + 1,
      }));
    } else {
      setError(result.error || 'Failed to complete task');
    }
  }, []);

  // Memoized render functions for performance
  const renderSummaryCards = useMemo(() => (
    <View style={styles.summaryContainer}>
      <SummaryCard type="pending" count={summary.pending} label="Pending" />
      <SummaryCard type="done" count={summary.done} label="Done" />
    </View>
  ), [summary]);

  const renderTasks = useMemo(() => {
    if (tasks.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {error ? 'Error loading tasks' : 'No tasks available'}
          </Text>
          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>
      );
    }

    return tasks.map((task) => (
      <Swipeable
        key={task.id}
        renderLeftActions={renderLeftActions}
        onSwipeableOpen={() => handleCompleteTask(task.id)}>
        <PatientTaskCard
        task={task}
        onPress={() => handleTaskPress(task)}
      />
      </Swipeable>
    ));
  }, [tasks, handleTaskPress, handleCompleteTask, error, renderLeftActions]);

  const handleCompleteSuggestion = useCallback(async (id) => {
    const result = await apiService.completeGeminiSuggestion(id);
    if (result.success) {
      setGeminiSuggestions((prev) => prev.filter((item) => item.id !== id));
      setExpandedSuggestionId((prev) => (prev === id ? null : prev));
      setSummary((prev) => ({
        pending: Math.max(0, (prev?.pending || 0) - 1),
        done: (prev?.done || 0) + 1,
      }));
    } else {
      setGeminiError(result.error || 'Failed to mark suggestion complete');
    }
  }, []);

  const handleAskAiChange = useCallback((id, value) => {
    setAskAiInputs((prev) => ({...prev, [id]: value}));
  }, []);

  const handleAskAiSubmit = useCallback(
    async (item) => {
      const message = (askAiInputs[item.id] || '').trim();
      if (!message) {
        Alert.alert('Ask AI', 'Please enter a question before sending.');
        return;
      }
      setAskAiLoading((prev) => ({...prev, [item.id]: true}));
      const result = await apiService.followupGeminiSuggestion(
        item.id,
        message,
        item.patientId
      );
      if (result.success) {
        setGeminiSuggestions((prev) =>
          prev.map((suggestion) =>
            suggestion.id === item.id
              ? {...suggestion, content: result.data?.content || suggestion.content}
              : suggestion
          )
        );
        setAskAiInputs((prev) => ({...prev, [item.id]: ''}));
      } else {
        Alert.alert('Ask AI', result.error || 'Failed to send follow-up.');
      }
      setAskAiLoading((prev) => ({...prev, [item.id]: false}));
    },
    [askAiInputs]
  );

  const handleFlagSuggestion = useCallback(async (item) => {
    setFlagTarget(item);
    setFlagReason('');
    setFlagModalVisible(true);
  }, []);

  const submitFlagSuggestion = useCallback(async () => {
    if (!flagTarget) {
      setFlagModalVisible(false);
      return;
    }
    if (flaggingSuggestions[flagTarget.id]) {
      return;
    }
    if (!flagReason.trim()) {
      Alert.alert('Flag for review', 'Please add a reason for flagging.');
      return;
    }
    setFlaggingSuggestions((prev) => ({...prev, [flagTarget.id]: true}));
    const result = await apiService.flagGeminiSuggestion(flagTarget.id, flagReason.trim());
    if (result.success) {
      setFlaggedSuggestions((prev) => ({...prev, [flagTarget.id]: true}));
      setFlagModalVisible(false);
      Alert.alert('Flagged', 'Suggestion flagged for review.');
    } else {
      Alert.alert('Flag for review', result.error || 'Failed to flag suggestion.');
    }
    setFlaggingSuggestions((prev) => ({...prev, [flagTarget.id]: false}));
  }, [flagTarget, flagReason, flaggingSuggestions]);

  const closeFlagModal = useCallback(() => {
    setFlagModalVisible(false);
    setFlagReason('');
    setFlagTarget(null);
  }, []);

  const toggleSuggestion = useCallback((id) => {
    setExpandedSuggestionId((prev) => (prev === id ? null : id));
  }, []);

  const renderLeftActions = useCallback(() => {
    return (
      <View style={styles.swipeAction}>
        <Ionicons name="checkmark-circle" size={24} color="#FFFFFF" />
        <Text style={styles.swipeActionText}>Complete</Text>
      </View>
    );
  }, []);

  const renderGeminiSuggestions = useMemo(() => {
    if (geminiError) {
      return (
        <View style={styles.geminiCard}>
          <Text style={styles.geminiTitle}>Gemini Suggestions</Text>
          <Text style={styles.geminiError}>{geminiError}</Text>
        </View>
      );
    }

    if (geminiSuggestions.length === 0) {
      return (
        <View style={styles.geminiCard}>
          <Text style={styles.geminiTitle}>Gemini Suggestions</Text>
          <Text style={styles.geminiEmpty}>
            No pending suggestions yet.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.geminiList}>
        <Text style={styles.geminiTitle}>Gemini Suggestions</Text>
        {geminiSuggestions.map((item) => {
          const isExpanded = expandedSuggestionId === item.id;
          return (
            <Swipeable
              key={item.id}
              renderLeftActions={renderLeftActions}
              onSwipeableOpen={() => handleCompleteSuggestion(item.id)}>
              <Pressable
                onPress={() => toggleSuggestion(item.id)}
                style={styles.geminiCardItem}
                accessibilityRole="button"
                accessibilityLabel="Toggle Gemini suggestion"
                accessibilityHint="Tap to expand or collapse the suggestion text">
                <View style={styles.geminiCardHeader}>
                  <Text style={styles.geminiSubtitle}>
                    {item.patientName || 'Unknown Patient'} (ID: {item.patientId || 'N/A'})
                  </Text>
                  <Pressable
                    style={[
                      styles.flagButton,
                      (flaggingSuggestions[item.id] || flaggedSuggestions[item.id]) &&
                        styles.flagButtonDisabled,
                    ]}
                    onPress={() => handleFlagSuggestion(item)}
                    disabled={flaggingSuggestions[item.id] || flaggedSuggestions[item.id]}>
                    <Text style={styles.flagButtonText}>
                      {flaggedSuggestions[item.id] ? 'Flagged' : 'Flag for review'}
                    </Text>
                  </Pressable>
                </View>
                <Text
                  style={styles.geminiContent}
                  numberOfLines={isExpanded ? undefined : 5}>
                  {item.content}
                </Text>
                <Text style={styles.geminiHint}>
                  {isExpanded ? 'Tap to collapse' : 'Tap to expand'}
                </Text>
                {isExpanded && (
                  <View style={styles.askAiContainer}>
                    <Text style={styles.askAiLabel}>Ask AI</Text>
                    <TextInput
                      style={styles.askAiInput}
                      placeholder="Ask a follow-up question..."
                      placeholderTextColor="#999999"
                      value={askAiInputs[item.id] || ''}
                      onChangeText={(value) => handleAskAiChange(item.id, value)}
                      onFocus={handleFocus}
                      editable={!askAiLoading[item.id]}
                      multiline
                    />
                    <Pressable
                      style={[
                        styles.askAiButton,
                        (!askAiInputs[item.id]?.trim() || askAiLoading[item.id]) &&
                          styles.askAiButtonDisabled,
                      ]}
                      onPress={() => handleAskAiSubmit(item)}
                      disabled={!askAiInputs[item.id]?.trim() || askAiLoading[item.id]}>
                      <Text style={styles.askAiButtonText}>
                        {askAiLoading[item.id] ? 'Sending...' : 'Send'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </Swipeable>
          );
        })}
      </View>
    );
  }, [
    geminiSuggestions,
    geminiError,
    handleCompleteSuggestion,
    handleAskAiChange,
    handleAskAiSubmit,
    handleFlagSuggestion,
    askAiInputs,
    askAiLoading,
    flaggingSuggestions,
    flaggedSuggestions,
    renderLeftActions,
    expandedSuggestionId,
    toggleSuggestion,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          keyboardHeight ? {paddingBottom: keyboardHeight + 24} : null,
        ]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onScroll={onScroll}
        scrollEventThrottle={16}>
        {/* Logo Container */}
        <View style={styles.logoCard}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="document-text" size={32} color="#007AFF" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>NurseAI</Text>
              <Text style={styles.headerSubtitle}>Clinical Assistant</Text>
            </View>
          </View>
        </View>

        {/* Summary Cards */}
        {renderSummaryCards}

        {/* Gemini Suggestions */}
        {renderGeminiSuggestions}

        {/* Patient Tasks Section removed */}
      </ScrollView>
      <Modal
        visible={flagModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeFlagModal}>
        <View style={styles.flagModalOverlay}>
          <View style={styles.flagModalCard}>
            <Text style={styles.flagModalTitle}>Flag for review</Text>
            <Text style={styles.flagModalSubtitle}>
              Sorry for the inconvenience, but please elaborate the reason for flagging.
            </Text>
            <TextInput
              style={styles.flagModalInput}
              placeholder="Type your reason here..."
              placeholderTextColor="#999999"
              value={flagReason}
              onChangeText={setFlagReason}
              onFocus={handleFocus}
              multiline
            />
            <View style={styles.flagModalActions}>
              <Pressable style={styles.flagModalCancel} onPress={closeFlagModal}>
                <Text style={styles.flagModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.flagModalSubmit}
                onPress={submitFlagSuggestion}>
                <Text style={styles.flagModalSubmitText}>Submit</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoCard: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#E5F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
  },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  tasksSection: {
    backgroundColor: '#FFFFFF',
    margin: 12,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  geminiCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  geminiList: {
    marginHorizontal: 12,
    marginTop: 8,
  },
  geminiCardItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 12,
  },
  geminiTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 6,
  },
  geminiSubtitle: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 8,
  },
  geminiContent: {
    fontSize: 14,
    color: '#444444',
  },
  geminiHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#999999',
  },
  geminiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  flagButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: -10,
  },
  flagButtonDisabled: {
    opacity: 0.6,
  },
  flagButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  flagModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  flagModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
  },
  flagModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 6,
  },
  flagModalSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
  },
  flagModalInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 90,
    fontSize: 14,
    color: '#333333',
    backgroundColor: '#FAFAFA',
  },
  flagModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  flagModalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  flagModalCancelText: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '600',
  },
  flagModalSubmit: {
    backgroundColor: '#FF3B30',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  flagModalSubmitText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  askAiContainer: {
    marginTop: 12,
  },
  askAiLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 6,
  },
  askAiInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 14,
    color: '#333333',
    backgroundColor: '#FAFAFA',
    marginBottom: 10,
  },
  askAiButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  askAiButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  askAiButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  geminiEmpty: {
    fontSize: 14,
    color: '#999999',
  },
  geminiError: {
    fontSize: 14,
    color: '#FF3B30',
  },
  swipeAction: {
    backgroundColor: '#34C759',
    justifyContent: 'center',
    alignItems: 'center',
    width: 110,
    borderRadius: 16,
    marginLeft: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  swipeActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 4,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666666',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999999',
  },
  errorText: {
    fontSize: 14,
    color: '#FF3B30',
    marginTop: 8,
    textAlign: 'center',
  },
});

export default React.memo(HomePage);
