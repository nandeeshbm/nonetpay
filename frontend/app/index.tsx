import React from "react";
import { View, Text, Pressable, StyleSheet, StatusBar, Linking, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

const APP_BUILD_URL = "https://expo.dev/accounts/mujju-212/projects/offline-pay/builds/d4fee352-301d-4602-9ba1-6ee39083bfa8";
const REPO_URL = "https://github.com/mujju-212/nonetpay";

export default function RoleSelectScreen() {
  const openExternalLink = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={["#f7f3ff", "#f9f7ff", "#f3f1ff"]} style={styles.background} />
      <View style={styles.glowTop} />
      <View style={styles.glowRight} />
      <View style={styles.glowBottom} />

      <View style={styles.container}>
        <View style={styles.headerSection}>
          <View style={styles.brandIconWrap}>
            <Image source={require("../assets/images/nnplogo.png")} style={styles.brandLogo} resizeMode="contain" />
          </View>
          <Text style={styles.title}>NONETPAY</Text>
          <Text style={styles.subtitle}>Choose your role to continue securely</Text>
          <View style={styles.featureRow}>
            <Pill text="Encrypted" />
            <Pill text="Instant" />
            <Pill text="Offline Ready" />
          </View>
        </View>

        <View style={styles.cardsSection}>
          <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={() => router.push("/login")}>
            <View style={[styles.cardIconWrap, styles.userIconWrap]}>
              <Ionicons name="person-outline" size={20} color="#2f9a5e" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Continue as User</Text>
              <Text style={styles.cardSubtitle}>Pay merchants, view history, and manage wallet</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#8b8fa6" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push("/merchant-login")}
          >
            <View style={[styles.cardIconWrap, styles.merchantIconWrap]}>
              <Ionicons name="storefront-outline" size={20} color="#d97706" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Continue as Merchant</Text>
              <Text style={styles.cardSubtitle}>Accept offline payments and track sales</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#8b8fa6" />
          </Pressable>
        </View>

        <View style={styles.footerSection}>
          <Pressable style={styles.linkRow} onPress={() => router.push("/register")}>
            <Text style={styles.linkLabel}>New user? Create account</Text>
            <Ionicons name="arrow-forward" size={15} color="#6f63ff" />
          </Pressable>

          <Pressable style={styles.linkRow} onPress={() => router.push("/merchant-register")}>
            <Text style={styles.linkLabel}>New merchant? Register shop</Text>
            <Ionicons name="arrow-forward" size={15} color="#6f63ff" />
          </Pressable>

          <Pressable style={styles.testButton} onPress={() => router.push("/test-connection")}>
            <Ionicons name="build-outline" size={14} color="#6357d9" />
            <Text style={styles.testText}>Connection Test</Text>
          </Pressable>

          <View style={styles.externalLinksSection}>
            <Text style={styles.externalLinksTitle}>Project Links</Text>
            <Pressable style={styles.externalLinkButton} onPress={() => openExternalLink(APP_BUILD_URL)}>
              <Ionicons name="phone-portrait-outline" size={14} color="#4f46a5" />
              <Text style={styles.externalLinkText}>Open Latest Expo Build</Text>
            </Pressable>
            <Pressable style={styles.externalLinkButton} onPress={() => openExternalLink(REPO_URL)}>
              <Ionicons name="logo-github" size={14} color="#4f46a5" />
              <Text style={styles.externalLinkText}>Open GitHub Repository</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.featurePill}>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f7f3ff" },
  background: { ...StyleSheet.absoluteFillObject },
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
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 22,
  },
  headerSection: {
    marginTop: 8,
    alignItems: "center",
  },
  brandIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
    shadowColor: "#b8aef0",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: "hidden",
  },
  brandLogo: {
    width: 52,
    height: 52,
  },
  title: {
    marginTop: 12,
    fontSize: 30,
    fontWeight: "800",
    color: "#1f2433",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: "#70758b",
    fontWeight: "600",
  },
  featureRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  featurePill: {
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e7e2ff",
  },
  featureText: {
    fontSize: 11,
    color: "#6357d9",
    fontWeight: "700",
  },
  cardsSection: {
    marginTop: 26,
    gap: 12,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ede9fe",
    shadowColor: "#c6bff3",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.82,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  userIconWrap: {
    backgroundColor: "#e9f9ef",
  },
  merchantIconWrap: {
    backgroundColor: "#fff3e3",
  },
  cardBody: {
    flex: 1,
    paddingRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1f2433",
  },
  cardSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: "#7a8096",
  },
  footerSection: {
    marginTop: "auto",
    gap: 8,
    paddingTop: 18,
  },
  linkRow: {
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#ebe7ff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  linkLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#4f46a5",
  },
  testButton: {
    height: 38,
    borderRadius: 12,
    backgroundColor: "#efe9ff",
    borderWidth: 1,
    borderColor: "#ddd6fe",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  testText: {
    fontSize: 12,
    color: "#6357d9",
    fontWeight: "700",
  },
  externalLinksSection: {
    marginTop: 8,
    gap: 8,
  },
  externalLinksTitle: {
    fontSize: 12,
    color: "#7a8096",
    fontWeight: "700",
    textAlign: "center",
  },
  externalLinkButton: {
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: "#ebe7ff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  externalLinkText: {
    fontSize: 12,
    color: "#4f46a5",
    fontWeight: "700",
  },
});
