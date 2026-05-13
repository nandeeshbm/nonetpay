import React from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";

type BrandedLoaderProps = {
  label?: string;
};

export default function BrandedLoader({
  label = "Loading NONETPAY...",
}: BrandedLoaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <Image
          source={require("../assets/images/nnplogo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <ActivityIndicator size="large" color="#6f63ff" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 24,
  },
  logoWrap: {
    width: 84,
    height: 84,
    marginBottom: 18,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.96)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#b8aef0",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  logo: {
    width: 58,
    height: 58,
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "700",
    color: "#6b7280",
  },
});
