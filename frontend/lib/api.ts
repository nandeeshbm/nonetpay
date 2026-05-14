import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  notifyPaymentConfirmed,
  notifyVoucherSynced,
} from "./notifications";
import { API_BASE_URL } from "../constants/Config";
export { API_BASE_URL, API_BASE_URL_HELP, HAS_API_BASE_URL } from "../constants/Config";

// ─── Backend URL ──────────────────────────────────────────────────────────────
// Reads from the shared frontend config so every screen uses the same env value.
export const BASE_URL = API_BASE_URL;

export async function parseJsonResponse(response: Response): Promise<{ ok: boolean; json: any; raw: string }> {
  const raw = await response.text();
  try {
    const json = raw ? JSON.parse(raw) : {};
    return { ok: true, json, raw };
  } catch {
    return { ok: false, json: null, raw };
  }
}


// ─── AsyncStorage keys ────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  WALLET_BALANCE: "@walletBalance",             // cached numeric balance
  OFFLINE_TRANSACTIONS: "@offlineTransactions", // user's outgoing payment queue
  USED_VOUCHER_IDS: "@usedVoucherIds",          // merchant double-spend guard
  GENERATED_VOUCHERS: "@generatedVouchers",     // vouchers created by user (incl. unused ones)
};

// ─── Network check ────────────────────────────────────────────────────────────
/**
 * Returns true when the device can reach the backend.
 * Uses a 3-second timeout so the UI never hangs waiting for a response.
 */
export async function checkOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${API_BASE_URL}/api/health`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Local balance cache ──────────────────────────────────────────────────────
/** Persist the latest known wallet balance so it is readable when offline. */
export async function saveLocalBalance(balance: number): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.WALLET_BALANCE, String(balance));
}

/** Read the last cached wallet balance. Returns null if never saved. */
export async function getLocalBalance(): Promise<number | null> {
  const val = await AsyncStorage.getItem(STORAGE_KEYS.WALLET_BALANCE);
  return val !== null ? Number(val) : null;
}

/** Deduct an amount from the locally cached balance. Pass a negative amount to credit. */
export async function deductLocalBalance(amount: number): Promise<number> {
  const current = (await getLocalBalance()) ?? 0;
  const next = Math.max(0, current - amount);
  await saveLocalBalance(next);
  return next;
}

// ─── Generated vouchers (user-side) ─────────────────────────────────────────
/** Vouchers expire after this many days if the merchant hasn't scanned them. */
export const VOUCHER_EXPIRY_DAYS = 7;

export type GeneratedVoucher = {
  voucherId: string;
  merchantId: string;
  merchantName?: string;
  amount: number;
  createdAt: string;
  expiresAt: string;   // ISO string — createdAt + VOUCHER_EXPIRY_DAYS days
  issuedTo: string;
  signature: string;
  publicKeyHex: string;
  used: boolean;       // true once merchant confirms scan OR voucher expired
  expired?: boolean;   // true when voucher expired and money was refunded
};

/** Returns true when the voucher is past its expiry and was never used. */
export function isVoucherExpired(v: GeneratedVoucher): boolean {
  if (v.used) return false;
  if (!v.expiresAt) return false;
  return new Date() > new Date(v.expiresAt);
}

/**
 * Check all locally-stored unused vouchers.  Any that have passed their
 * expiresAt are refunded: balance is added back locally (and synced to the
 * backend when online).  Returns the total amount refunded.
 */
export async function refundExpiredVouchers(token: string | null): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.GENERATED_VOUCHERS);
  if (!raw) return 0;

  const list: GeneratedVoucher[] = JSON.parse(raw);
  let totalRefunded = 0;

  const updated = await Promise.all(
    list.map(async (v) => {
      if (!v.used && !v.expired && isVoucherExpired(v)) {
        // Refund locally first — works offline too
        await deductLocalBalance(-v.amount); // negative deduct = credit

        // Try to notify backend so server-side balance is updated
        if (token) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            await fetch(`${API_BASE_URL}/api/vouchers/refund-expired`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                voucherId: v.voucherId,
                amount: v.amount,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
          } catch {
            // Offline — local refund already applied; backend will reconcile on next sync
          }
        }

        totalRefunded += v.amount;
        return { ...v, used: true, expired: true };
      }
      return v;
    })
  );

  if (totalRefunded > 0) {
    await AsyncStorage.setItem(STORAGE_KEYS.GENERATED_VOUCHERS, JSON.stringify(updated));
  }
  return totalRefunded;
}

/** Save a newly generated voucher so the user can show it again if needed. */
export async function saveGeneratedVoucher(v: GeneratedVoucher): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.GENERATED_VOUCHERS);
  const list: GeneratedVoucher[] = raw ? JSON.parse(raw) : [];
  if (!list.find((x) => x.voucherId === v.voucherId)) {
    list.push(v);
    await AsyncStorage.setItem(STORAGE_KEYS.GENERATED_VOUCHERS, JSON.stringify(list));
  }
}

/** Get all generated vouchers (both used and unused). */
export async function getGeneratedVouchers(): Promise<GeneratedVoucher[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.GENERATED_VOUCHERS);
  return raw ? JSON.parse(raw) : [];
}

/** Mark a voucher as used (after merchant confirms / sync succeeds). */
export async function markVoucherUsed(voucherId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.GENERATED_VOUCHERS);
  if (!raw) return;
  const list: GeneratedVoucher[] = JSON.parse(raw);
  const updated = list.map((v) => v.voucherId === voucherId ? { ...v, used: true } : v);
  await AsyncStorage.setItem(STORAGE_KEYS.GENERATED_VOUCHERS, JSON.stringify(updated));
}

// ─── Offline transaction queue ────────────────────────────────────────────────
export type OfflineTransaction = {
  voucherId: string;
  userId: string;
  merchantId: string;
  merchantName?: string;
  amount: number;
  timestamp: string;
  signature: string;
  publicKeyHex: string;
  status: "pending" | "synced" | "failed";
  failureReason?: string;
};

/** Add a new payment to the offline queue (idempotent — ignores duplicates). */
export async function queueOfflineTransaction(txn: OfflineTransaction): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_TRANSACTIONS);
  const list: OfflineTransaction[] = raw ? JSON.parse(raw) : [];
  // Prevent duplicates
  if (!list.find((t) => t.voucherId === txn.voucherId)) {
    list.push(txn);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_TRANSACTIONS, JSON.stringify(list));
  }
}

/** Read all queued offline transactions. */
export async function getOfflineTransactions(): Promise<OfflineTransaction[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_TRANSACTIONS);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Sync all "pending" offline transactions to the backend.
 * Groups transactions by merchantId and calls /api/vouchers/sync for each group.
 * Marks as "synced" if backend confirms sync OR reports duplicate (already synced by merchant).
 *
 * @returns number of newly synced transactions
 */
export async function syncOfflineTransactions(token: string): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_TRANSACTIONS);
  if (!raw) return 0;

  const list: OfflineTransaction[] = JSON.parse(raw);
  const pending = list.filter((t) => t.status === "pending");
  if (pending.length === 0) return 0;

  // Group by merchantId — the sync endpoint requires one merchantId per call
  const byMerchant: Record<string, OfflineTransaction[]> = {};
  for (const txn of pending) {
    if (!byMerchant[txn.merchantId]) byMerchant[txn.merchantId] = [];
    byMerchant[txn.merchantId].push(txn);
  }

  let syncedCount = 0;
  let didUpdate = false;
  for (const [merchantId, txns] of Object.entries(byMerchant)) {
    try {
      const vouchers = txns.map((t) => ({
        voucherId: t.voucherId,
        merchantId: t.merchantId,
        merchantName: t.merchantName,
        amount: t.amount,
        createdAt: t.timestamp,
        issuedTo: t.userId,
        signature: t.signature,
        publicKeyHex: t.publicKeyHex,
      }));

      const response = await fetch(`${API_BASE_URL}/api/vouchers/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, vouchers }),
      });

      if (response.ok) {
        const result = await response.json();
        // syncedNow = user uploaded first (voucher backed up, but merchant hasn't scanned yet)
        const syncedNow = new Set<string>(result.syncedIds || []);
        const rejectedReasonById = new Map<string, string>(
          (result.rejected || []).map((r: { reason: string; voucherId: string }) => [r.voucherId, r.reason])
        );
        // alreadySynced = backend already had this voucher = MERCHANT scanned first = confirmed
        const alreadySynced = new Set<string>(
          (result.rejected || [])
            .filter((r: { reason: string; voucherId: string }) => r.reason === "Duplicate voucherId")
            .map((r: { voucherId: string }) => r.voucherId)
        );

        // Build set of server-rejected voucherIds (non-duplicate reasons)
        // These transactions reached the server but were refused — mark as
        // "failed" so they never block the pending queue forever.
        const serverRejected = new Set<string>(
          (result.rejected || [])
            .filter((r: { reason: string; voucherId: string }) => r.reason !== "Duplicate voucherId")
            .map((r: { voucherId: string }) => r.voucherId)
        );

        for (const txn of txns) {
          if (syncedNow.has(txn.voucherId) || alreadySynced.has(txn.voucherId)) {
            txn.status = "synced";
            delete txn.failureReason;
            didUpdate = true;
            syncedCount++;

            // ── Explicitly deduct from backend balance via authenticated endpoint ──
            // This is the guaranteed deduction path. The endpoint has idempotency
            // protection (voucherId check) so it won't double-deduct.
            try {
              await fetch(`${API_BASE_URL}/api/balance/deduct`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                  amount: txn.amount,
                  merchantId: txn.merchantId,
                  voucherId: txn.voucherId,
                }),
              });
            } catch {
              // If this fails, it will be retried next time sync runs
            }

            // Mark voucher as used whenever the transaction syncs (user or merchant first).
            // The voucher IS done from the user's perspective — money has left their wallet.
            await markVoucherUsed(txn.voucherId);

            if (alreadySynced.has(txn.voucherId)) {
              // Merchant already had this voucher → payment fully confirmed
              await notifyPaymentConfirmed(txn.amount);
            } else {
              // User backed up first — merchant will scan later
              await notifyVoucherSynced(txn.amount);
            }
          } else if (serverRejected.has(txn.voucherId)) {
            // Server received the request but rejected this voucher (bad signature,
            // insufficient balance, etc.). It will never sync — mark failed so it
            // leaves the pending queue and stops blocking the banner.
            txn.status = "failed";
            txn.failureReason = rejectedReasonById.get(txn.voucherId) || "Payment could not be verified";
            didUpdate = true;
          }
        }
      }
    } catch {
      // Network still unavailable — keep as pending, retry next time
    }
  }

  if (didUpdate) {
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_TRANSACTIONS, JSON.stringify(list));
  }
  return syncedCount;
}
