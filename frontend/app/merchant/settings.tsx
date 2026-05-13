import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../../lib/api";
import {
  loadTrustedKeysMeta,
  loadTrustedUserKeys,
  refreshTrustedUserKeys,
} from "../../lib/trustedKeys";
import { Ionicons } from "@expo/vector-icons";
import * as Updates from "expo-updates";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQ_ITEMS = [
  {
    q: "How do I accept an offline payment?",
    a: "Tap 'Receive Payment' on the home screen. The customer scans your QR code (or you scan theirs) and presents their voucher QR. Once your device stores the voucher, the payment is recorded. It syncs to the server and credits your account when either of you comes online.",
  },
  {
    q: "When does revenue show in my account?",
    a: "Revenue is credited as soon as the voucher syncs to the server — either when you go online or when the customer syncs first. Check your Transaction History for the settlement status.",
  },
  {
    q: "What if the customer's voucher looks suspicious?",
    a: "Every voucher is cryptographically signed by the customer's unique key. The app automatically verifies the signature before accepting a voucher. Forged vouchers will be rejected.",
  },
  {
    q: "Can a voucher be used more than once?",
    a: "No. Every voucher has a unique ID. The server rejects any duplicate — even if presented multiple times offline before syncing.",
  },
  {
    q: "What happens if I'm offline for a long time?",
    a: "All vouchers you've accepted are stored securely on your device. Once you come online (even briefly), they sync automatically. There is no expiry on voucher syncing.",
  },
  {
    q: "How do I view my transaction history?",
    a: "Tap the 'History' tab in the bottom navigation. You can see all received payments, amounts, and their sync status.",
  },
  {
    q: "What should I do if a payment is stuck as 'pending'?",
    a: "Pull-to-refresh on the History screen or tap 'Sync Now'. Make sure you have an internet connection. If the problem persists, contact support with your Merchant ID.",
  },
];

export default function MerchantSettingsScreen() {
  const router = useRouter();
  const appVersion =
    ((Updates.manifest as { version?: string } | null)?.version ?? "1.0.1");

  // ─── Profile state ─────────────────────────────────────────────
  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [merchantId, setMerchantId] = useState("");

  const [editField, setEditField] = useState<"name" | "shopName" | "address" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftShopName, setDraftShopName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ─── Password state ─────────────────────────────────────────────
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // ─── Trusted keys state ─────────────────────────────────────────
  const [trustedCount, setTrustedCount] = useState(0);
  const [trustedUpdatedAt, setTrustedUpdatedAt] = useState<string | null>(null);
  const [refreshingKeys, setRefreshingKeys] = useState(false);

  // ─── FAQ state ─────────────────────────────────────────────────
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── OTA Update state ─────────────────────────────────
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "available" | "uptodate" | "error">("idle");

  const loadTrustedInfo = async () => {
    const keys = await loadTrustedUserKeys();
    setTrustedCount(keys.length);
    const meta = await loadTrustedKeysMeta();
    setTrustedUpdatedAt(meta?.updatedAt || null);
  };

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("@merchant_data");
      if (raw) {
        const m = JSON.parse(raw);
        const nameVal = m.name || m.businessName || "";
        const shopVal = m.shopName || m.businessName || nameVal;
        setName(nameVal); setDraftName(nameVal);
        setShopName(shopVal); setDraftShopName(shopVal);
        setAddress(m.address || ""); setDraftAddress(m.address || "");
        setPhone(m.phone || "");
        setMerchantId(m.merchantId || "");
      }
      await loadTrustedInfo();
      setLoading(false);
    })();
  }, []);

  // ─── Save profile ───────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!draftName.trim()) { Alert.alert("Error", "Name cannot be empty"); return; }
    try {
      setSavingProfile(true);
      const token = await AsyncStorage.getItem("@auth_token");
      const res = await fetch(`${API_BASE_URL}/api/merchant/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: draftName.trim(),
          shopName: draftShopName.trim() || draftName.trim(),
          address: draftAddress.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setName(draftName.trim());
        setShopName(draftShopName.trim() || draftName.trim());
        setAddress(draftAddress.trim());
        setEditField(null);
        const raw = await AsyncStorage.getItem("@merchant_data");
        if (raw) {
          const m = JSON.parse(raw);
          m.name = draftName.trim();
          m.shopName = draftShopName.trim() || draftName.trim();
          m.address = draftAddress.trim();
          await AsyncStorage.setItem("@merchant_data", JSON.stringify(m));
        }
        Alert.alert("✅ Saved", "Profile updated successfully.");
      } else {
        Alert.alert("Error", data.error || "Failed to update profile");
      }
    } catch {
      Alert.alert("Error", "Could not connect. Try again later.");
    } finally {
      setSavingProfile(false);
    }
  };

  const cancelEdit = () => {
    setEditField(null);
    setDraftName(name); setDraftShopName(shopName); setDraftAddress(address);
  };

  // ─── Change password ────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      Alert.alert("Error", "Please fill in all password fields"); return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Error", "New password must be at least 6 characters"); return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "New passwords do not match"); return;
    }
    if (oldPassword === newPassword) {
      Alert.alert("Error", "New password must be different from current password"); return;
    }
    try {
      setSavingPassword(true);
      const token = await AsyncStorage.getItem("@auth_token");
      const res = await fetch(`${API_BASE_URL}/api/merchant/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setOldPassword(""); setNewPassword(""); setConfirmPassword("");
        setShowPasswordSection(false);
        Alert.alert("✅ Password Changed", "Your password has been updated successfully.");
      } else {
        Alert.alert("Error", data.error || "Failed to change password");
      }
    } catch {
      Alert.alert("Error", "Could not connect. Try again later.");
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleFaq = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenFaq(openFaq === i ? null : i);
  };

  const formatUpdatedAt = (value: string | null) => {
    if (!value) return "Not synced yet";
    const date = new Date(value);
    return date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleRefreshKeys = async () => {
    if (refreshingKeys) return;
    const token = await AsyncStorage.getItem("@auth_token");
    if (!token) {
      Alert.alert("Error", "Please login again to refresh keys.");
      return;
    }
    try {
      setRefreshingKeys(true);
      const meta = await refreshTrustedUserKeys(token);
      setTrustedCount(meta.count);
      setTrustedUpdatedAt(meta.updatedAt);
      Alert.alert("Trusted keys updated", `Downloaded ${meta.count} user keys.`);
    } catch (error: any) {
      Alert.alert(
        "Refresh failed",
        error?.message || "Could not refresh trusted keys. Try again when online."
      );
    } finally {
      setRefreshingKeys(false);
    }
  };

  // ─── OTA Update check ─────────────────────────────────
  const handleCheckUpdate = async () => {
    if (__DEV__) {
      setUpdateStatus("error");
      Alert.alert(
        "Dev Mode",
        "OTA updates are only available in production (EAS) builds. This is expected during development."
      );
      setTimeout(() => setUpdateStatus("idle"), 3000);
      return;
    }

    try {
      setCheckingUpdate(true);
      setUpdateStatus("idle");
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setUpdateStatus("available");
        Alert.alert(
          "Update Available!",
          "A new version is ready. The app will restart to apply it.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Install Now",
              onPress: async () => {
                try {
                  await Updates.fetchUpdateAsync();
                  await Updates.reloadAsync();
                } catch (installErr: any) {
                  Alert.alert(
                    "Install Failed",
                    "Could not install the update. Please try again.\n\n" + (installErr?.message || "")
                  );
                }
              },
            },
          ]
        );
      } else {
        setUpdateStatus("uptodate");
        setTimeout(() => setUpdateStatus("idle"), 3000);
      }
    } catch (err: any) {
      setUpdateStatus("error");
      Alert.alert(
        "Update Check Failed",
        "Could not check for updates. Make sure you have an internet connection.\n\n" + (err?.message || "")
      );
      setTimeout(() => setUpdateStatus("idle"), 3000);
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (loading) {
    return (
      <LinearGradient colors={["#059669", "#0d9488"]} style={styles.centered}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#fff" />
      </LinearGradient>
    );
  }

  const firstLetter = name ? name.charAt(0).toUpperCase() : "M";

  return (
    <LinearGradient colors={["#059669", "#0d9488", "#0891b2"]} style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── AVATAR ── */}
        <View style={styles.avatarCard}>
          <LinearGradient colors={["rgba(255,255,255,0.22)", "rgba(255,255,255,0.07)"]} style={styles.avatarInner}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarLetter}>{firstLetter}</Text>
            </View>
            <Text style={styles.avatarName}>{shopName || name || "Merchant"}</Text>
            <View style={styles.avatarBadge}>
              <View style={styles.inlineIconText}>
                <Ionicons name="storefront-outline" size={14} color="#fff" />
                <Text style={styles.avatarBadgeText}>Merchant Account</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ══ SECTION: PROFILE ═════════════════════════════════════ */}
        <SectionHeader label="BUSINESS DETAILS" icon="storefront-outline" />
        <View style={styles.card}>

          {/* Owner Name */}
          <EditableField
            label="OWNER NAME"
            value={name}
            draft={draftName}
            isEditing={editField === "name"}
            onEdit={() => { setDraftName(name); setEditField("name"); }}
            onChangeDraft={setDraftName}
          />
          <View style={styles.divider} />

          {/* Shop Name */}
          <EditableField
            label="SHOP / BUSINESS NAME"
            value={shopName}
            draft={draftShopName}
            isEditing={editField === "shopName"}
            onEdit={() => { setDraftShopName(shopName); setEditField("shopName"); }}
            onChangeDraft={setDraftShopName}
          />
          <View style={styles.divider} />

          {/* Address */}
          <EditableField
            label="ADDRESS"
            value={address || "Not set"}
            draft={draftAddress}
            isEditing={editField === "address"}
            onEdit={() => { setDraftAddress(address); setEditField("address"); }}
            onChangeDraft={setDraftAddress}
            multiline
          />

          {editField !== null && (
            <View style={styles.inlineButtons}>
              <Pressable style={styles.cancelBtn} onPress={cancelEdit}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, savingProfile && styles.btnDisabled]}
                onPress={handleSaveProfile}
                disabled={savingProfile}
              >
                {savingProfile
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.saveBtnText}>Save</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.divider} />

          {/* Phone */}
          <View style={styles.fieldRow}>
            <View style={styles.fieldLeft}>
              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <Text style={styles.fieldValue}>{phone || "—"}</Text>
            </View>
            <View style={styles.lockBadge}>
              <View style={styles.inlineIconText}>
                <Ionicons name="lock-closed-outline" size={12} color="#9ca3af" />
                <Text style={styles.lockText}>Fixed</Text>
              </View>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Merchant ID */}
          <View style={styles.fieldRow}>
            <View style={styles.fieldLeft}>
              <Text style={styles.fieldLabel}>MERCHANT ID</Text>
              <Text style={[styles.fieldValue, styles.monoText]}>{merchantId || "—"}</Text>
            </View>
          </View>
        </View>

        {/* ══ SECTION: SECURITY ════════════════════════════════════ */}
        <SectionHeader label="SECURITY" icon="shield-checkmark-outline" />
        <View style={styles.card}>
          <Pressable
            style={styles.actionRow}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowPasswordSection((p) => !p);
              setOldPassword(""); setNewPassword(""); setConfirmPassword("");
            }}
          >
            <View style={styles.actionLeft}>
              <View style={[styles.actionIcon, { backgroundColor: "#d1fae5" }]}>
                <Ionicons name="key-outline" size={18} color="#065f46" />
              </View>
              <View>
                <Text style={styles.actionTitle}>Change Password</Text>
                <Text style={styles.actionSub}>Update your login password</Text>
              </View>
            </View>
            <Ionicons
              name={showPasswordSection ? "chevron-up" : "chevron-down"}
              size={14}
              color="#9ca3af"
            />
          </Pressable>

          {showPasswordSection && (
            <View style={styles.passwordForm}>
              <View style={styles.divider} />
              <PasswordInput label="Current Password" value={oldPassword} onChange={setOldPassword} show={showOld} onToggle={() => setShowOld(v => !v)} placeholder="Enter current password" />
              <PasswordInput label="New Password" value={newPassword} onChange={setNewPassword} show={showNew} onToggle={() => setShowNew(v => !v)} placeholder="Min. 6 characters" />
              <PasswordInput label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} show={showConfirm} onToggle={() => setShowConfirm(v => !v)} placeholder="Re-enter new password" />
              <Pressable
                style={[styles.passwordSaveBtn, savingPassword && styles.btnDisabled]}
                onPress={handleChangePassword}
                disabled={savingPassword}
              >
                {savingPassword
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.passwordSaveBtnText}>Update Password</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.divider} />
          <InfoRow icon="checkmark-circle-outline" label="Voucher Verification" value="Auto on receive" />
          <View style={styles.divider} />
          <InfoRow icon="shield-outline" label="Signature Scheme" value="ECDSA secp256k1" />
          <View style={styles.divider} />
          <InfoRow icon="cloud-done-outline" label="Sync" value="Auto when online" />
          <View style={styles.divider} />
          <View style={styles.keysRow}>
            <View style={styles.keysLeft}>
              <Text style={styles.keysLabel}>Trusted user keys</Text>
              <Text style={styles.keysSub}>
                {trustedCount} keys · {formatUpdatedAt(trustedUpdatedAt)}
              </Text>
            </View>
            <Pressable
              style={[styles.keysBtn, refreshingKeys && styles.btnDisabled]}
              onPress={handleRefreshKeys}
              disabled={refreshingKeys}
            >
              {refreshingKeys ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.keysBtnText}>Refresh Keys</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* ══ SECTION: HELP & SUPPORT ═══════════════════════════════ */}
        <SectionHeader label="HELP & SUPPORT" icon="chatbubble-ellipses-outline" />
        <View style={styles.card}>
          {FAQ_ITEMS.map((item, i) => (
            <View key={item.q}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable style={styles.faqQuestion} onPress={() => toggleFaq(i)}>
                <Text style={styles.faqQ}>{item.q}</Text>
                <Ionicons
                  name={openFaq === i ? "chevron-up" : "chevron-down"}
                  size={14}
                  color="#9ca3af"
                />
              </Pressable>
              {openFaq === i && <Text style={styles.faqA}>{item.a}</Text>}
            </View>
          ))}
        </View>

        {/* ══ CONTACT CARD ════════════════════════════════════════= */}
        <SectionHeader label="CONTACT SUPPORT" icon="mail-outline" />
        <View style={styles.contactCard}>
          <View style={styles.contactRow}>
            <View style={[styles.contactIcon, { backgroundColor: "#d1fae5" }]}>
              <Ionicons name="headset-outline" size={20} color="#065f46" />
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactName}>Quantrix</Text>
              <Text style={styles.contactRole}>Developer & Support</Text>
            </View>
          </View>
          <Pressable
            style={styles.emailBtn}
            onPress={() => Linking.openURL("mailto:ashleshskumar12@gmail.com?subject=NONETPAY%20Merchant%20Support")}
          >
            <Ionicons name="mail-outline" size={16} color="#fff" />
            <Text style={styles.emailBtnText}>ashleshskumar12@gmail.com</Text>
          </Pressable>
          <Text style={styles.supportNote}>
            Typically responds within 24 hours. Please include your Merchant ID for faster assistance.
          </Text>
        </View>

        {/* ══ APP UPDATE ═════════════════════════════════════════════ */}
        <SectionHeader label="APP UPDATE" icon="cloud-download-outline" />
        <View style={styles.card}>
          <View style={styles.updateRow}>
            <View style={styles.updateLeft}>
              <View style={[styles.actionIcon, { backgroundColor: "#d1fae5" }]}>
                <Ionicons name="rocket-outline" size={18} color="#065f46" />
              </View>
              <View>
                <Text style={styles.actionTitle}>NONETPAY v{appVersion}</Text>
                <Text style={styles.actionSub}>
                  {updateStatus === "available" ? "✅ Update available!"
                  : updateStatus === "uptodate" ? "✅ You're on the latest"
                  : updateStatus === "error" ? "⚠️ Dev mode — no OTA check"
                  : "Tap to check for updates"}
                </Text>
              </View>
            </View>
            <Pressable
              style={[styles.updateBtn, checkingUpdate && styles.btnDisabled]}
              onPress={handleCheckUpdate}
              disabled={checkingUpdate}
            >
              {checkingUpdate
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.updateBtnText}>Check</Text>}
            </Pressable>
          </View>
        </View>

        {/* ══ APP INFO ═════════════════════════════════════════════= */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoText}>NONETPAY · Merchant · v{appVersion}</Text>
          <Text style={styles.appInfoText}>Secure · Fast · Works Offline</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function SectionHeader({ label, icon }: { label: string; icon: any }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={14} color="rgba(255,255,255,0.75)" style={styles.sectionIcon} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color="#10b981" style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoBadge}><Text style={styles.infoBadgeText}>{value}</Text></View>
    </View>
  );
}

function EditableField({
  label, value, draft, isEditing, onEdit, onChangeDraft, multiline = false,
}: {
  label: string; value: string; draft: string;
  isEditing: boolean; onEdit: () => void;
  onChangeDraft: (v: string) => void; multiline?: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldLeft}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {isEditing ? (
          <TextInput
            style={[styles.fieldInput, multiline && { height: 60, textAlignVertical: "top" }]}
            value={draft}
            onChangeText={onChangeDraft}
            autoFocus
            multiline={multiline}
          />
        ) : (
          <Text style={styles.fieldValue}>{value || "—"}</Text>
        )}
      </View>
      {!isEditing && (
        <Pressable style={styles.editPill} onPress={onEdit}>
          <View style={styles.inlineIconText}>
            <Ionicons name="create-outline" size={12} color="#059669" />
            <Text style={styles.editPillText}>Edit</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

function PasswordInput({
  label, value, onChange, show, onToggle, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void; placeholder: string;
}) {
  return (
    <View style={styles.pwField}>
      <Text style={styles.pwLabel}>{label}</Text>
      <View style={styles.pwRow}>
        <TextInput
          style={styles.pwInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={onToggle} style={styles.eyeBtn}>
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={16} color="#6b7280" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 58, paddingBottom: 16, paddingHorizontal: 18,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  backArrow: { fontSize: 20, color: "#fff", fontWeight: "700" },
  title: { flex: 1, fontSize: 22, fontWeight: "800", color: "#fff", textAlign: "center" },
  scroll: { paddingHorizontal: 18, paddingBottom: 20 },

  avatarCard: {
    borderRadius: 24, overflow: "hidden", marginBottom: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  avatarInner: { alignItems: "center", paddingVertical: 28 },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center", alignItems: "center", marginBottom: 12,
  },
  avatarLetter: { fontSize: 34, fontWeight: "800", color: "#059669" },
  avatarName: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 8 },
  avatarBadge: {
    backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 14,
    paddingVertical: 5, borderRadius: 20,
  },
  avatarBadgeText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  inlineIconText: { flexDirection: "row", alignItems: "center", gap: 6 },

  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 8, marginTop: 4, paddingHorizontal: 4,
  },
  sectionIcon: { fontSize: 14, marginRight: 6 },
  sectionLabel: {
    fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.75)",
    letterSpacing: 1.2, textTransform: "uppercase",
  },

  card: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 20, padding: 18, marginBottom: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  divider: { height: 1, backgroundColor: "#f3f4f6", marginVertical: 12 },

  fieldRow: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between",
  },
  fieldLeft: { flex: 1, marginRight: 10 },
  fieldLabel: {
    fontSize: 10, color: "#9ca3af", fontWeight: "700",
    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 5,
  },
  fieldValue: { fontSize: 16, fontWeight: "600", color: "#111827" },
  fieldInput: {
    fontSize: 15, fontWeight: "600", color: "#1f2937",
    borderBottomWidth: 2, borderBottomColor: "#059669", paddingVertical: 2,
  },
  monoText: { fontSize: 11, color: "#6b7280", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  editPill: {
    backgroundColor: "#d1fae5", paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 10, marginTop: 4,
  },
  editPillText: { color: "#059669", fontSize: 13, fontWeight: "600" },
  lockBadge: {
    backgroundColor: "#f9fafb", paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 8, marginTop: 4,
    borderWidth: 1, borderColor: "#e5e7eb",
  },
  lockText: { fontSize: 11, color: "#9ca3af", fontWeight: "600" },

  inlineButtons: { flexDirection: "row", gap: 10, marginTop: 12 },
  cancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: "#f3f4f6", alignItems: "center",
    borderWidth: 1, borderColor: "#e5e7eb",
  },
  cancelBtnText: { color: "#374151", fontSize: 14, fontWeight: "600" },
  saveBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: "#059669", alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  actionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  actionLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  actionIcon: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: "center", alignItems: "center", marginRight: 12,
  },
  actionTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  actionSub: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  chevron: { fontSize: 13, color: "#9ca3af", fontWeight: "700" },

  passwordForm: { paddingTop: 4 },
  pwField: { marginBottom: 14 },
  pwLabel: {
    fontSize: 10, color: "#9ca3af", fontWeight: "700",
    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6,
  },
  pwRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb",
    borderRadius: 10, backgroundColor: "#f9fafb",
    paddingHorizontal: 12,
  },
  pwInput: {
    flex: 1, fontSize: 15, color: "#1f2937",
    paddingVertical: 11, fontWeight: "500",
  },
  eyeBtn: { padding: 4 },
  eyeText: { fontSize: 16 },
  passwordSaveBtn: {
    backgroundColor: "#059669", paddingVertical: 13,
    borderRadius: 12, alignItems: "center", marginTop: 4,
  },
  passwordSaveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  infoRow: { flexDirection: "row", alignItems: "center" },
  infoIcon: { fontSize: 16, marginRight: 10, width: 24, textAlign: "center" },
  infoLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151" },
  infoBadge: {
    backgroundColor: "#f0fdf4", paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: "#bbf7d0",
  },
  infoBadgeText: { color: "#15803d", fontSize: 12, fontWeight: "700" },

  keysRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  keysLeft: { flex: 1, marginRight: 12 },
  keysLabel: { fontSize: 14, fontWeight: "700", color: "#111827" },
  keysSub: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  keysBtn: {
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    minWidth: 110,
  },
  keysBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  faqQuestion: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingVertical: 4, gap: 8,
  },
  faqQ: { flex: 1, fontSize: 14, fontWeight: "700", color: "#1f2937", lineHeight: 20 },
  faqA: {
    fontSize: 13.5, color: "#4b5563", lineHeight: 21,
    marginTop: 8, marginBottom: 4,
    backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12,
    borderLeftWidth: 3, borderLeftColor: "#059669",
  },

  contactCard: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 20, padding: 18, marginBottom: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  contactRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  contactIcon: {
    width: 52, height: 52, borderRadius: 16,
    justifyContent: "center", alignItems: "center", marginRight: 14,
  },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 17, fontWeight: "800", color: "#111827" },
  contactRole: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  emailBtn: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#059669", borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, gap: 8, marginBottom: 12,
  },
  emailBtnIcon: { fontSize: 16 },
  emailBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  supportNote: { fontSize: 12, color: "#9ca3af", lineHeight: 18, textAlign: "center" },

  appInfo: { alignItems: "center", marginTop: 8, marginBottom: 4 },
  appInfoText: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 2 },

  // OTA Update row
  updateRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  updateLeft: {
    flexDirection: "row", alignItems: "center", flex: 1,
  },
  updateBtn: {
    backgroundColor: "#059669",
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 10, minWidth: 60, alignItems: "center",
  },
  updateBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
