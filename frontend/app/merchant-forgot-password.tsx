import React, { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { API_BASE_URL } from '../lib/api';

export default function MerchantForgotPasswordScreen() {
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async () => {
    if (!phone || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/merchant/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          Alert.alert('Account Not Found', 'No merchant account found with this phone number. Please register first.');
        } else {
          Alert.alert('Reset Failed', data.error || 'Please try again');
        }
        setLoading(false);
        return;
      }

      Alert.alert('Success', 'Password reset successfully! You can now login with your new password.', [
        { text: 'OK', onPress: () => router.replace('/merchant-login') }
      ]);
    } catch (error) {
      console.error('Merchant forgot password error:', error);
      Alert.alert('Error', 'Network error. Please try again.');
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
            <Text style={styles.title}>Reset Merchant Password</Text>
            <Text style={styles.subtitle}>Enter your phone number and set a new password</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Phone Number</Text>
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

            <Text style={styles.label}>New Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="Min 6 characters"
                placeholderTextColor="#9b9fb4"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
            </View>

            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                placeholderTextColor="#9b9fb4"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Reset Password</Text>
              )}
            </Pressable>
          </View>

          <Pressable onPress={() => router.back()} style={styles.linkWrap}>
            <Text style={styles.linkText}><Ionicons name="arrow-back" size={13} color="#6f63ff" /> Back to Login</Text>
          </Pressable>
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
  header: { marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '800', color: '#1f2433', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#8b8fa6', fontWeight: '600' },
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f7f6fb',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e7e5f6',
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  inputIcon: { fontSize: 18, marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: '#1f2433', paddingVertical: 14, fontWeight: '600' },
  button: {
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
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkWrap: { alignItems: 'center' },
  linkText: {
    textAlign: 'center',
    color: '#6f63ff',
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
  },
});
