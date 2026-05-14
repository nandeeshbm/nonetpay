import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { API_BASE_URL, STORAGE_KEYS, parseJsonResponse } from "./api";

if (typeof (WebBrowser as any).maybeCompleteAuthSession === "function") {
  (WebBrowser as any).maybeCompleteAuthSession();
}
// ─────────────────────────────────────────────────────────────────────────────
// Razorpay Payment Helper
//
// Mobile flow:
//  1. App calls createTopUpOrder(token, amount)
//  2. Backend creates Razorpay order
//  3. Native Razorpay SDK opens in-app checkout
//  4. App verifies payment with backend and refreshes balance
//
// Web fallback:
//  Uses the hosted checkout page + callback redirect flow.
// ─────────────────────────────────────────────────────────────────────────────

export type CreateOrderResult = {
  success: boolean;
  orderId?: string;
  keyId?: string;
  checkoutUrl?: string;
  amount?: number;          // in paise
  error?: string;
};

type PaymentResult = {
  opened: boolean;
  newBalance?: number;
  error?: string;
};

type RazorpayPrefill = {
  name?: string;
  email?: string;
  contact?: string;
};

type NativePaymentSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

type NativePaymentError = {
  code?: number;
  description?: string;
  source?: string;
  step?: string;
  reason?: string;
  metadata?: {
    order_id?: string;
    payment_id?: string;
    [key: string]: unknown;
  };
};

function getNativeRazorpay():
  | { open: (options: Record<string, unknown>) => Promise<NativePaymentSuccess> }
  | null {
  if (Platform.OS === "web") return null;
  try {
    // Keep this dynamic so web builds do not try to resolve a native-only module.
    const nativeModule = require("react-native-razorpay");
    const resolved = nativeModule?.default ?? nativeModule ?? null;
    if (resolved && typeof resolved.open === "function") return resolved;
    return null;
  } catch {
    return null;
  }
}

function formatPaymentError(error: unknown): string {
  if (!error) return "Payment failed. Please try again.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || "Payment failed. Please try again.";
  const nativeError = error as NativePaymentError;
  if (!nativeError) return "Payment failed. Please try again.";
  if (nativeError.reason === "payment_cancelled") return "Payment cancelled";
  const detail = [nativeError.reason, nativeError.step]
    .filter(Boolean)
    .map((value) => String(value).replace(/_/g, " "))
    .join(" · ");
  if (!nativeError.description) return detail ? `Payment failed (${detail})` : "Payment failed. Please try again.";
  return detail ? `${nativeError.description} (${detail})` : nativeError.description;
}

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

async function openHostedCheckout(checkoutUrl: string): Promise<PaymentResult> {
  try {
    const returnUrl = Linking.createURL("payment-callback");
    const safeCheckoutUrl = normalizeCheckoutUrl(checkoutUrl);
    let result: { type: string; url?: string } | null = null;
    try {
      result = await WebBrowser.openAuthSessionAsync(safeCheckoutUrl, returnUrl);
    } catch (e: any) {
      const message = typeof e?.message === "string" ? e.message : "";
      if (message.toLowerCase().includes("auth") || message.toLowerCase().includes("session")) {
        try {
          await WebBrowser.openBrowserAsync(safeCheckoutUrl);
          return { opened: true, error: "Checkout opened in browser. Complete payment, then return and refresh your balance." };
        } catch (openErr: any) {
          return { opened: false, error: openErr?.message || "Failed to open checkout" };
        }
      }
      throw e;
    }
    if (result.type !== "success" || !result.url) {
      return { opened: true, error: "Payment cancelled" };
    }
    const parsed = Linking.parse(result.url);
    const status = typeof parsed.queryParams?.status === "string" ? parsed.queryParams.status : "";
    const balanceRaw = parsed.queryParams?.balance;
    const newBalance = typeof balanceRaw === "string" ? Number(balanceRaw) : undefined;
    if (status !== "success") {
      return { opened: true, error: "Payment cancelled" };
    }
    return { opened: true, newBalance: Number.isFinite(newBalance) ? newBalance : undefined };
  } catch (error: any) {
    return { opened: false, error: error?.message || "Failed to open checkout" };
  }
}

async function verifyTopUpPayment(
  token: string,
  payment: NativePaymentSuccess,
  amount: number
): Promise<{ success: boolean; balance?: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/payment/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: payment.razorpay_payment_id,
        razorpay_signature: payment.razorpay_signature,
        amount,
      }),
    });

    const parsed = await parseJsonResponse(response);
    if (!parsed.ok) {
      return { success: false, error: "Server returned an invalid response while verifying payment." };
    }

    const data = parsed.json ?? {};
    if (!response.ok) {
      return { success: false, error: data.error || "Payment verification failed" };
    }

    return {
      success: Boolean(data.success),
      balance: typeof data.balance === "number" ? data.balance : undefined,
      error: data.success ? undefined : (data.error || "Payment verification failed"),
    };
  } catch {
    return { success: false, error: "Network error while verifying payment." };
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
      keyId: data.keyId,
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

export async function initiateTopUp(
  token: string,
  amount: number,
  previousBalance: number,
  prefill?: RazorpayPrefill,
  onBalanceUpdate?: (balance: number) => void
): Promise<{ success: boolean; message: string }> {
  const returnUrl = Linking.createURL("payment-callback");
  const orderResult = await createTopUpOrder(token, amount, returnUrl);

  if (!orderResult.success || !orderResult.orderId || !orderResult.amount) {
    return { success: false, message: orderResult.error || "Failed to create order" };
  }

  const nativeRazorpay = getNativeRazorpay();

  if (nativeRazorpay && orderResult.keyId) {
    try {
      const payment = await nativeRazorpay.open({
        key: orderResult.keyId,
        amount: String(orderResult.amount),
        currency: "INR",
        name: "NONETPAY",
        description: "Wallet Top-up",
        order_id: orderResult.orderId,
        prefill: {
          name: prefill?.name,
          email: prefill?.email,
          contact: prefill?.contact,
        },
        notes: {
          purpose: "wallet_topup",
        },
        theme: {
          color: "#6f63ff",
        },
        modal: {
          backdropclose: false,
          confirm_close: true,
        },
      });

      const verified = await verifyTopUpPayment(token, payment, amount);
      if (!verified.success) {
        return { success: false, message: verified.error || "Payment verification failed" };
      }

      const result = await pollBalanceAfterPayment(token, previousBalance, amount, onBalanceUpdate);
      if (verified.balance !== undefined && onBalanceUpdate) {
        onBalanceUpdate(verified.balance);
      }

      return {
        success: true,
        message:
          verified.balance !== undefined
            ? `₹${amount} added! New balance: ₹${verified.balance}`
            : result.message,
      };
    } catch (error) {
      if (orderResult.checkoutUrl) {
        const checkout = await openHostedCheckout(orderResult.checkoutUrl);
        if (checkout.error === "Payment cancelled") {
          return { success: false, message: "Payment cancelled" };
        }
        if (!checkout.opened) {
          return { success: false, message: checkout.error || formatPaymentError(error) };
        }
        const result = await pollBalanceAfterPayment(token, previousBalance, amount, onBalanceUpdate);
        return result;
      }
      return { success: false, message: formatPaymentError(error) };
    }
  }

  if (!orderResult.checkoutUrl) {
    return { success: false, message: "Native checkout is unavailable and no hosted checkout URL was returned." };
  }

  const checkout = await openHostedCheckout(orderResult.checkoutUrl);
  if (checkout.error === "Payment cancelled") {
    return { success: false, message: "Payment cancelled" };
  }
  if (!checkout.opened) {
    return { success: false, message: checkout.error || "Failed to open payment checkout" };
  }

  let newBalance = checkout.newBalance ?? null;
  if (newBalance !== null && onBalanceUpdate) {
    onBalanceUpdate(newBalance);
  }

  if (newBalance === null) {
    const result = await pollBalanceAfterPayment(token, previousBalance, amount, onBalanceUpdate);
    return result;
  }

  return {
    success: true,
    message: `₹${amount} added! New balance: ₹${newBalance}`,
  };
}
