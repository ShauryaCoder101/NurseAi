import React, {useContext} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {AuthContext} from '../context/AuthContext';

const AboutPage = () => {
  const {logout} = useContext(AuthContext);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>How to Use</Text>
          <View style={styles.section}>
            <Text style={styles.stepTitle}>1. Create a Transcript</Text>
            <Text style={styles.stepText}>
              Navigate to the Home page and tap "New Transcript" to start creating a new medical transcript.
            </Text>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.stepTitle}>2. Enter Content</Text>
            <Text style={styles.stepText}>
              Type or paste your transcript content in the text field. You can edit and format as needed.
            </Text>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.stepTitle}>3. Save Your Work</Text>
            <Text style={styles.stepText}>
              Tap "Save Transcript" to store your transcript. It will be available in the History page.
            </Text>
          </View>
          
          <View style={styles.section}>
            <Text style={styles.stepTitle}>4. View History</Text>
            <Text style={styles.stepText}>
              Access all your saved transcripts from the History tab. Tap any transcript to view or edit it.
            </Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>About Us</Text>
          <View style={styles.section}>
            <Text style={styles.aboutText}>
              Nurse AI is a mobile application designed to help healthcare professionals manage and organize medical transcripts efficiently.
            </Text>
            <Text style={styles.aboutText}>
              Our mission is to streamline medical documentation and improve workflow for nurses and healthcare providers.
            </Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.version}>Version 1.0.0</Text>
            
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    marginTop: 10,
  },
  section: {
    marginBottom: 25,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 8,
  },
  stepText: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 30,
  },
  aboutText: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 15,
  },
  footer: {
    marginTop: 30,
    marginBottom: 20,
    alignItems: 'center',
  },
  version: {
    fontSize: 14,
    color: '#999',
    marginBottom: 24,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  logoutText: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default AboutPage;
