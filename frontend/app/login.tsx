import React, { useState, useEffect } from 'react';
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
import { saveOfflineSession, tryOfflineLogin, hasOfflineSession } from '../lib/offlineAuth';
import type { AuthUser } from '../hooks/useAuth';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [canLoginOffline, setCanLoginOffline] = useState(false);

  // Check on mount whether a cached session exists so we can show the hint.
  useEffect(() => {
    hasOfflineSession('user').then(setCanLoginOffline);
  }, []);

  const handleLogin = async () => {
    if (!phone || !password) {
      Alert.alert('Error', 'Please enter phone and password');
      return;
    }
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      Alert.alert('Invalid Phone', 'Please enter a valid 10-digit Indian mobile number');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert('Login Failed', response.status === 401 ? 'Invalid phone number or password.' : data.error || 'Please try again');
        return;
      }
      if (!data.success || !data.token || !data.user) {
        Alert.alert('Error', 'Invalid response from server');
        return;
      }
      await AsyncStorage.setItem('@auth_token', data.token);
      await AsyncStorage.setItem('@user_data', JSON.stringify(data.user));
      await AsyncStorage.setItem('@user_id', data.user.userId);

      // ── Cache credentials for future offline logins ──────────────────────
      await saveOfflineSession('user', phone, password, {
        token: data.token,
        user: data.user,
      });

      router.replace('/user/wallet');
    } catch {
      // ── Network unreachable — attempt offline login ───────────────────────
      const offline = await tryOfflineLogin('user', phone, password);

      if (offline.success && offline.role === 'user') {
        const user = offline.user as AuthUser;
        await AsyncStorage.setItem('@auth_token', offline.token);
        await AsyncStorage.setItem('@user_data', JSON.stringify(user));
        await AsyncStorage.setItem('@user_id', user.userId);

        Alert.alert(
          '📴 Offline Mode',
          'No internet connection. You are logged in using your cached session. ' +
          'Payments & sync will work once you are back online.',
          [{ text: 'Continue', onPress: () => router.replace('/user/wallet') }]
        );
      } else if (offline.success === false && offline.reason === 'no_cache') {
        Alert.alert(
          'No Internet Connection',
          'You need an internet connection for your first login on this device. ' +
          'Once logged in online, future logins will work offline too.'
        );
      } else {
        // wrong_credentials — cached hash didn't match
        Alert.alert('Login Failed', 'Incorrect phone number or password.');
      }
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
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Sign in to your wallet</Text>
            {canLoginOffline && (
              <View style={styles.offlineBadge}>
                <Ionicons name="cloud-offline-outline" size={13} color="#6f63ff" />
                <Text style={styles.offlineBadgeText}>Offline login available</Text>
              </View>
            )}
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
                autoCapitalize="none"
                maxLength={10}
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color="#6f63ff" style={{ marginRight: 4 }} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#9b9fb4"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.mainBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.mainBtnText}>Login</Text>}
            </Pressable>

            <Pressable onPress={() => router.push('/forgot-password')}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </Pressable>
          </View>

          <Pressable style={styles.footerLink} onPress={() => router.push('/register')}>
            <Text style={styles.footerLinkText}>Don't have an account? <Text style={styles.footerLinkBold}>Register</Text></Text>
          </Pressable>

          <Pressable style={styles.switchBtn} onPress={() => router.push('/merchant-login')}>
            <View style={styles.switchBtnInner}>
              <Text style={styles.switchBtnText}>🏪 Login as Merchant</Text>
            </View>
          </Pressable>

          <View style={{ height: 30 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f3ff' },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
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
    backgroundColor: '#f7f6fb',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e7e5f6',
    paddingHorizontal: 14, marginBottom: 16,
  },
  inputIcon: { fontSize: 18, marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: '#1f2433', paddingVertical: 14, fontWeight: '600' },

  mainBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#6f63ff',
    marginTop: 6,
    marginBottom: 16,
    shadowColor: '#6f63ff',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.6 },

  forgotText: { textAlign: 'center', color: '#6f63ff', fontSize: 13, fontWeight: '700' },

  footerLink: { alignItems: 'center', marginBottom: 14 },
  footerLinkText: { color: '#8b8fa6', fontSize: 14, fontWeight: '600' },
  footerLinkBold: { color: '#1f2433', fontWeight: '800' },

  switchBtn: { borderRadius: 16, overflow: 'hidden' },
  switchBtnInner: {
    paddingVertical: 16, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e3def7',
    borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.75)',
  },
  switchBtnText: { color: '#1f2433', fontSize: 14, fontWeight: '700' },

  offlineBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(111,99,255,0.1)',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(111,99,255,0.25)',
  },
  offlineBadgeText: { fontSize: 12, color: '#6f63ff', fontWeight: '700' },
});
