import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import "react-native-get-random-values";
import * as Crypto from "expo-crypto";
// @ts-ignore
import pkg from "elliptic";
import { API_BASE_URL } from "../../lib/api";
import { notifyMerchantReceivedPayment } from "../../lib/notifications";
import { isPublicKeyTrusted } from "../../lib/trustedKeys";
import { Ionicons } from "@expo/vector-icons";
const { ec: EC } = pkg;
const ec = new EC("secp256k1");

type VoucherStatus = "offline" | "synced";
type Voucher = {
  voucherId: string;
  merchantId: string;
  amount: number;
  createdAt: string;
  issuedTo: string;
  signature: string;
  messageHashHex?: string;
  publicKeyHex?: string;
  status: VoucherStatus;
  syncedAt?: string;
};

type ScreenState = "scanning" | "processing" | "success" | "error";

export default function MerchantReceiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [screenState, setScreenState] = useState<ScreenState>("scanning");
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [storedCount, setStoredCount] = useState(0);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const existing = await AsyncStorage.getItem("@offline_vouchers");
        if (existing) setStoredCount(JSON.parse(existing).length);
        const mid = await AsyncStorage.getItem("@merchant_id");
        setMerchantId(mid);
      } catch (e) {
        console.log("Init error:", e);
      }
    })();
  }, []);

  const saveVoucherOffline = async (v: Voucher) => {
    const existing = await AsyncStorage.getItem("@offline_vouchers");
    const list: Voucher[] = existing ? JSON.parse(existing) : [];
    if (!list.find((x) => x.voucherId === v.voucherId)) {
      list.push(v);
      await AsyncStorage.setItem("@offline_vouchers", JSON.stringify(list));
      setStoredCount(list.length);
    }
  };

  // Attempt immediate backend sync; return true if succeeded
  const trySyncToBackend = async (v: Voucher, mid: string): Promise<boolean> => {
    try {
      setSyncing(true);
      const response = await fetch(`${API_BASE_URL}/api/vouchers/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: mid, vouchers: [v] }),
      });
      if (!response.ok) return false;
      const result = await response.json();
      if (result.syncedIds?.includes(v.voucherId)) {
        // Mark as synced in local storage
        const existing = await AsyncStorage.getItem("@offline_vouchers");
        const list: Voucher[] = existing ? JSON.parse(existing) : [];
        const updated = list.map((x) =>
          x.voucherId === v.voucherId
            ? { ...x, status: "synced" as VoucherStatus, syncedAt: new Date().toISOString() }
            : x
        );
        await AsyncStorage.setItem("@offline_vouchers", JSON.stringify(updated));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSyncing(false);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (screenState !== "scanning") return;
    setScreenState("processing");
    processVoucher(data);
  };

  const processVoucher = async (data: string) => {
    try {
      const parsed = JSON.parse(data);

      // Validate fields
      if (!parsed.voucherId || !parsed.merchantId || typeof parsed.amount !== "number" || !parsed.signature || !parsed.issuedTo) {
        setErrorMsg("Invalid voucher format. Ask the customer to regenerate the payment.");
        setScreenState("error");
        return;
      }

      if (!merchantId) {
        setErrorMsg("Merchant ID not loaded. Please restart the app.");
        setScreenState("error");
        return;
      }

      if (parsed.merchantId !== merchantId) {
        setErrorMsg(`This voucher is for a different merchant.\n\nVoucher merchant: ${parsed.merchantId}\nYour ID: ${merchantId}`);
        setScreenState("error");
        return;
      }

      // ── Double-spend protection ──────────────────────────────────────────────
      // Check if this voucherId was already redeemed by this merchant device
      const existingRaw = await AsyncStorage.getItem("@offline_vouchers");
      const existingVouchers: Voucher[] = existingRaw ? JSON.parse(existingRaw) : [];
      if (existingVouchers.find((x) => x.voucherId === parsed.voucherId)) {
        setErrorMsg(
          `This voucher has already been redeemed.\n\nVoucher ID: ...${parsed.voucherId.slice(-12)}\n\nDouble-spending is not allowed.`
        );
        setScreenState("error");
        return;
      }

      if (!parsed.publicKeyHex) {
        setErrorMsg("Voucher is missing the public key — cannot verify signature.");
        setScreenState("error");
        return;
      }

      const trusted = await isPublicKeyTrusted(parsed.publicKeyHex);
      if (!trusted) {
        setErrorMsg(
          "Untrusted user key. Please refresh trusted keys in Settings while online and try again."
        );
        setScreenState("error");
        return;
      }

      // Rebuild payload as it was signed
      const payload = {
        voucherId: parsed.voucherId,
        merchantId: parsed.merchantId,
        amount: parsed.amount,
        createdAt: parsed.createdAt,
        issuedTo: parsed.issuedTo,
      };
      const payloadStr = JSON.stringify(payload);
      const msgHashHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payloadStr);

      // Verify ECDSA signature
      try {
        const key = ec.keyFromPublic(parsed.publicKeyHex, "hex");
        const ok = key.verify(msgHashHex, parsed.signature);
        if (!ok) {
          setErrorMsg("Signature verification failed. This voucher may have been tampered with.");
          setScreenState("error");
          return;
        }
      } catch {
        setErrorMsg("Could not verify signature. Voucher may be corrupt.");
        setScreenState("error");
        return;
      }

      // All good — save
      const accepted: Voucher = {
        voucherId: parsed.voucherId,
        merchantId: parsed.merchantId,
        amount: parsed.amount,
        createdAt: parsed.createdAt || new Date().toISOString(),
        issuedTo: parsed.issuedTo,
        signature: parsed.signature,
        messageHashHex: parsed.messageHashHex,
        publicKeyHex: parsed.publicKeyHex,
        status: "offline",
      };

      await saveVoucherOffline(accepted);
      setVoucher(accepted);

      // Try to auto-sync immediately
      const didSync = await trySyncToBackend(accepted, merchantId);
      setSynced(didSync);
      setScreenState("success");
      // 🔔 Notify merchant about the new payment
      await notifyMerchantReceivedPayment(accepted.amount);
    } catch (e) {
      console.log("processVoucher error:", e);
      setErrorMsg("Could not read QR code. Make sure it is a valid payment voucher.");
      setScreenState("error");
    }
  };

  const resetToScan = () => {
    setVoucher(null);
    setErrorMsg("");
    setSynced(false);
    setScreenState("scanning");
  };

  // ─── Scanning state ───────────────────────────────────────────
  if (screenState === "scanning" || screenState === "processing") {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={[styles.topBar, { paddingTop: insets.top + 16 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#1f2937" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.topBarTitle}>Receive Payment</Text>
            <Text style={styles.topBarSub}>Scan the customer's voucher QR code</Text>
          </View>
        </View>

        <View style={styles.scanArea}>
          {!permission ? (
            <View style={styles.permissionBox}>
              <Text style={styles.permLabel}>Camera permission needed</Text>
              <ActivityIndicator color="#7c3aed" />
            </View>
          ) : !permission.granted ? (
            <View style={styles.permissionBox}>
              <Text style={styles.permLabel}>Camera access is required to scan vouchers.</Text>
              <Pressable style={styles.grantBtn} onPress={requestPermission}>
                <Text style={styles.grantBtnText}>Grant Camera Access</Text>
              </Pressable>
            </View>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              onBarcodeScanned={screenState === "scanning" ? handleBarCodeScanned : undefined}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              autofocus="on"
            >
              <View style={styles.overlay}>
                {screenState === "processing" ? (
                  <View style={styles.processingBox}>
                    <ActivityIndicator color="#7c3aed" size="large" />
                    <Text style={styles.processingText}>Verifying voucher...</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.scanFrame}>
                      <View style={[styles.corner, styles.cornertl]} />
                      <View style={[styles.corner, styles.cornertr]} />
                      <View style={[styles.corner, styles.cornerbl]} />
                      <View style={[styles.corner, styles.cornerbr]} />
                    </View>
                  </>
                )}
              </View>
            </CameraView>
          )}
        </View>

        {/* Footer info */}
        <View style={styles.footerInfo}>
          <Text style={styles.footerText}>
            {storedCount} voucher{storedCount !== 1 ? "s" : ""} stored  ·  Signatures verified offline
          </Text>
        </View>
      </View>
    );
  }

  // ─── Success state ─────────────────────────────────────────────
  if (screenState === "success" && voucher) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={[styles.resultContent, { paddingTop: insets.top + 24 }]}>

          <Pressable style={styles.backBtnDark} onPress={() => router.back()}>
            <View style={styles.inlineIconText}>
              <Ionicons name="chevron-back" size={18} color="#1f2937" />
              <Text style={styles.backBtnDarkText}>Back</Text>
            </View>
          </Pressable>

          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={38} color="#fff" />
          </View>
          <Text style={styles.successTitle}>Payment Received!</Text>
          <Text style={styles.successAmount}>₹{voucher.amount}</Text>
          <Text style={styles.successSyncStatus}>
            {syncing
              ? "Syncing to server..."
              : synced
              ? "Synced to server"
              : "Saved offline — sync later from History"}
          </Text>

          {/* Voucher detail card */}
          <View style={styles.detailCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Voucher ID</Text>
              <Text style={styles.detailValue}>{voucher.voucherId}</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>From (User ID)</Text>
              <Text style={styles.detailValue}>...{voucher.issuedTo.slice(-8)}</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Amount</Text>
              <Text style={[styles.detailValue, styles.detailAmount]}>₹{voucher.amount}</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Time</Text>
              <Text style={styles.detailValue}>
                {new Date(voucher.createdAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
              </Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Signature</Text>
              <Text style={styles.detailValue}>Verified</Text>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Status</Text>
              <Text style={[styles.detailValue, synced ? styles.statusSynced : styles.statusOffline]}>
                {synced ? "Synced" : "Offline"}
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <Pressable style={styles.historyBtn} onPress={() => router.push("/merchant/history")}>
            <View style={styles.inlineIconText}>
              <Ionicons name="receipt-outline" size={18} color="#1f2937" />
              <Text style={styles.historyBtnText}>View Transaction History</Text>
            </View>
          </Pressable>

          <Pressable style={styles.scanAnotherBtn} onPress={resetToScan}>
            <View style={styles.inlineIconText}>
              <Ionicons name="scan-outline" size={18} color="#1f2937" />
              <Text style={styles.scanAnotherText}>Scan Another Voucher</Text>
            </View>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ─── Error state ───────────────────────────────────────────────
  return (
    <View style={styles.fullScreenError}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.resultContent, { paddingTop: insets.top + 24 }]}>
        <Pressable style={styles.backBtnDark} onPress={() => router.back()}>
          <View style={styles.inlineIconText}>
            <Ionicons name="chevron-back" size={18} color="#1f2937" />
            <Text style={styles.backBtnDarkText}>Back</Text>
          </View>
        </Pressable>
        <View style={styles.errorIconBox}>
          <Ionicons name="close" size={34} color="#ef4444" />
        </View>
        <Text style={styles.errorTitle}>Voucher Rejected</Text>
        <View style={styles.errorMsgCard}>
          <Text style={styles.errorMsgText}>{errorMsg}</Text>
        </View>
        <Pressable style={styles.retryBtn} onPress={resetToScan}>
          <View style={styles.inlineIconText}>
            <Ionicons name="refresh-outline" size={18} color="#1f2937" />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  fullScreen: { flex: 1, backgroundColor: "#f9fafb" },
  fullScreenError: { flex: 1, backgroundColor: "#f9fafb" },

  // Top bar
  topBar: { paddingBottom: 20, paddingHorizontal: 20, backgroundColor: "#f9fafb" },
  backBtn: { marginBottom: 12 },
  backArrow: { fontSize: 26, color: "#1f2937", fontWeight: "600" },
  headerContent: {},
  topBarTitle: { fontSize: 26, fontWeight: "800", color: "#1f2937", marginBottom: 4 },
  topBarSub: { fontSize: 13, color: "#9ca3af" },

  // Camera
  scanArea: { flex: 1, marginHorizontal: 20, marginVertical: 20, borderRadius: 20, overflow: "hidden", backgroundColor: "#f3f4f6" },
  camera: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(243, 244, 246, 0.3)" },
  scanFrame: { width: 240, height: 240, position: "relative" },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "#7c3aed", borderWidth: 4 },
  cornertl: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 4 },
  cornertr: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 4 },
  cornerbl: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 4 },
  cornerbr: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 4 },
  processingBox: { alignItems: "center", backgroundColor: "rgba(243, 244, 246, 0.9)", padding: 28, borderRadius: 16, gap: 14 },
  processingText: { color: "#1f2937", fontSize: 16, fontWeight: "600" },

  // Permission
  permissionBox: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, backgroundColor: "#f9fafb" },
  permLabel: { color: "#1f2937", fontSize: 15, textAlign: "center", marginBottom: 16, lineHeight: 22 },
  grantBtn: { backgroundColor: "#7c3aed", paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  grantBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Footer
  footerInfo: { backgroundColor: "#f3f4f6", paddingVertical: 12, alignItems: "center", marginHorizontal: 20, marginBottom: 20, borderRadius: 12 },
  footerText: { color: "#6b7280", fontSize: 12, fontWeight: "500" },

  // Success / Error result screens
  resultContent: { flexGrow: 1, padding: 24, alignItems: "center" },
  backBtnDark: { alignSelf: "flex-start", marginBottom: 24 },
  backBtnDarkText: { color: "#1f2937", fontSize: 16, fontWeight: "600" },
  inlineIconText: { flexDirection: "row", alignItems: "center", gap: 6 },

  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#d1fae5", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successEmoji: { fontSize: 40, color: "#10b981", fontWeight: "800" },
  successTitle: { fontSize: 26, fontWeight: "800", color: "#1f2937", marginBottom: 6 },
  successAmount: { fontSize: 52, fontWeight: "900", color: "#10b981", marginBottom: 8 },
  successSyncStatus: { fontSize: 13, color: "#6b7280", marginBottom: 24, textAlign: "center" },

  detailCard: { width: "100%", backgroundColor: "#fff", borderRadius: 18, padding: 18, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  detailDivider: { height: 1, backgroundColor: "#f3f4f6" },
  detailLabel: { fontSize: 13, color: "#6b7280", fontWeight: "500" },
  detailValue: { fontSize: 13, color: "#1f2937", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  detailAmount: { color: "#10b981", fontSize: 16, fontWeight: "800" },
  statusSynced: { color: "#10b981" },
  statusOffline: { color: "#f59e0b" },

  historyBtn: { width: "100%", backgroundColor: "#fff", paddingVertical: 16, borderRadius: 14, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: "#e5e7eb" },
  historyBtnText: { color: "#1f2937", fontSize: 16, fontWeight: "700" },
  scanAnotherBtn: { width: "100%", backgroundColor: "#f3f4f6", paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  scanAnotherText: { color: "#1f2937", fontSize: 15, fontWeight: "600" },

  errorIconBox: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#fee2e2", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  errorEmoji: { fontSize: 40, color: "#ef4444", fontWeight: "800" },
  errorTitle: { fontSize: 26, fontWeight: "800", color: "#1f2937", marginBottom: 20 },
  errorMsgCard: { width: "100%", backgroundColor: "#f3f4f6", borderRadius: 14, padding: 18, marginBottom: 28 },
  errorMsgText: { color: "#1f2937", fontSize: 14, lineHeight: 22, textAlign: "center" },
  retryBtn: { width: "100%", backgroundColor: "#fff", paddingVertical: 16, borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb" },
  retryBtnText: { color: "#1f2937", fontSize: 16, fontWeight: "700" },
});
