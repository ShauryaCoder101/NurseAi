import React from 'react';
import {TouchableOpacity, Text, StyleSheet} from 'react-native';

const Button = ({title, onPress, variant = 'primary', style}) => {
  const buttonStyle = variant === 'primary' ? styles.primaryButton : styles.secondaryButton;
  const textStyle = variant === 'primary' ? styles.primaryText : styles.secondaryText;

  return (
    <TouchableOpacity
      style={[buttonStyle, style]}
      onPress={onPress}
      activeOpacity={0.7}>
      <Text style={textStyle}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default Button;
