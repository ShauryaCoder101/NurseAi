import React from 'react';
import {render} from '@testing-library/react-native';
import HomePage from '../../src/screens/HomePage';

describe('HomePage', () => {
  it('renders correctly', () => {
    const {getByText} = render(<HomePage />);
    expect(getByText('Welcome to Nurse AI')).toBeTruthy();
  });
});
