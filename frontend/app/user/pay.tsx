import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getUserId, signPayloadHex, ensureUserKeypairAndId, getPublicKeyHex } from "../../lib/cryptoKeys";
import { API_BASE_URL, saveLocalBalance, getLocalBalance, deductLocalBalance, queueOfflineTransaction, saveGeneratedVoucher, getGeneratedVouchers, syncOfflineTransactions, GeneratedVoucher, VOUCHER_EXPIRY_DAYS, isVoucherExpired, refundExpiredVouchers } from "../../lib/api";
import { OfflineBanner } from "../../components/OfflineBanner";

type MerchantInfo = {
  merchantId: string;
  name?: string;
} | null;

type Voucher = {
  voucherId: string;
  merchantId: string;
  amount: number;
  createdAt: string;
  issuedTo: string;
  signature: string;
  messageHashHex?: string;
  publicKeyHex?: string;
};

export default function UserPayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(true);
  const [merchant, setMerchant] = useState<MerchantInfo>(null);
  const [amount, setAmount] = useState("");
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [unusedVouchers, setUnusedVouchers] = useState<GeneratedVoucher[]>([]);
  const [showingVoucher, setShowingVoucher] = useState<GeneratedVoucher | null>(null);

  // Initialize user keypair on screen load
  useEffect(() => {
    (async () => {
      await ensureUserKeypairAndId();
      // Refund any expired vouchers first, then refresh the list
      const token = await AsyncStorage.getItem('@auth_token');
      await refundExpiredVouchers(token);
      // Load any vouchers user generated but hasn't shown to a merchant yet
      const all = await getGeneratedVouchers();
      setUnusedVouchers(all.filter((v) => !v.used));
    })();
  }, []);

  // Load current balance — online from backend, offline from local cache
  const loadBalance = useCallback(async () => {
    try {
      setLoadingBalance(true);
      const token = await AsyncStorage.getItem('@auth_token');

      if (!token) { setBalance(0); setLoadingBalance(false); return; }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(`${API_BASE_URL}/api/balance`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        setBalance(data.balance);
        setIsOffline(false);
        await saveLocalBalance(data.balance);
        // Sync pending offline transactions then re-fetch so balance reflects deductions
        const syncedCount = await syncOfflineTransactions(token).catch(() => 0);
        if (syncedCount > 0) {
          const refreshed = await fetch(`${API_BASE_URL}/api/balance`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (refreshed.ok) {
            const rd = await refreshed.json();
            setBalance(rd.balance);
            await saveLocalBalance(rd.balance);
          }
        }
      } else {
        // Backend error — use cached balance
        const cached = await getLocalBalance();
        setBalance(cached ?? 0);
        setIsOffline(cached !== null);
      }
    } catch {
      // No network — use cached balance so user can still pay offline
      const cached = await getLocalBalance();
      setBalance(cached ?? 0);
      setIsOffline(true);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (!isScanning) return;
    setIsScanning(false);
    handleMerchantScanned(data);
  };

  const handleMerchantScanned = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      setMerchant({
        merchantId: parsed.merchantId,
        name: parsed.name,
      });
      setError(null);
    } catch (e) {
      console.log("Invalid merchant QR", e);
      setMerchant(null);
      setError("Could not read merchant QR");
      setTimeout(() => {
        setIsScanning(true);
      }, 800);
    }
  };

  const handleGenerateVoucher = async () => {
    if (!merchant) {
      setError("Scan a merchant first");
      return;
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }

    if (balance === null) {
      setError("Balance not loaded yet");
      return;
    }

    if (amt > balance) {
      setError("Insufficient offline balance");
      return;
    }

    try {
      // Get user ID and public key for offline verification
      const userId = await getUserId();
      const publicKeyHex = await getPublicKeyHex();
      
      if (!userId || !publicKeyHex) {
        setError("User ID not found. Please restart the app.");
        return;
      }

      const payload = {
        voucherId: `V_${Date.now()}`,
        merchantId: merchant.merchantId,
        amount: amt,
        createdAt: new Date().toISOString(),
        issuedTo: userId
      };

      // Sign with ECDSA
      const { signatureHex, messageHashHex } = await signPayloadHex(payload);

      // Create final voucher with public key for offline verification
      const newVoucher: Voucher = {
        ...payload,
        signature: signatureHex,
        messageHashHex, // optional: helps debugging
        publicKeyHex, // included so merchant can verify offline
      };

      // ── Deduct balance: try backend first, fall back to offline ──
      const token = await AsyncStorage.getItem('@auth_token');
      let usedOfflinePath = false;

      if (token) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const response = await fetch(`${API_BASE_URL}/api/balance/deduct`, {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              amount: amt,
              merchantId: merchant.merchantId,
              voucherId: payload.voucherId
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            setBalance(data.balance);
            setIsOffline(false);
            // Keep local cache in sync with server
            await saveLocalBalance(data.balance);
          } else {
            const errorData = await response.json();
            setError(errorData.error || 'Payment failed');
            return;
          }
        } catch {
          // Network unreachable — use offline path
          usedOfflinePath = true;
        }
      } else {
        usedOfflinePath = true;
      }

      // ── Offline path: deduct locally & queue for sync ──────────
      if (usedOfflinePath) {
        const newBalance = await deductLocalBalance(amt);
        setBalance(newBalance);
        setIsOffline(true);
        // Store transaction — will sync to backend when internet returns
        await queueOfflineTransaction({
          voucherId: payload.voucherId,
          userId: userId!,
          merchantId: merchant.merchantId,
          merchantName: merchant.name,
          amount: amt,
          timestamp: payload.createdAt,
          signature: signatureHex,
          publicKeyHex: publicKeyHex!,
          status: "pending",
        });
      }

      setVoucher(newVoucher);
      setError(null);

      // Save so user can show this QR again if merchant hasn't scanned it yet
      const expiresAt = new Date(Date.now() + VOUCHER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await saveGeneratedVoucher({
        voucherId: newVoucher.voucherId,
        merchantId: newVoucher.merchantId,
        merchantName: merchant?.name,
        amount: newVoucher.amount,
        createdAt: newVoucher.createdAt,
        expiresAt,
        issuedTo: newVoucher.issuedTo,
        signature: newVoucher.signature,
        publicKeyHex: newVoucher.publicKeyHex ?? '',
        used: false,
      });
      // Refresh unused-voucher list (new one added, not yet used)
      const all = await getGeneratedVouchers();
      setUnusedVouchers(all.filter((v) => !v.used));
    } catch (e) {
      console.log("Error signing voucher / updating balance:", e);
      console.error("Full error:", JSON.stringify(e, null, 2));
      setError(`Could not generate signed voucher: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#f7f3ff', '#f9f7ff', '#f3f1ff']} style={styles.background} />

      {/* M9: Offline banner */}
      <OfflineBanner
        visible={isOffline}
        onRetry={loadBalance}
        message="Offline — payments will sync when connected"
      />

      <View style={styles.glowTop} />
      <View style={styles.glowRight} />
      <View style={styles.glowBottom} />

      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#1f2433" />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <Ionicons name="card-outline" size={20} color="#6f63ff" />
          <Text style={styles.headerTitle}>Pay Merchant</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          {loadingBalance ? (
            <ActivityIndicator color="#667eea" size="small" style={{marginTop: 8}} />
          ) : (
            <Text style={styles.balanceAmount}>₹{balance ?? 0}</Text>
          )}
          {isOffline && (
            <View style={styles.offlineBadge}><Ionicons name="cloud-offline-outline" size={12} color="#6f63ff" /><Text style={styles.offlineBadgeText}>Offline — cached balance</Text></View>
          )}
        </View>

        {/* ── UNUSED VOUCHERS — generated but not yet shown to merchant ── */}
        {!merchant && !voucher && !showingVoucher && unusedVouchers.length > 0 && (
          <View style={styles.stepCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}><Ionicons name="ticket-outline" size={16} color="#6f63ff" /><Text style={styles.unusedTitle}>Unused Vouchers</Text></View>
            <Text style={styles.unusedSub}>
              These were generated but the merchant hasn't scanned them yet. Tap to show the QR again.
            </Text>
            {unusedVouchers.map((v) => {
              const expired = isVoucherExpired(v);
              const expiryDate = v.expiresAt
                ? new Date(v.expiresAt).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })
                : null;
              const daysLeft = v.expiresAt
                ? Math.max(0, Math.ceil((new Date(v.expiresAt).getTime() - Date.now()) / 86400000))
                : null;
              return (
                <Pressable
                  key={v.voucherId}
                  style={[styles.unusedRow, expired && styles.unusedRowExpired]}
                  onPress={() => !expired && setShowingVoucher(v)}
                  disabled={expired}
                >
                  <View style={styles.unusedInfo}>
                    <Text style={[styles.unusedAmount, expired && styles.unusedAmountExpired]}>
                      ₹{v.amount}
                    </Text>
                    <Text style={styles.unusedMerchant}>{v.merchantName || v.merchantId}</Text>
                    <Text style={styles.unusedDate}>
                      Created: {new Date(v.createdAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                    {expiryDate && !expired && (
                      <View style={[styles.expiryBadge, daysLeft !== null && daysLeft <= 1 && styles.expiryBadgeUrgent]}>
                        <Text style={[styles.expiryBadgeText, daysLeft !== null && daysLeft <= 1 && styles.expiryBadgeTextUrgent]}>
                          ⏳ Expires {expiryDate}
                          {daysLeft === 0 ? ' (today!)' : daysLeft === 1 ? ' (tomorrow)' : ` (${daysLeft}d left)`}
                        </Text>
                      </View>
                    )}
                    {expired && (
                      <View style={styles.expiredBadge}>
                        <Text style={styles.expiredBadgeText}>● EXPIRED — amount refunded to wallet</Text>
                      </View>
                    )}
                  </View>
                  {!expired && <Text style={styles.unusedTap}>Show QR →</Text>}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ── RE-SHOW UNUSED VOUCHER QR ── */}
        {showingVoucher && !voucher && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>📲</Text>
              <Text style={styles.stepTitle}>Show to Merchant</Text>
            </View>
            <View style={[styles.successBadge, { backgroundColor: '#fff3cd', borderColor: '#ffc107' }]}>
              <Text style={[styles.successText, { color: '#856404' }]}>
                ⚠️ Pending — merchant hasn't scanned this yet
              </Text>
            </View>
            <View style={styles.qrContainer}>
              <QRCode
                value={JSON.stringify(showingVoucher)}
                size={200}
                backgroundColor="#ffffff"
                color="#2d3748"
              />
            </View>
            <View style={styles.voucherDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Amount</Text>
                <Text style={styles.detailValue}>₹{showingVoucher.amount}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Merchant</Text>
                <Text style={styles.detailValue}>
                  {showingVoucher.merchantName || showingVoucher.merchantId}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Created</Text>
                <Text style={styles.detailValueSmall}>
                  {new Date(showingVoucher.createdAt).toLocaleString('en-IN')}
                </Text>
              </View>
              {showingVoucher.expiresAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Expires</Text>
                  <Text style={[styles.detailValueSmall, { color: '#d97706' }]}>
                    {new Date(showingVoucher.expiresAt).toLocaleString('en-IN')}
                  </Text>
                </View>
              )}
            </View>
            <Pressable style={styles.secondaryButton} onPress={() => setShowingVoucher(null)}>
              <Text style={styles.secondaryButtonText}>← Back</Text>
            </Pressable>
          </View>
        )}

        {/* STEP 1: SCAN MERCHANT */}
        {!merchant && !voucher && !showingVoucher && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>1</Text>
              <Text style={styles.stepTitle}>Scan Merchant QR Code</Text>
            </View>

            {!permission ? (
              <Text style={styles.permissionText}>Requesting camera permission...</Text>
            ) : !permission.granted ? (
              <View style={styles.permissionContainer}>
                <Text style={styles.permissionText}>Camera access needed</Text>
                <Pressable style={styles.primaryButton} onPress={requestPermission}>
                  <Text style={styles.primaryButtonText}>Grant Permission</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.cameraWrapper}>
                <View style={styles.cameraContainer}>
                  <CameraView
                    style={styles.camera}
                    facing="back"
                    onBarcodeScanned={handleBarCodeScanned}
                    barcodeScannerSettings={{
                      barcodeTypes: ["qr"],
                    }}
                  >
                    <View style={styles.overlay}>
                      <View style={styles.scanFrame} />
                    </View>
                  </CameraView>
                </View>
                <Text style={styles.scanInstructions}>
                  Point camera at merchant's QR code
                </Text>
              </View>
            )}
          </View>
        )}

        {/* STEP 2: ENTER AMOUNT */}
        {merchant && !voucher && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>2</Text>
              <Text style={styles.stepTitle}>Enter Payment Amount</Text>
            </View>
            
            <View style={styles.merchantInfo}>
              <Text style={styles.merchantLabel}>Merchant</Text>
              <Text style={styles.merchantName}>{merchant.name || 'Business'}</Text>
              <Text style={styles.merchantId}>ID: {merchant.merchantId}</Text>
            </View>

            <View style={styles.amountInputContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0"
                placeholderTextColor="#999"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </View>

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>⚠️ {error}</Text>
              </View>
            )}

            <Pressable
              style={[
                styles.primaryButton,
                amount ? styles.primaryButtonActive : styles.primaryButtonDisabled,
              ]}
              disabled={!amount}
              onPress={handleGenerateVoucher}
            >
              <Text style={styles.primaryButtonText}>Generate Payment Voucher</Text>
            </Pressable>

            <Text style={styles.infoText}>
              Your balance will be deducted after voucher generation
            </Text>
          </View>
        )}

        {/* STEP 3: SHOW VOUCHER QR */}
        {voucher && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>3</Text>
              <Text style={styles.stepTitle}>Payment Voucher Generated</Text>
            </View>
            
            <View style={styles.successBadge}>
              <Text style={styles.successText}>✅ Payment voucher created successfully!</Text>
            </View>

            <View style={styles.qrContainer}>
              <QRCode 
                value={JSON.stringify(voucher)} 
                size={200}
                backgroundColor="#ffffff"
                color="#2d3748"
              />
            </View>

            <View style={styles.voucherDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Amount:</Text>
                <Text style={styles.detailValue}>₹{voucher.amount}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Voucher ID:</Text>
                <Text style={styles.detailValueSmall}>{voucher.voucherId.slice(-8)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status:</Text>
                <Text style={isOffline ? styles.statusOffline : styles.statusOnline}>
                  {isOffline ? "Offline (will sync)" : "Online"}
                </Text>
              </View>
            </View>

            <Text style={styles.instructionText}>
              Show this QR code to the merchant for verification
            </Text>
            
            <Pressable
              style={styles.doneButton}
              onPress={() => {
                setVoucher(null);
                setMerchant(null);
                setAmount("");
                setIsScanning(true);
                loadBalance();
              }}
            >
              <Text style={styles.doneButtonText}>✓ Complete Payment</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f7f3ff",
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  glowTop: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "#efe9ff",
    top: -170,
    left: -100,
    opacity: 0.9,
  },
  glowRight: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#f3eaff",
    top: 120,
    right: -120,
    opacity: 0.7,
  },
  glowBottom: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "#f0f7ff",
    bottom: -160,
    left: -80,
    opacity: 0.7,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 0,
    paddingBottom: 30,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#c6bff3",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  backButtonText: {
    fontSize: 20,
    color: "#1f2433",
    fontWeight: "bold",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIcon: { fontSize: 20 },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f2433",
  },
  headerSpacer: {
    width: 40,
  },
  balanceCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#b8aef0',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  balanceLabel: {
    fontSize: 13,
    color: '#8b8fa6',
    fontWeight: '600',
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1f2433',
    marginTop: 6,
  },
  stepCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 22,
    borderRadius: 24,
    shadowColor: '#b8aef0',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6f63ff',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 32,
    marginRight: 12,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1f2433',
    flex: 1,
  },
  merchantInfo: {
    backgroundColor: '#f7f6fb',
    padding: 16,
    borderRadius: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#ede9fe',
  },
  merchantLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    marginBottom: 4,
  },
  merchantName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d3748',
    marginBottom: 2,
  },
  merchantId: {
    fontSize: 12,
    color: '#999',
    fontFamily: 'monospace',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f7f6fb',
    borderRadius: 14,
    paddingHorizontal: 18,
    marginBottom: 18,
    borderWidth: 2,
    borderColor: '#d9d3ff',
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6f63ff',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2d3748',
    paddingVertical: 16,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonActive: {
    backgroundColor: '#6f63ff',
  },
  primaryButtonDisabled: {
    backgroundColor: '#cbd5e0',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  errorContainer: {
    backgroundColor: '#fed7d7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#c53030',
    textAlign: 'center',
    fontWeight: '500',
  },
  infoText: {
    fontSize: 13,
    color: '#8b8fa6',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  cameraWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  cameraContainer: {
    width: '100%',
    height: 300,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#e7e5f6',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 18,
    backgroundColor: 'transparent',
  },
  scanInstructions: {
    fontSize: 13,
    color: '#8b8fa6',
    textAlign: 'center',
    fontWeight: '600',
  },
  permissionContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  permissionText: {
    fontSize: 15,
    color: '#8b8fa6',
    marginBottom: 20,
    textAlign: 'center',
  },
  successBadge: {
    backgroundColor: '#dff8e9',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  successText: {
    fontSize: 14,
    color: '#247a4a',
    textAlign: 'center',
    fontWeight: '600',
  },
  qrContainer: {
    backgroundColor: '#ffffff',
    padding: 18,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#c6bff3',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: 20,
  },
  voucherDetails: {
    backgroundColor: '#f7f6fb',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ede9fe',
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: '#8b8fa6',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 16,
    color: '#1f2433',
    fontWeight: '700',
  },
  detailValueSmall: {
    fontSize: 12,
    color: '#8b8fa6',
    fontFamily: 'monospace',
  },
  statusOffline: {
    fontSize: 12,
    color: '#e53e3e',
    fontWeight: '600',
    backgroundColor: '#fed7d7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusOnline: {
    fontSize: 12,
    color: '#276749',
    fontWeight: '600',
    backgroundColor: '#c6f6d5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: 'rgba(111,99,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  offlineBadgeText: {
    fontSize: 11,
    color: '#6f63ff',
    fontWeight: '600',
  },
  instructionText: {
    fontSize: 14,
    color: '#6f63ff',
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 20,
  },
  doneButton: {
    backgroundColor: '#6f63ff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  buttonPrimary: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    alignItems: "center" as const,
    width: "80%",
  },
  buttonText: { color: "#fff", fontWeight: "600" as const, fontSize: 15 },
  // ── Unused voucher card ──
  unusedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2433',
    marginBottom: 4,
  },
  unusedSub: {
    fontSize: 13,
    color: '#8b8fa6',
    marginBottom: 12,
  },
  unusedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f7f6fb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ede9fe',
  },
  unusedInfo: { flex: 1 },
  unusedAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6f63ff',
  },
  unusedMerchant: {
    fontSize: 13,
    color: '#1f2433',
    fontWeight: '600',
    marginTop: 2,
  },
  unusedDate: {
    fontSize: 11,
    color: '#9b9fb4',
    marginTop: 2,
  },
  unusedTap: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6f63ff',
    marginLeft: 8,
  },
  // ── Secondary back button ──
  secondaryButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#cfc9ff',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6f63ff',
  },
  // ── Expiry styles ──
  expiryBadge: {
    marginTop: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  expiryBadgeUrgent: {
    backgroundColor: '#fed7aa',
  },
  expiryBadgeText: {
    fontSize: 11,
    color: '#92400e',
    fontWeight: '600',
  },
  expiryBadgeTextUrgent: {
    color: '#c2410c',
  },
  expiredBadge: {
    marginTop: 4,
    backgroundColor: '#fecaca',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  expiredBadgeText: {
    fontSize: 11,
    color: '#991b1b',
    fontWeight: '700',
  },
  unusedRowExpired: {
    opacity: 0.6,
    borderColor: '#fca5a5',
    backgroundColor: '#fff5f5',
  },
  unusedAmountExpired: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
});
