import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TranscriptCard from '../components/transcript/TranscriptCard';
import apiService from '../services/apiService';

const CURRENT_PATIENT_KEY = '@nurseai_current_patient';

const HistoryPage = ({navigation}) => {
  const [transcripts, setTranscripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  const [currentPatient, setCurrentPatient] = useState(null);

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
  const fetchTranscripts = useCallback(async (isRefresh = false) => {
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

      const result = await apiService.getTranscripts(patientParams);
      
      if (result.success) {
        // Only use data from backend, no fallback
        setTranscripts(result.data || []);
        setError(null);
      } else {
        // Backend error - show empty state
        setTranscripts([]);
        setError(result.error || 'Failed to load transcripts');
      }
    } catch (error) {
      console.error('Error fetching transcripts:', error);
      setTranscripts([]);
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPatient]);

  // Initial load
  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  // Pull to refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    apiService.clearCache();
    fetchTranscripts(true);
  }, [fetchTranscripts]);

  // Memoized filtered transcripts
  const filteredTranscripts = useMemo(() => {
    if (!searchQuery.trim()) return transcripts;
    
    const query = searchQuery.toLowerCase();
    return transcripts.filter(
      (t) =>
        t.title?.toLowerCase().includes(query) ||
        t.preview?.toLowerCase().includes(query) ||
        t.patientName?.toLowerCase().includes(query)
    );
  }, [transcripts, searchQuery]);

  // Memoized render functions
  const renderItem = useCallback(
    ({item}) => (
      <TranscriptCard
        transcript={item}
        onPress={() => navigation.navigate('Transcript', {transcriptId: item.id})}
      />
    ),
    [navigation]
  );

  const renderEmpty = useMemo(() => {
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.emptyText}>Error Loading Transcripts</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={() => fetchTranscripts()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="document-text-outline" size={64} color="#CCCCCC" />
        <Text style={styles.emptyText}>No transcripts found</Text>
        <Text style={styles.emptySubtext}>
          {searchQuery 
            ? 'Try a different search term' 
            : 'No transcripts available. Create your first transcript from the Dashboard.'}
        </Text>
      </View>
    );
  }, [searchQuery, error, fetchTranscripts]);

  const keyExtractor = useCallback((item) => item.id, []);

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
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        {currentPatient && (
          <Text style={styles.patientFilter}>
            Filtered: {currentPatient.patientName} (ID: {currentPatient.patientId})
          </Text>
        )}
        
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#999999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search transcripts..."
            placeholderTextColor="#999999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#999999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={filteredTranscripts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={
          filteredTranscripts.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 12,
  },
  patientFilter: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    marginBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333333',
  },
  list: {
    padding: 12,
  },
  emptyList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999999',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default React.memo(HistoryPage);
