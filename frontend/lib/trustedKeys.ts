import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./api";

const TRUSTED_KEYS_KEY = "@trusted_user_keys";
const TRUSTED_KEYS_META_KEY = "@trusted_user_keys_meta";

export type TrustedUserKey = {
  userId: string;
  publicKeyHex: string;
  registeredAt?: string | null;
};

type TrustedKeysMeta = {
  updatedAt: string;
  count: number;
};

function normalizeKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export async function loadTrustedUserKeys(): Promise<TrustedUserKey[]> {
  const raw = await AsyncStorage.getItem(TRUSTED_KEYS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadTrustedKeysMeta(): Promise<TrustedKeysMeta | null> {
  const raw = await AsyncStorage.getItem(TRUSTED_KEYS_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.updatedAt) return null;
    return parsed as TrustedKeysMeta;
  } catch {
    return null;
  }
}

export async function refreshTrustedUserKeys(token: string): Promise<TrustedKeysMeta> {
  const response = await fetch(`${API_BASE_URL}/api/keys/users`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to refresh trusted keys");
  }

  const keys = Array.isArray(data.keys) ? data.keys : [];
  const normalized: TrustedUserKey[] = keys
    .filter((k) => k && k.publicKeyHex)
    .map((k) => ({
      userId: String(k.userId || ""),
      publicKeyHex: normalizeKey(k.publicKeyHex),
      registeredAt: k.registeredAt || null,
    }));

  await AsyncStorage.setItem(TRUSTED_KEYS_KEY, JSON.stringify(normalized));

  const meta: TrustedKeysMeta = {
    updatedAt: new Date().toISOString(),
    count: normalized.length,
  };
  await AsyncStorage.setItem(TRUSTED_KEYS_META_KEY, JSON.stringify(meta));

  return meta;
}

export async function ensureTrustedUserKeys(token: string): Promise<TrustedKeysMeta | null> {
  const existing = await loadTrustedUserKeys();
  if (existing.length > 0) {
    const meta = await loadTrustedKeysMeta();
    return meta || null;
  }
  return refreshTrustedUserKeys(token);
}

export async function isPublicKeyTrusted(publicKeyHex: string): Promise<boolean> {
  const normalized = normalizeKey(publicKeyHex);
  if (!normalized) return false;
  const keys = await loadTrustedUserKeys();
  return keys.some((k) => normalizeKey(k.publicKeyHex) === normalized);
}
