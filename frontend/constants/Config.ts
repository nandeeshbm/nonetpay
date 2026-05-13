import Constants from "expo-constants";
import { Platform } from "react-native";

// ─── App-wide constants ───────────────────────────────────────────────────────
// Single source of truth — import from here instead of hardcoding values.

// Backend URL — set EXPO_PUBLIC_API_URL in frontend/.env and switch it there.
const configExtra = Constants.expoConfig?.extra as
  | { apiBaseUrl?: string }
  | undefined;
const rawApiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  configExtra?.apiBaseUrl?.trim() ||
  "";

const normalizeUrl = (value: string): string => value.replace(/\/+$/, "");

const isPrivateHost = (host: string): boolean => {
  if (host === "localhost") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
};

const getHostFromUrl = (value: string): string | null => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

const deriveWebBaseUrl = (): string => {
  if (Platform.OS !== "web") return "";
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  return host ? `http://${host}:4000` : "";
};

const resolveApiBaseUrl = (): string => {
  const webFallback = deriveWebBaseUrl();
  if (!rawApiBaseUrl) return webFallback;
  if (Platform.OS !== "web" || !webFallback) return rawApiBaseUrl;

  const envHost = getHostFromUrl(rawApiBaseUrl);
  const webHost = getHostFromUrl(webFallback);
  if (envHost && webHost && envHost !== webHost && isPrivateHost(envHost)) {
    return webFallback;
  }

  return rawApiBaseUrl;
};

export const API_BASE_URL = normalizeUrl(resolveApiBaseUrl());
export const HAS_API_BASE_URL = API_BASE_URL.length > 0;
export const API_BASE_URL_HELP =
  "Set EXPO_PUBLIC_API_URL in frontend/.env to switch between local and deployed backends.";

// ─── Payment limits ───────────────────────────────────────────────────────────
/** Maximum amount per single top-up transaction (₹) */
export const MAX_SINGLE_AMOUNT = 1000;

/** Total wallet balance ceiling (₹) */
export const MAX_WALLET_BALANCE = 5000;

/** Days before an unused offline voucher expires and can be refunded */
export const VOUCHER_EXPIRY_DAYS = 7;

// ─── AsyncStorage keys ────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  // Auth
  AUTH_TOKEN:          "@auth_token",
  USER_DATA:           "@user_data",
  MERCHANT_DATA:       "@merchant_data",

  // Wallet
  WALLET_BALANCE:      "@walletBalance",

  // Offline payment queue
  OFFLINE_TRANSACTIONS: "@offlineTransactions",
  USED_VOUCHER_IDS:    "@usedVoucherIds",
  GENERATED_VOUCHERS:  "@generatedVouchers",

  // Crypto identity
  USER_ID:             "@user_id",
  USER_PUBLIC_KEY:     "@user_public_key",
} as const;

// ─── App metadata ─────────────────────────────────────────────────────────────
export const APP_VERSION = "1.0.0";
export const APP_NAME    = "NONETPAY";
