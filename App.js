import {registerRootComponent} from 'expo';
import React, {useContext, useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Text,
  ScrollView,
  Pressable,
} from 'react-native';
import {AuthProvider, AuthContext} from './src/context/AuthContext';
import AuthNavigator from './src/navigation/AuthNavigator';
import AppNavigator from './src/navigation/AppNavigator';
import {apiService} from './src/services/apiService';
import authService from './src/services/authService';

const CONSENT_TEXT = `1. Identity of the Data Fiduciary
This Informed Consent Form ("Form") is issued by ......, operated by -- [Legal Entity Name] --, a company incorporated under the (Companies Act, 2013 or whatever registration), having its registered office at -- [Full Registered Address] -- ("Nurse AI", "Application", "we", "us", or "our").
This Form is provided in accordance with the Digital Personal Data Protection Act, 2023 ("DPDPA"), the Information Technology Act, 2000, and other applicable laws of India.
Before using the Application, you are required to read and provide your voluntary, informed, specific, and unambiguous consent to the collection and processing of your personal data as described below.

2. Nature and Scope of the Service
Nurse AI is an artificial intelligence-powered conversational system that provides an automated health assessment and risk indication based solely on the information voluntarily provided by you.
The Application:
- Does not provide medical prescriptions
- Does not issue medical certificates
- Does not replace consultation with a licensed medical practitioner
- Does not provide emergency medical services
The output generated is informational and assistive in nature only.
In case of a medical emergency, please immediately contact the nearest hospital or call emergency services.

3. Categories of Personal Data Collected
In accordance with the principle of data minimisation under the DPDPA, we collect only such data as is necessary for the specified purpose.
The categories of data collected include:
- Personal Identifiers: Name, age, gender, date of birth, contact details
- Physical Health Information: Height, weight, BMI (where provided)
- Medical History Information: Pre-existing conditions, allergies, medications, prior diagnoses voluntarily disclosed
- Symptom Information: Health complaints and symptoms described during consultation
- Consultation Records: Audio recordings and/or text transcripts of AI interaction
- Technical Information: Device information, IP address, session logs (for security and fraud prevention purposes)
No personal data is collected without your active submission or interaction with the Application.

4. Purpose of Processing
Your personal data is processed solely for:
1. Generating an AI-assisted health assessment
2. Improving the safety, accuracy, and functionality of the Application
3. Maintaining security, fraud detection, and system integrity
4. Complying with applicable legal obligations
Your data shall not be used for marketing, advertising, profiling, or monetisation purposes without obtaining fresh and explicit consent from you.

5. Automated Processing Disclosure
The health assessment is generated entirely through automated processing systems without human medical review, unless explicitly stated otherwise.
You acknowledge that automated systems may:
- Produce inaccurate or incomplete outputs
- Misinterpret user-provided information
- Fail to detect certain medical conditions
The output does not constitute a confirmed medical diagnosis.

6. Research and Development Use
Your data may be used for internal research and system improvement strictly on a de-identified or anonymised basis.
Such use:
- Will not identify you personally
- Will not involve sale of identifiable personal data
- Will not involve targeted advertising
- Will not involve commercial licensing of identifiable health records
If identifiable data is ever required for research beyond internal system improvement, separate consent will be obtained.

7. Data Storage, Retention and Cross-Border Transfers
Your data is stored on encrypted cloud infrastructure maintained by -- [Cloud Provider Name] --.
Data Retention Period
Personal data shall be retained for -- [X years / duration] -- from the date of last interaction, unless:
- Earlier deletion is requested by you, or
- Retention is required under applicable law
After the retention period, data will be permanently deleted or irreversibly anonymised.
Cross-Border Processing
Your data may be processed or stored on servers located outside India, subject to safeguards permitted under applicable law.

8. Data Security Measures
We implement reasonable security safeguards as required under the DPDPA, including:
- Encryption in transit and at rest
- Access control mechanisms
- Periodic security audits
- Organisational data protection protocols
While we implement industry-standard safeguards, no digital transmission or storage system is completely risk-free.
Nothing in this Form excludes liability for failure to implement reasonable security safeguards as required under applicable law.

9. Data Breach Notification
In the event of a notifiable personal data breach, we shall notify:
- The Data Protection Board of India (where required), and
- Affected Data Principals,
in accordance with applicable law.

10. Children and Persons Under 18 Years
The Application is not intended for individuals below 18 years of age.
If a minor seeks to use the Application, verifiable parental consent must be obtained in accordance with Section 9 of the DPDPA.
We do not knowingly process personal data of children without lawful consent.

11. Your Rights as a Data Principal
Under the DPDPA, you have the right to:
- Access your personal data
- Correct inaccurate or incomplete data
- Request erasure of your personal data
- Withdraw consent at any time
- Nominate another person to exercise rights in case of death or incapacity
- Seek grievance redressal
Requests may be made at:
Data Protection Officer: --
Email:
Grievance Portal: --
Response Time:

12. Withdrawal of Consent
You may withdraw your consent at any time by:
- Using the "Withdraw Consent" feature within the Application
- Writing to:
- Contacting:
Upon withdrawal, further processing will cease, and deletion procedures will be initiated within 30 days, except where retention is required by law.
Withdrawal shall not affect the lawfulness of processing prior to withdrawal.

13. Limitation of Liability
To the extent permitted under applicable law:
- The Application shall not be liable for reliance solely on AI-generated outputs without consulting a qualified medical professional.
- Liability shall not be excluded for gross negligence, wilful misconduct, or statutory violations.
- Nothing in this Form limits your statutory rights under consumer protection or data protection laws.

14. Granular Consent
By signing below, you provide explicit consent to:
[ ] Collection and processing of personal and health data for AI-assisted assessment
[ ] Recording and storage of consultation interactions
[ ] Use of de-identified data for research and system improvement
[ ] Cross-border storage and processing (if applicable)
You may choose not to consent to research use without affecting access to core assessment functionality.

15. Declaration
I, the undersigned, declare that:
- I have read and understood this Form
- I am above 18 years of age (or have lawful parental consent)
- I understand the risks and limitations of automated AI-generated health assessments
- I understand this is not a substitute for consultation with a licensed medical practitioner
- My consent is free, informed, specific, and unambiguous
- I may withdraw consent at any time`;

const AppContent = () => {
  const {isAuthenticated, loading, user, updateUser} = useContext(AuthContext);
  const [consentChecked, setConsentChecked] = useState(false);
  const [hasConsented, setHasConsented] = useState(true);
  const [submittingConsent, setSubmittingConsent] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadConsentStatus = async () => {
      if (!isAuthenticated) {
        if (isMounted) {
          setConsentChecked(true);
          setHasConsented(true);
        }
        return;
      }

      if (isMounted) {
        setConsentChecked(false);
      }

      const result = await apiService.getConsentStatus();
      if (!isMounted) return;

      if (result.success && result.data) {
        const status = !!result.data.hasConsented;
        setHasConsented(status);
        setConsentChecked(true);
        const nextUser = {
          ...(user || {}),
          hasConsented: status,
          consentedAt: result.data.consentedAt || null,
        };
        await authService.setUserData(nextUser);
        updateUser(nextUser);
      } else {
        const fallbackStatus = !!user?.hasConsented;
        setHasConsented(fallbackStatus);
        setConsentChecked(true);
      }
    };

    loadConsentStatus();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const handleAcceptConsent = async () => {
    if (submittingConsent) return;
    setSubmittingConsent(true);
    const result = await apiService.acceptConsent();
    if (result.success && result.data) {
      setHasConsented(true);
      setConsentChecked(true);
      const nextUser = {
        ...(user || {}),
        hasConsented: true,
        consentedAt: result.data.consentedAt || new Date().toISOString(),
      };
      await authService.setUserData(nextUser);
      updateUser(nextUser);
    }
    setSubmittingConsent(false);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (isAuthenticated && !consentChecked) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.appContainer}>
      <NavigationContainer>
        {isAuthenticated ? <AppNavigator /> : <AuthNavigator />}
      </NavigationContainer>
      <Modal
        visible={isAuthenticated && consentChecked && !hasConsented}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>INFORMED CONSENT FORM</Text>
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
            >
              <Text style={styles.modalText}>{CONSENT_TEXT}</Text>
            </ScrollView>
            <Pressable
              style={[
                styles.consentButton,
                submittingConsent && styles.consentButtonDisabled,
              ]}
              onPress={handleAcceptConsent}
            >
              <Text style={styles.consentButtonText}>
                {submittingConsent ? 'Submitting...' : 'Agree and Continue'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 16,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  modalBody: {
    flexGrow: 0,
  },
  modalBodyContent: {
    paddingBottom: 16,
  },
  modalText: {
    fontSize: 14,
    color: '#2A2A2A',
    lineHeight: 20,
  },
  consentButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  consentButtonDisabled: {
    opacity: 0.6,
  },
  consentButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default App;
registerRootComponent(App);
