import { API_BASE_URL, STORAGE_KEYS } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay Payment Helper
//
// Flow (in-app WebView — no external browser):
//  1. App calls createTopUpOrder(token, amount)
//  2. Backend creates Razorpay order → returns checkoutUrl
//  3. App opens checkoutUrl in an in-app WebView modal (wallet screen)
//  4. User pays inside the app → backend checkout page verifies payment
//  5. WebView detects success redirect → closes modal → balance updated
// ─────────────────────────────────────────────────────────────────────────────

export type CreateOrderResult = {
  success: boolean;
  orderId?: string;
  checkoutUrl?: string;
  amount?: number;          // in paise
  error?: string;
};

export function normalizeCheckoutUrl(checkoutUrl: string): string {
  try {
    const checkout = new URL(checkoutUrl);
    const apiBase = new URL(API_BASE_URL);

    // Safety fallback: if backend returns a stale tunnel domain,
    // force checkout route to open on the current API host.
    if (checkout.pathname.startsWith("/api/payment/checkout/")) {
      checkout.protocol = apiBase.protocol;
      checkout.host = apiBase.host;
    }

    return checkout.toString();
  } catch {
    return checkoutUrl;
  }
}

/**
 * Step 1: Create a Razorpay order on the backend.
 * Returns the checkout URL to open in an in-app WebView.
 */
export async function createTopUpOrder(
  token: string,
  amount: number,
  returnUrl?: string
): Promise<CreateOrderResult> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/payment/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount, returnUrl: returnUrl || "" }),
    });
    const data = await resp.json();
    if (!resp.ok) return { success: false, error: data.error || "Order creation failed" };
    return {
      success: true,
      orderId: data.orderId,
      checkoutUrl: data.checkoutUrl,
      amount: data.amount,
    };
  } catch {
    return { success: false, error: "Network error. Is backend running?" };
  }
}

/**
 * Fetch fresh balance from backend.
 * The checkout page already called /verify-from-web, so balance is updated.
 */
export async function fetchBalanceAfterPayment(token: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${API_BASE_URL}/api/balance`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) return null;
    const data = await resp.json();
    const balance = data.balance ?? null;
    if (balance !== null) {
      await AsyncStorage.setItem(STORAGE_KEYS.WALLET_BALANCE, String(balance));
    }
    return balance;
  } catch {
    return null;
  }
}

/**
 * Poll backend balance until it reflects the top-up.
 * Called after the WebView detects payment success.
 */
export async function pollBalanceAfterPayment(
  token: string,
  previousBalance: number,
  amount: number,
  onBalanceUpdate?: (balance: number) => void
): Promise<{ success: boolean; message: string }> {
  let newBalance: number | null = null;

  for (let i = 0; i < 8; i++) {
    const latest = await fetchBalanceAfterPayment(token);
    if (latest !== null && latest >= previousBalance + amount) {
      newBalance = latest;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (newBalance === null) {
    newBalance = await fetchBalanceAfterPayment(token);
  }

  if (newBalance !== null && onBalanceUpdate) {
    onBalanceUpdate(newBalance);
  }

  return {
    success: newBalance !== null,
    message: newBalance !== null
      ? `₹${amount} added! New balance: ₹${newBalance}`
      : "Payment is being verified. Pull to refresh in a few seconds.",
  };
}
