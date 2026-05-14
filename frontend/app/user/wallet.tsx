import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE_URL, saveLocalBalance, getLocalBalance, syncOfflineTransactions, refundExpiredVouchers } from "../../lib/api";
import { ensureUserKeypairAndId } from "../../lib/cryptoKeys";
import { registerPublicKeyIfNeeded } from "../../lib/registerKey";
import { initiateTopUp } from "../../lib/razorpay";
import { OfflineBanner } from "../../components/OfflineBanner";
import { useOfflineSync } from "../../hooks/useOfflineSync";

const MAX_SINGLE_AMOUNT = 1000;   // per transaction
const MAX_WALLET_BALANCE = 5000;  // total wallet cap

type QuickAction = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  iconBg: string;
  route: Href;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "pay",
    title: "Pay",
    subtitle: "Scan & Pay Merchant",
    icon: "card-outline" as const,
    iconColor: "#6e63ff",
    iconBg: "#e8e4ff",
    route: "/user/pay",
  },
  {
    key: "history",
    title: "History",
    subtitle: "All Transactions",
    icon: "document-text-outline" as const,
    iconColor: "#4aa2ff",
    iconBg: "#e3f1ff",
    route: "/user/history",
  },
  {
    key: "add",
    title: "Add Money",
    subtitle: "Top Up Wallet",
    icon: "cash-outline" as const,
    iconColor: "#2eab6d",
    iconBg: "#e5f6ec",
    route: "/user/wallet",
  },
  {
    key: "profile",
    title: "Profile",
    subtitle: "Account & Settings",
    icon: "person-outline" as const,
    iconColor: "#f29b3a",
    iconBg: "#fff0df",
    route: "/user/profile",
  },
  {
    key: "insights",
    title: "Insights",
    subtitle: "AI Spending Report",
    icon: "sparkles-outline" as const,
    iconColor: "#8b5cf6",
    iconBg: "#f2e8ff",
    route: "/user/insights",
  },
  {
    key: "support",
    title: "AI Support",
    subtitle: "Payment Help Chat",
    icon: "chatbubbles-outline" as const,
    iconColor: "#14b8a6",
    iconBg: "#dff9f6",
    route: "/user/support",
  },
];

type Transaction = {
  id: string;
  type: "credit" | "debit";
  amount: number;
  description: string;
  timestamp: string;
  status?: string;
};

export default function UserWalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [userName, setUserName] = useState("User");
  const [isOffline, setIsOffline] = useState(false);

  // M9: offline sync hook — auto-runs on focus, tracks pending queue
  const { pendingCount } = useOfflineSync();

  useEffect(() => {
    (async () => {
      await ensureUserKeypairAndId();
      await registerPublicKeyIfNeeded();
      const userData = await AsyncStorage.getItem("@user_data");
      if (userData) {
        const u = JSON.parse(userData);
        setUserName(u.name || "User");
      }
    })();
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      setLoadingBalance(true);
      const token = await AsyncStorage.getItem("@auth_token");
      if (!token) { setBalance(0); setLoadingBalance(false); return; }

      // Refund any expired vouchers first — updates local + backend balance
      await refundExpiredVouchers(token).catch(() => 0);

      const response = await fetch(`${API_BASE_URL}/api/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        setBalance(data.balance);
        setIsOffline(false);
        // Cache the latest balance locally for offline use
        await saveLocalBalance(data.balance);
        // Sync any queued offline transactions — this deducts balance on backend
        const syncedCount = await syncOfflineTransactions(token).catch(() => 0);
        // Re-fetch balance if sync ran so UI reflects the deducted amount
        if (syncedCount > 0) {
          const refreshed = await fetch(`${API_BASE_URL}/api/balance`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          });
          if (refreshed.ok) {
            const refreshedData = await refreshed.json();
            setBalance(refreshedData.balance);
            await saveLocalBalance(refreshedData.balance);
          }
        }
      } else {
        // Backend returned error — fall back to cached balance
        const cached = await getLocalBalance();
        setBalance(cached ?? 0);
        setIsOffline(cached !== null);
      }
    } catch {
      // No network — show last known balance from local cache
      const cached = await getLocalBalance();
      setBalance(cached ?? 0);
      setIsOffline(true);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  const loadRecentTxns = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("@auth_token");
      if (!token) return;
      const response = await fetch(`${API_BASE_URL}/api/transactions/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setRecentTxns((data.transactions || []).slice(0, 4));
      }
    } catch {
      // silent
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadBalance(), loadRecentTxns()]);
    setRefreshing(false);
  }, [loadBalance, loadRecentTxns]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const handleAddBalance = async () => {
    const amt = Number(addAmount);
    if (isNaN(amt) || amt <= 0) { setError("Please enter a valid amount"); return; }
    if (amt > MAX_SINGLE_AMOUNT) { setError(`Max ₹${MAX_SINGLE_AMOUNT} per transaction`); return; }

    // Wallet total cap check
    const currentBal = balance ?? 0;
    if (currentBal >= MAX_WALLET_BALANCE) {
      setError(`Wallet full. Max limit is ₹${MAX_WALLET_BALANCE.toLocaleString("en-IN")}`);
      return;
    }
    if (currentBal + amt > MAX_WALLET_BALANCE) {
      const canAdd = MAX_WALLET_BALANCE - currentBal;
      setError(`You can only add ₹${canAdd.toLocaleString("en-IN")} more (₹${MAX_WALLET_BALANCE.toLocaleString("en-IN")} wallet limit)`);
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem("@auth_token");
      if (!token) { Alert.alert("Error", "Please login first"); return; }
      setShowAddModal(false);
      setAddAmount("");
      setError(null);

      const rawUserData = await AsyncStorage.getItem("@user_data");
      const storedUser = rawUserData ? JSON.parse(rawUserData) : null;
      const result = await initiateTopUp(
        token,
        amt,
        balance ?? 0,
        {
          name: storedUser?.name || userName || "User",
          contact: storedUser?.phone || undefined,
          email: storedUser?.email || undefined,
        },
        (newBal) => {
          setBalance(newBal);
          saveLocalBalance(newBal).catch(() => {});
        }
      );

      Alert.alert(
        result.success ? "✅ Payment" : "❌ Payment",
        result.message
      );

      if (result.success) {
        await loadBalance();
        await loadRecentTxns();
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    }
    finally {
      setLoading(false);
    }
  };

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const firstLetter = userName.charAt(0).toUpperCase();

  const handleQuickAction = (key: string, route: Href) => {
    if (key === "add") {
      setAddAmount("");
      setError(null);
      setShowAddModal(true);
      return;
    }
    router.push(route);
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={["#f7f3ff", "#f8f6ff", "#f7f5ff"]} style={styles.background} />

      {/* M9: Offline banner — slides in when device loses connectivity */}
      <OfflineBanner
        visible={isOffline}
        onRetry={loadBalance}
        message={pendingCount > 0 ? `Offline — ${pendingCount} payment(s) queued` : "Offline — showing cached balance"}
      />
      <View style={styles.glowTop} />
      <View style={styles.glowRight} />
      <View style={styles.glowBottom} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadAll(); }}
            tintColor="#9a92d9"
          />
        }
      >
        <View style={styles.headerRow}>
          <View />
          <Pressable style={styles.avatarBtn} onPress={() => router.push("/user/profile") }>
            <Text style={styles.avatarText}>{firstLetter}</Text>
          </Pressable>
        </View>

        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.userName}>{userName} 👋</Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Wallet Balance</Text>
          {loadingBalance ? (
            <ActivityIndicator color="#6f63ff" size="large" style={{ marginVertical: 12 }} />
          ) : (
            <Text style={styles.balanceAmount}>₹{formatCurrency(balance ?? 0)}</Text>
          )}
          <View style={styles.balanceFooter}>
            <View style={[styles.offlinePill, isOffline && styles.offlinePillOffline]}>
              <Ionicons name="lock-closed" size={12} color="#6f63ff" />
              <Text style={styles.offlineText}>Offline Wallet</Text>
            </View>
            <Pressable
              style={styles.addMoneyBtn}
              onPress={() => { setAddAmount(""); setError(null); setShowAddModal(true); }}
            >
              <Text style={styles.addMoneyText}>+ Add Money</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
              onPress={() => handleQuickAction(action.key, action.route)}
            >
              <View style={styles.actionHeader}>
                <View style={[styles.actionIconWrap, { backgroundColor: action.iconBg }]}>
                  <Ionicons name={action.icon} size={22} color={action.iconColor} />
                </View>
                <View style={styles.actionArrow}>
                  <Ionicons name="chevron-forward" size={14} color="#5f5b7a" />
                </View>
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.actionSubtitle}>{action.subtitle}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <Pressable style={styles.seeAllBtn} onPress={() => router.push("/user/history")}>
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={12} color="#1f2433" />
          </Pressable>
        </View>

        <View style={styles.recentCard}>
          {recentTxns.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No recent activity</Text>
              <Text style={styles.emptySub}>Make your first payment to see it here</Text>
            </View>
          ) : (
            recentTxns.map((item, index) => {
              const isCredit = item.type === "credit";
              return (
                <View key={item.id} style={[styles.txnRow, index > 0 && styles.txnRowBorder]}>
                  <View style={styles.txnIconWrap}>
                    <Ionicons name={isCredit ? "arrow-down" : "arrow-up"} size={14} color="#e07268" />
                  </View>
                  <View style={styles.txnInfo}>
                    <Text style={styles.txnTitle}>{item.description || "Payment sent"}</Text>
                    <Text style={styles.txnTime}>{formatDate(item.timestamp)}</Text>
                  </View>
                  <Text style={[styles.txnAmount, isCredit ? styles.txnAmountCredit : styles.txnAmountDebit]}>
                    {isCredit ? "+" : "-"}₹{formatCurrency(Math.abs(item.amount))}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 36 }} />
      </ScrollView>

      {/* ── ADD MONEY MODAL ── */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Money to Wallet</Text>
            <Text style={styles.modalSub}>Per transaction: ₹{MAX_SINGLE_AMOUNT} max • Wallet limit: ₹{MAX_WALLET_BALANCE.toLocaleString("en-IN")}</Text>

            <View style={styles.amountRow}>
              <Text style={styles.rupeeSym}>₹</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Enter amount"
                placeholderTextColor="#aaa"
                keyboardType="numeric"
                value={addAmount}
                onChangeText={setAddAmount}
                autoFocus
              />
            </View>

            <View style={styles.chipRow}>
              {[100, 200, 500, 1000].map((v) => (
                <Pressable
                  key={v}
                  style={[styles.chip, addAmount === String(v) && styles.chipActive]}
                  onPress={() => setAddAmount(String(v))}
                >
                  <Text style={[styles.chipText, addAmount === String(v) && styles.chipTextActive]}>₹{v}</Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.errorText}>⚠️ {error}</Text>}

            <View style={styles.modalBtns}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => { setShowAddModal(false); setAddAmount(""); setError(null); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, loading && styles.btnDisabled]}
                onPress={handleAddBalance}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmBtnText}>Add Money</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
    top: -160,
    left: -90,
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
    bottom: -140,
    left: -60,
    opacity: 0.7,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7d6bff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6d5eea",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  avatarText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  greetingBlock: {
    marginTop: 8,
    marginBottom: 14,
  },
  greeting: {
    fontSize: 14,
    color: "#8a8fa5",
    fontWeight: "600",
  },
  userName: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2433",
    marginTop: 2,
  },
  balanceCard: {
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 24,
    padding: 20,
    shadowColor: "#b8aef0",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
  },
  balanceLabel: {
    fontSize: 14,
    color: "#8a8fa5",
    fontWeight: "600",
  },
  balanceAmount: {
    fontSize: 34,
    fontWeight: "800",
    color: "#1f2433",
    marginTop: 8,
  },
  balanceFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
  },
  offlinePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2efff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    gap: 6,
  },
  offlinePillOffline: {
    backgroundColor: "#f7f0df",
  },
  offlineText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6d6a8c",
  },
  addMoneyBtn: {
    backgroundColor: "#6f63ff",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 18,
  },
  addMoneyText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 14,
    fontSize: 18,
    fontWeight: "800",
    color: "#1f2433",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  actionCard: {
    width: "48%",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    shadowColor: "#c6bff3",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  actionCardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  actionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  actionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionArrow: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f2f0ff",
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1f2433",
    marginBottom: 6,
  },
  actionSubtitle: {
    fontSize: 11,
    color: "#8b8fa6",
    fontWeight: "600",
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f0ff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1f2433",
  },
  recentCard: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    shadowColor: "#c6bff3",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  emptyState: {
    paddingVertical: 18,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2433",
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 12,
    color: "#8b8fa6",
    fontWeight: "600",
  },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  txnRowBorder: {
    borderTopWidth: 1,
    borderTopColor: "#f0eff6",
  },
  txnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffe9e4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  txnInfo: {
    flex: 1,
  },
  txnTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2433",
    marginBottom: 4,
  },
  txnTime: {
    fontSize: 12,
    color: "#9b9fb4",
    fontWeight: "600",
  },
  txnAmount: {
    fontSize: 14,
    fontWeight: "800",
  },
  txnAmountCredit: {
    color: "#16a34a",
  },
  txnAmountDebit: {
    color: "#e14c4c",
  },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 44,
  },
  modalHandle: { width: 40, height: 4, backgroundColor: "#d1d5db", borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#111827", textAlign: "center", marginBottom: 4 },
  modalSub: { fontSize: 13, color: "#9ca3af", textAlign: "center", marginBottom: 22 },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9fafb",
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#4f46e5",
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  rupeeSym: { fontSize: 26, fontWeight: "800", color: "#4f46e5", marginRight: 8 },
  amountInput: { flex: 1, fontSize: 28, fontWeight: "700", color: "#111827", paddingVertical: 14 },
  chipRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  chip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  chipActive: { backgroundColor: "#ede9fe", borderColor: "#4f46e5" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  chipTextActive: { color: "#4f46e5" },
  errorText: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 12, fontWeight: "500" },
  modalBtns: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cancelBtnText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  confirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: "#4f46e5" },
  confirmBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  btnDisabled: { opacity: 0.6 },
});
