import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';

const Header = ({title, onBack, showBack = false}) => {
  return (
    <View style={styles.header}>
      {showBack && onBack && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.title}>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    marginRight: 15,
    padding: 5,
  },
  backButtonText: {
    fontSize: 24,
    color: '#007AFF',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
});

export default Header;
