const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
  expo: {
    name: IS_DEV ? 'Nurse AI Hibiscus' : 'Nurse AI',
    slug: 'nurseai',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_DEV ? 'com.nurseai.app.dev' : 'com.nurseai.app',
      infoPlist: {
        NSMicrophoneUsageDescription: 'We need access to your microphone to record patient notes.',
        NSCameraUsageDescription: 'We need camera access to take patient photos.',
        NSPhotoLibraryUsageDescription: 'We need photo library access to attach patient images.',
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
    },
    android: {
      usesCleartextTraffic: true,
      permissions: [
        'RECORD_AUDIO',
        'CAMERA',
        'READ_MEDIA_IMAGES',
        'READ_EXTERNAL_STORAGE',
      ],
      adaptiveIcon: {
        backgroundColor: '#ffffff',
      },
      package: IS_DEV ? 'com.nurseai.app.dev' : 'com.nurseai.app',
    },
    extra: {
      eas: {
        projectId: '19a81a18-b3a5-490b-9c4f-d6142b3cb09f',
      },
    },
  },
};
