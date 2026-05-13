/**
 * offlineAuth.ts
 *
 * Enables login to work fully offline by caching a SHA-256 credential hash
 * and the last known session (token + user/merchant data) during a successful
 * online login.  On subsequent offline attempts the hash is verified locally
 * so users are never locked out just because the server is unreachable.
 *
 * Security properties:
 *  - Password is NEVER stored in plaintext.  Only a SHA-256(phone + ":" + password + ":nonetpay") hash is kept.
 *  - The cached JWT token is kept as-is (same token the server originally issued).
 *  - If the device has never logged in online, offline login is not available.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// ─── Storage keys ────────────────────────────────────────────────────────────
const KEY_USER_PWD_HASH      = "@offline_user_pwd_hash";
const KEY_MERCHANT_PWD_HASH  = "@offline_merchant_pwd_hash";
const KEY_OFFLINE_USER       = "@offline_cached_user";   // full user object
const KEY_OFFLINE_MERCHANT   = "@offline_cached_merchant"; // full merchant object
const KEY_OFFLINE_TOKEN      = "@offline_cached_token";  // last good JWT

// Salt suffix to make the hash domain-specific (prevents rainbow table reuse).
const HASH_SALT = ":nonetpay:v1";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute SHA-256 of `phone:password:nonetpay:v1` */
async function hashCredentials(phone: string, password: string): Promise<string> {
  const raw = `${phone.trim()}:${password}${HASH_SALT}`;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}

// ─── Save (called after successful online login) ──────────────────────────────

export type OfflineCachedSession = {
  token: string;
  user?: object;      // AuthUser  — present for user role
  merchant?: object;  // AuthMerchant — present for merchant role
};

/**
 * Persist everything needed for an offline login.
 * Call this immediately after a successful server response.
 */
export async function saveOfflineSession(
  role: "user" | "merchant",
  phone: string,
  password: string,
  session: OfflineCachedSession
): Promise<void> {
  try {
    const hash = await hashCredentials(phone, password);

    if (role === "user") {
      await AsyncStorage.setItem(KEY_USER_PWD_HASH, hash);
      if (session.user) {
        await AsyncStorage.setItem(KEY_OFFLINE_USER, JSON.stringify(session.user));
      }
    } else {
      await AsyncStorage.setItem(KEY_MERCHANT_PWD_HASH, hash);
      if (session.merchant) {
        await AsyncStorage.setItem(KEY_OFFLINE_MERCHANT, JSON.stringify(session.merchant));
      }
    }

    // Token is shared — overwrite with the latest one.
    await AsyncStorage.setItem(KEY_OFFLINE_TOKEN, session.token);
  } catch {
    // Non-fatal — worst case the user can't log in offline.
  }
}

// ─── Verify + restore (called on network failure during login) ────────────────

export type OfflineLoginResult =
  | { success: true;  token: string; user: object; role: "user" }
  | { success: true;  token: string; merchant: object; role: "merchant" }
  | { success: false; reason: "no_cache" | "wrong_credentials" };

/**
 * Attempt an offline login.
 * Returns a success result with the cached session, or a failure with a reason.
 */
export async function tryOfflineLogin(
  role: "user" | "merchant",
  phone: string,
  password: string
): Promise<OfflineLoginResult> {
  try {
    const hashKey  = role === "user" ? KEY_USER_PWD_HASH : KEY_MERCHANT_PWD_HASH;
    const dataKey  = role === "user" ? KEY_OFFLINE_USER  : KEY_OFFLINE_MERCHANT;

    const storedHash  = await AsyncStorage.getItem(hashKey);
    const storedData  = await AsyncStorage.getItem(dataKey);
    const storedToken = await AsyncStorage.getItem(KEY_OFFLINE_TOKEN);

    // No prior online login on this device.
    if (!storedHash || !storedData || !storedToken) {
      return { success: false, reason: "no_cache" };
    }

    // Verify credentials.
    const attemptHash = await hashCredentials(phone, password);
    if (attemptHash !== storedHash) {
      return { success: false, reason: "wrong_credentials" };
    }

    const data = JSON.parse(storedData);

    if (role === "user") {
      return { success: true, token: storedToken, user: data, role: "user" };
    } else {
      return { success: true, token: storedToken, merchant: data, role: "merchant" };
    }
  } catch {
    return { success: false, reason: "no_cache" };
  }
}

/**
 * Returns true if this device has a cached offline session for the given role.
 * Useful to show/hide the "Login in Offline Mode" hint.
 */
export async function hasOfflineSession(role: "user" | "merchant"): Promise<boolean> {
  try {
    const hashKey = role === "user" ? KEY_USER_PWD_HASH : KEY_MERCHANT_PWD_HASH;
    const hash    = await AsyncStorage.getItem(hashKey);
    const token   = await AsyncStorage.getItem(KEY_OFFLINE_TOKEN);
    return !!(hash && token);
  } catch {
    return false;
  }
}
