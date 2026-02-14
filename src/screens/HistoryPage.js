import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
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
  Pressable,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Card from '../components/common/Card';
import apiService from '../services/apiService';
import useKeyboardCentering from '../hooks/useKeyboardCentering';

const HistoryPage = ({navigation}) => {
  const [transcripts, setTranscripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState(null);
  const [openCaseLoading, setOpenCaseLoading] = useState({});
  const listRef = useRef(null);
  const {onScroll, handleFocus} = useKeyboardCentering(listRef);

  // Memoized fetch function - all data from backend
  const fetchTranscripts = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true);
        setError(null);
      }

      const result = await apiService.getTranscripts();
      
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
  }, []);

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
        t.patientName?.toLowerCase().includes(query) ||
        t.patientId?.toLowerCase().includes(query)
    );
  }, [transcripts, searchQuery]);

  // Memoized render functions
  const toggleTranscript = useCallback((id) => {
    setExpandedTranscriptId((prev) => (prev === id ? null : id));
  }, []);

  const renderItem = useCallback(
    ({item}) => {
      const isExpanded = expandedTranscriptId === item.id;
      const canOpenCase = item.source === 'gemini' && item.suggestionCompleted;
      return (
        <Pressable
          onPress={() => toggleTranscript(item.id)}
          onLongPress={() => navigation.navigate('Transcript', {transcriptId: item.id})}
          style={styles.cardPressable}>
          <Card>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardTitle}>
                  {item.patientName || 'Unknown Patient'}
                </Text>
                <Text style={styles.cardSubtitle}>
                  ID: {item.patientId || 'N/A'}
                </Text>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.cardDate}>{item.date || ''}</Text>
                {item.source === 'gemini' ? (
                  <View style={styles.cardBadge}>
                    <Text style={styles.cardBadgeText}>AI</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Text
              style={styles.cardContent}
              numberOfLines={isExpanded ? undefined : 5}>
              {item.content || item.preview || 'No content available'}
            </Text>
            <Text style={styles.cardHint}>
              {isExpanded ? 'Tap to collapse' : 'Tap to expand'} · Long press to open
            </Text>
            {isExpanded && canOpenCase && (
              <TouchableOpacity
                style={[
                  styles.openCaseButton,
                  openCaseLoading[item.id] && styles.openCaseButtonDisabled,
                ]}
                onPress={async () => {
                  setOpenCaseLoading((prev) => ({...prev, [item.id]: true}));
                  const result = await apiService.reopenGeminiSuggestion(item.id);
                  if (result.success) {
                    setTranscripts((prev) =>
                      prev.map((t) =>
                        t.id === item.id ? {...t, suggestionCompleted: false} : t
                      )
                    );
                  } else {
                    setError(result.error || 'Failed to reopen case');
                  }
                  setOpenCaseLoading((prev) => ({...prev, [item.id]: false}));
                }}
                disabled={openCaseLoading[item.id]}>
                <Text style={styles.openCaseButtonText}>
                  {openCaseLoading[item.id] ? 'Opening...' : 'Open Case'}
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        </Pressable>
      );
    },
    [expandedTranscriptId, navigation, openCaseLoading, toggleTranscript]
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#999999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by patient name or ID..."
            placeholderTextColor="#999999"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={handleFocus}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#999999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        ref={listRef}
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
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
  cardPressable: {
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardHeaderText: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333333',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#666666',
    marginTop: 2,
  },
  cardMeta: {
    alignItems: 'flex-end',
  },
  cardDate: {
    fontSize: 12,
    color: '#999999',
  },
  cardBadge: {
    marginTop: 6,
    backgroundColor: '#E5F2FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  cardBadgeText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '600',
  },
  cardContent: {
    fontSize: 14,
    color: '#444444',
    lineHeight: 20,
  },
  cardHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#999999',
  },
  openCaseButton: {
    marginTop: 12,
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  openCaseButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  openCaseButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
    backgroundColor: '#F5F5F5',
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
