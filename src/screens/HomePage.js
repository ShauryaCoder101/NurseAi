import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Ionicons} from '@expo/vector-icons';
import {Swipeable} from 'react-native-gesture-handler';
import SummaryCard from '../components/dashboard/SummaryCard';
import PatientTaskCard from '../components/dashboard/PatientTaskCard';
import apiService from '../services/apiService';

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
        apiService.getPatientTasks({sortBy: 'emergency', ...patientParams}), // Sorted by emergency level with patient filter
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
        setGeminiSuggestions(geminiResult.data || []);
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
      <PatientTaskCard
        key={task.id}
        task={task}
        onPress={() => handleTaskPress(task)}
      />
    ));
  }, [tasks, handleTaskPress, error]);

  const handleCompleteSuggestion = useCallback(async (id) => {
    const result = await apiService.completeGeminiSuggestion(id);
    if (result.success) {
      setGeminiSuggestions((prev) => prev.filter((item) => item.id !== id));
      setExpandedSuggestionId((prev) => (prev === id ? null : prev));
    } else {
      setGeminiError(result.error || 'Failed to mark suggestion complete');
    }
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
                <Text style={styles.geminiSubtitle}>
                  {item.patientName || 'Unknown Patient'} (ID: {item.patientId || 'N/A'})
                </Text>
                <Text
                  style={styles.geminiContent}
                  numberOfLines={isExpanded ? undefined : 5}>
                  {item.content}
                </Text>
                <Text style={styles.geminiHint}>
                  {isExpanded ? 'Tap to collapse' : 'Tap to expand'}
                </Text>
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
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="document-text" size={32} color="#007AFF" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>NurseAI</Text>
            <Text style={styles.headerSubtitle}>Clinical Assistant</Text>
          </View>
        </View>

        {/* Summary Cards */}
        {renderSummaryCards}

        {/* Gemini Suggestions */}
        {renderGeminiSuggestions}

        {/* Patient Tasks Section */}
        <View style={styles.tasksSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Patient Tasks</Text>
            <Text style={styles.sectionSubtitle}>
              {currentPatient 
                ? `Filtered: ${currentPatient.patientName} (ID: ${currentPatient.patientId})`
                : 'Sorted by emergency level'}
            </Text>
          </View>
          {renderTasks}
        </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
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
    padding: 12,
    paddingTop: 16,
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
