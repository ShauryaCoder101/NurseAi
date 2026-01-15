# Nurse AI Mobile App

A React Native mobile application for managing transcripts and medical notes.

## Features

- **Homepage**: Landing page when the app opens
- **Transcript Page**: View and manage individual transcripts
- **History Page**: Browse all saved transcripts
- **About Page**: How to use guide and about us information

## Setup

1. Install dependencies:
```bash
npm install
```

2. For iOS:
```bash
cd ios && pod install && cd ..
npm run ios
```

3. For Android:
```bash
npm run android
```

## Project Structure

```
src/
├── navigation/     # Navigation configuration
├── screens/        # Main app screens
├── components/     # Reusable components
├── services/       # API and storage services
├── utils/          # Utility functions
└── styles/         # Styling constants
```
