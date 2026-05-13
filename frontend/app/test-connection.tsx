import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { API_BASE_URL, API_BASE_URL_HELP, HAS_API_BASE_URL } from '../constants/Config';

export default function TestConnectionScreen() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');

  const testConnection = async () => {
    if (!HAS_API_BASE_URL) {
      setResult(`❌ API URL NOT SET\n\n${API_BASE_URL_HELP}`);
      return;
    }

    setTesting(true);
    setResult('Testing...');
    
    try {
      console.log('Testing connection to:', API_BASE_URL);
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'HEAD',
      });
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        setResult(`✅ SUCCESS!\nConnected to: ${API_BASE_URL}\nStatus: ${response.status}`);
      } else {
        setResult(`❌ FAILED\nStatus: ${response.status}\nHealth endpoint did not respond successfully.`);
      }
    } catch (error) {
      console.error('Connection test error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setResult(`❌ CONNECTION FAILED\n\nError: ${errorMessage}\n\nCurrent URL: ${API_BASE_URL}\n\nTroubleshooting:\n1. Make sure your backend is running at this URL.\n2. Check EXPO_PUBLIC_API_URL in frontend/.env.\n3. Restart Expo after changing the env file.`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔧 Connection Test</Text>
      <Text style={styles.url}>Testing: {API_BASE_URL}</Text>
      
      <TouchableOpacity 
        style={[styles.button, testing && styles.buttonDisabled]}
        onPress={testConnection}
        disabled={testing}
      >
        {testing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Test Connection</Text>
        )}
      </TouchableOpacity>

      {result ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{result}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
  },
  url: {
    fontSize: 14,
    textAlign: 'center',
    color: '#666',
    marginBottom: 30,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#667eea',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultBox: {
    marginTop: 30,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ddd',
  },
  resultText: {
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
});
