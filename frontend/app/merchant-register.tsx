import React, { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '../lib/api';

export default function MerchantRegisterScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!phone || !password || !businessName) {
      Alert.alert('Error', 'Please fill required fields');
      return;
    }

    // Validate phone number: exactly 10 digits, Indian format (starts with 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      Alert.alert('Invalid Phone', 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/merchant/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password, businessName, address }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 400 && data.error?.includes('already exists')) {
          Alert.alert('Phone Already Registered', 'This phone number is already registered. Would you like to login instead?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Login', onPress: () => router.replace('/merchant-login') }
          ]);
        } else {
          Alert.alert('Registration Failed', data.error || 'Please try again');
        }
        setLoading(false);
        return;
      }

      // Save merchant data for profile display
      const merchantData = {
        ...data.merchant,
        name: data.merchant.businessName,
        shopName: data.merchant.businessName,
        address: address || ''
      };
      await AsyncStorage.setItem('@merchant_data', JSON.stringify(merchantData));

      // Registration successful - show success message and redirect to login
      Alert.alert(
        'Registration Successful! 🎉', 
        `Your merchant account has been created successfully.\n\nBusiness: ${businessName}\nPhone: ${phone}\n\nPlease login to continue.`,
        [
          { 
            text: 'Go to Login', 
            onPress: () => router.replace('/merchant-login') 
          }
        ]
      );
    } catch (error) {
      console.error('Merchant register error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error details:', errorMessage);
      Alert.alert(
        'Connection Error',
        `Cannot connect to server at ${API_BASE_URL}.\n\nMake sure:\n1. EXPO_PUBLIC_API_URL in frontend/.env points to the backend you want to use\n2. That backend is running\n3. Restart Expo after changing the env file`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#f7f3ff', '#f9f7ff', '#f3f1ff']} style={styles.background} />
      <View style={styles.glowTop} />
      <View style={styles.glowRight} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image source={require('../assets/images/nnplogo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>Register Merchant</Text>
            <Text style={styles.subtitle}>Create your merchant account</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Business Name *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="storefront-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="Enter your business name"
                placeholderTextColor="#9b9fb4"
                value={businessName}
                onChangeText={setBusinessName}
              />
            </View>

            <Text style={styles.label}>Phone Number *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="call-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor="#9b9fb4"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </View>

            <Text style={styles.label}>Business Address (optional)</Text>
            <View style={[styles.inputWrapper, styles.multilineWrapper]}>
              <Ionicons name="location-outline" size={18} color="#6f63ff" style={{ marginRight: 4, marginTop: 14, alignSelf: 'flex-start' }} />
              <TextInput
                style={[styles.input, styles.multilineInput]}
                placeholder="Enter business address"
                placeholderTextColor="#9b9fb4"
                value={address}
                onChangeText={setAddress}
                multiline
                numberOfLines={2}
              />
            </View>

            <Text style={styles.label}>Password *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="Min 6 characters"
                placeholderTextColor="#9b9fb4"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.mainBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.mainBtnText}>Register Merchant</Text>}
            </Pressable>
          </View>

          <Pressable style={styles.footerLink} onPress={() => router.replace('/merchant-login')}>
            <Text style={styles.footerLinkText}>Already registered? <Text style={styles.footerLinkBold}>Login</Text></Text>
          </Pressable>

          <View style={{ height: 30 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f3ff' },
  background: { ...StyleSheet.absoluteFillObject },
  glowTop: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#efe9ff',
    top: -170,
    left: -100,
    opacity: 0.9,
  },
  glowRight: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#f3eaff',
    top: 120,
    right: -120,
    opacity: 0.7,
  },
  glowBottom: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#f0f7ff',
    bottom: -160,
    left: -80,
    opacity: 0.7,
  },
  kav: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 20 },

  header: { marginBottom: 24, alignItems: 'center' as const },
  logo: { width: 64, height: 64, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#1f2433', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#8b8fa6', fontWeight: '600' },

  card: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 24,
    padding: 22,
    marginBottom: 20,
    shadowColor: '#b8aef0',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9b9fb4',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f7f6fb', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e7e5f6',
    paddingHorizontal: 14, marginBottom: 16,
  },
  multilineWrapper: { alignItems: 'flex-start' },
  inputIcon: { fontSize: 18, marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: '#1f2433', paddingVertical: 14, fontWeight: '600' },
  multilineInput: { minHeight: 56, textAlignVertical: 'top' },

  mainBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#6f63ff',
    marginTop: 6,
    shadowColor: '#6f63ff',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.6 },

  footerLink: { alignItems: 'center', marginBottom: 14 },
  footerLinkText: { color: '#8b8fa6', fontSize: 14, fontWeight: '600' },
  footerLinkBold: { color: '#1f2433', fontWeight: '800' },
});
