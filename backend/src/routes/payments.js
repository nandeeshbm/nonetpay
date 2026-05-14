import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { getDB } from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

function getBackendBase(req) {
	const forwardedProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
	const forwardedHost = (req.headers["x-forwarded-host"] || "").toString().split(",")[0].trim();
	const host = forwardedHost || req.get("host") || "localhost:5000";
	const proto = forwardedProto || (req.secure ? "https" : "http");
	if (host) {
		return `${proto}://${host}`;
	}

	const configured = (process.env.BACKEND_HOST || "").trim();
	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	return "http://localhost:5000";
}

// ── Razorpay instance ──────────────────────────────────────────────────────────
const razorpay = new Razorpay({
	key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_REPLACE_ME",
	key_secret: process.env.RAZORPAY_KEY_SECRET || "REPLACE_ME",
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/create-order
// Creates a Razorpay order for wallet top-up.
// Frontend calls this → gets orderId → opens hosted checkout page.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payment/create-order", authMiddleware, async (req, res) => {
	try {
		const { amount, returnUrl } = req.body || {};
		const keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_REPLACE_ME";

		if (!amount || typeof amount !== "number" || amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}
		if (amount > 1000) {
			return res.status(400).json({ error: "Maximum top-up is ₹1000" });
		}

		const order = await razorpay.orders.create({
			amount: Math.round(amount * 100),
			currency: "INR",
			receipt: `topup_${req.user.userId}_${Date.now()}`,
			notes: {
				userId: req.user.userId,
				purpose: "wallet_topup",
			},
		});

		// Build checkout URL from BACKEND_HOST, or infer from incoming request in deployed envs.
		const backendBase = getBackendBase(req);
		const safeReturnUrl =
			typeof returnUrl === "string" && returnUrl.trim().length > 0
				? encodeURIComponent(returnUrl.trim())
				: "";
		return res.json({
			success: true,
			orderId: order.id,
			amount: order.amount,
			currency: order.currency,
			keyId,
			checkoutUrl: `${backendBase}/api/payment/checkout/${order.id}?keyId=${encodeURIComponent(keyId)}&amount=${order.amount}&userId=${encodeURIComponent(req.user.userId)}&name=${encodeURIComponent("NONETPAY Wallet")}&returnUrl=${safeReturnUrl}`,
		});
	} catch (error) {
		console.error("Create order error:", error);
		return res.status(500).json({ error: "Failed to create payment order" });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payment/checkout/:orderId
// Serves a Razorpay checkout HTML page — opened in expo-web-browser / WebView.
// On success the page posts back to /api/payment/verify-from-web.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payment/checkout/:orderId", (req, res) => {
	const { orderId } = req.params;
	const { keyId, amount, userId, name, returnUrl } = req.query;
	const backendBase = getBackendBase(req);

	res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>NONETPAY – Add Money</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,sans-serif;background:#0f0f23;color:#fff;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;padding:24px}
    .card{background:#1a1a3e;border-radius:20px;padding:32px;width:100%;max-width:380px;
          text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
    .logo{font-size:32px;margin-bottom:8px}
    h1{font-size:22px;font-weight:700;margin-bottom:4px}
    .sub{color:#888;font-size:14px;margin-bottom:24px}
    .amount{font-size:40px;font-weight:800;color:#6c63ff;margin:16px 0}
    .btn{background:linear-gradient(135deg,#6c63ff,#4ecdc4);color:#fff;border:none;
         border-radius:12px;padding:16px 32px;font-size:18px;font-weight:700;
         width:100%;cursor:pointer;margin-top:16px}
    .status{margin-top:20px;padding:12px;border-radius:10px;display:none}
    .success{background:#0d3d2e;color:#4ade80;display:block}
    .error{background:#3d0d0d;color:#f87171;display:block}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">💳</div>
    <h1>NONETPAY</h1>
    <div class="sub">Add money to your wallet</div>
    <div class="amount">₹${Math.round(Number(amount) / 100)}</div>
    <button class="btn" id="payBtn" onclick="openPayment()">Pay with Razorpay</button>
    <div class="status" id="statusBox"></div>
  </div>

  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    const returnUrl = ${JSON.stringify(typeof returnUrl === "string" ? returnUrl : "")};

    function redirectToApp(status, balance) {
      if (!returnUrl) return;
      const sep = returnUrl.includes('?') ? '&' : '?';
      const next = returnUrl + sep + 'status=' + encodeURIComponent(status) +
        '&amount=' + encodeURIComponent(String(${Math.round(Number(amount) / 100)})) +
        (typeof balance === 'number' ? '&balance=' + encodeURIComponent(String(balance)) : '');
      window.location.href = next;
    }

    function openPayment() {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('payBtn').textContent = 'Opening...';

      var options = {
        key: '${keyId}',
        amount: ${amount},
        currency: 'INR',
        name: 'NONETPAY',
        description: 'Wallet Top-up',
        order_id: '${orderId}',
        handler: function(response) {
          // Payment success — send to backend verify endpoint
          showStatus('Verifying payment...', false);
          fetch('/api/payment/verify-from-web', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              userId: '${userId}',
              amount: ${Math.round(Number(amount) / 100)}
            })
          })
          .then(r => r.json())
          .then(data => {
            if(data.success) {
              showStatus('✅ ₹${Math.round(Number(amount) / 100)} added to wallet!', true);
              setTimeout(() => {
                redirectToApp('success', data.balance);
                window.close();
              }, 900);
            } else {
              showStatus('❌ Verification failed: ' + (data.error || 'Unknown error'), false);
            }
          })
          .catch(() => showStatus('❌ Network error during verification', false));
        },
        prefill: { name: '${name || "User"}' },
        theme: { color: '#6c63ff' },
        modal: {
          ondismiss: function() {
            redirectToApp('cancel');
            document.getElementById('payBtn').disabled = false;
            document.getElementById('payBtn').textContent = 'Pay with Razorpay';
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.open();
    }

    function showStatus(msg, success) {
      var box = document.getElementById('statusBox');
      box.textContent = msg;
      box.className = 'status ' + (success ? 'success' : 'error');
      document.getElementById('payBtn').style.display = 'none';
      // Signal in-app WebView that payment succeeded
      if (success && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('PAYMENT_SUCCESS');
      }
    }
  </script>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/verify-from-web
// Called by the hosted checkout HTML page after Razorpay payment succeeds.
// No auth token needed — userId comes from the page.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payment/verify-from-web", async (req, res) => {
	try {
		const {
			razorpay_order_id,
			razorpay_payment_id,
			razorpay_signature,
			userId,
			amount,
		} = req.body || {};

		if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userId || !amount) {
			return res.status(400).json({ error: "Missing fields" });
		}

		const expectedSig = crypto
			.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
			.update(`${razorpay_order_id}|${razorpay_payment_id}`)
			.digest("hex");

		if (expectedSig !== razorpay_signature) {
			return res.status(400).json({ error: "Invalid payment signature" });
		}

		const db = getDB();
		const users = db.collection("users");
		const user = await users.findOne({ userId });
		if (!user) return res.status(404).json({ error: "User not found" });

		const history = Array.isArray(user.balanceHistory) ? user.balanceHistory : [];
		if (history.some((h) => h.razorpayPaymentId === razorpay_payment_id)) {
			return res.json({ success: true, balance: user.balance || 0, message: "Already credited" });
		}

		const previousBalance = user.balance || 0;
		const newBalance = previousBalance + amount;
		await users.updateOne(
			{ userId },
			{
				$set: { balance: newBalance },
				$push: {
					balanceHistory: {
						type: "add",
						amount,
						timestamp: new Date().toISOString(),
						previousBalance,
						newBalance,
						razorpayOrderId: razorpay_order_id,
						razorpayPaymentId: razorpay_payment_id,
						method: "razorpay",
					},
				},
			}
		);

		console.log(`💰 Web checkout credited ₹${amount} → user ${userId} (${razorpay_payment_id})`);
		return res.json({ success: true, balance: newBalance, amount });
	} catch (error) {
		console.error("Web verify error:", error);
		return res.status(500).json({ error: "Verification failed" });
	}
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/verify
// Called by frontend AFTER user completes payment in Razorpay checkout.
// Verifies the payment signature, then credits the wallet.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payment/verify", authMiddleware, async (req, res) => {
	try {
		const {
			razorpay_order_id,
			razorpay_payment_id,
			razorpay_signature,
			amount,  // in rupees (original amount user intended)
		} = req.body || {};

		if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount) {
			return res.status(400).json({ error: "Missing payment verification fields" });
		}

		// ── Verify HMAC-SHA256 signature ──────────────────────────────────────
		// Razorpay signs: orderId + "|" + paymentId using key_secret
		const expectedSignature = crypto
			.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
			.update(`${razorpay_order_id}|${razorpay_payment_id}`)
			.digest("hex");

		if (expectedSignature !== razorpay_signature) {
			console.warn("⚠️  Invalid Razorpay signature — possible tampering");
			return res.status(400).json({ error: "Invalid payment signature" });
		}

		// ── Idempotency: check if this payment was already credited ──────────
		const db = getDB();
		const users = db.collection("users");
		const user = await users.findOne({ userId: req.user.userId });
		if (!user) return res.status(404).json({ error: "User not found" });

		const history = Array.isArray(user.balanceHistory) ? user.balanceHistory : [];
		const already = history.some((h) => h.razorpayPaymentId === razorpay_payment_id);
		if (already) {
			return res.json({
				success: true,
				balance: user.balance || 0,
				message: "Already credited",
			});
		}

		// ── Credit wallet ──────────────────────────────────────────────────────
		const previousBalance = user.balance || 0;
		const newBalance = previousBalance + amount;

		await users.updateOne(
			{ userId: req.user.userId },
			{
				$set: { balance: newBalance },
				$push: {
					balanceHistory: {
						type: "add",
						amount,
						timestamp: new Date().toISOString(),
						previousBalance,
						newBalance,
						razorpayOrderId: razorpay_order_id,
						razorpayPaymentId: razorpay_payment_id,
						method: "razorpay",
					},
				},
			}
		);

		console.log(`💰 User ${req.user.userId} topped up ₹${amount} via Razorpay (${razorpay_payment_id})`);

		return res.json({
			success: true,
			balance: newBalance,
			amount,
			message: `₹${amount} added to wallet`,
			paymentId: razorpay_payment_id,
		});
	} catch (error) {
		console.error("Verify payment error:", error);
		return res.status(500).json({ error: "Payment verification failed" });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/webhook
// Razorpay calls this URL automatically when a payment event happens.
// This is the SERVER-SIDE safety net — handles cases where frontend crashes
// after payment but before calling /verify.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payment/webhook", express.raw({ type: "application/json" }), async (req, res) => {
	try {
		const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
		const signature = req.headers["x-razorpay-signature"];

		// Verify webhook authenticity
		const expectedSig = crypto
			.createHmac("sha256", webhookSecret)
			.update(req.body)
			.digest("hex");

		if (signature !== expectedSig) {
			console.warn("⚠️  Webhook signature mismatch — rejected");
			return res.status(400).json({ error: "Invalid webhook signature" });
		}

		const event = JSON.parse(req.body.toString());
		console.log(`📩 Razorpay webhook: ${event.event}`);

		if (event.event === "payment.captured") {
			const payment = event.payload.payment.entity;
			const userId = payment.notes?.userId;
			const amountInPaise = payment.amount;
			const amountInRupees = amountInPaise / 100;

			if (userId && amountInPaise) {
				const db = getDB();
				const users = db.collection("users");
				const user = await users.findOne({ userId });

				if (user) {
					const history = Array.isArray(user.balanceHistory) ? user.balanceHistory : [];
					const already = history.some((h) => h.razorpayPaymentId === payment.id);

					if (!already) {
						const previousBalance = user.balance || 0;
						const newBalance = previousBalance + amountInRupees;

						await users.updateOne(
							{ userId },
							{
								$set: { balance: newBalance },
								$push: {
									balanceHistory: {
										type: "add",
										amount: amountInRupees,
										timestamp: new Date().toISOString(),
										previousBalance,
										newBalance,
										razorpayOrderId: payment.order_id,
										razorpayPaymentId: payment.id,
										method: "razorpay_webhook",
									},
								},
							}
						);
						console.log(`✅ Webhook credited ₹${amountInRupees} to user ${userId}`);
					}
				}
			}
		}

		return res.json({ received: true });
	} catch (error) {
		console.error("Webhook error:", error);
		return res.status(500).json({ error: "Webhook processing failed" });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/payout
// AUTO PAYOUT AGENT — called internally after successful voucher sync.
// Sends money from Razorpay X account to merchant's UPI ID.
// ─────────────────────────────────────────────────────────────────────────────
export async function triggerMerchantPayout(merchantId, amount, voucherId) {
	try {
		const db = getDB();
		const merchant = await db.collection("merchants").findOne({ merchantId });

		if (!merchant || !merchant.upiId) {
			console.log(`⚠️  Payout skipped for ${merchantId} — no UPI ID registered`);
			return { success: false, reason: "no_upi_id" };
		}

		// In TEST MODE — Razorpay accepts the API call but doesn't send real money
		// In LIVE MODE — real money goes to merchant's UPI within seconds
		const payout = await razorpay.payouts.create({
			account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || "TEST_ACCOUNT",
			amount: Math.round(amount * 100),  // paise
			currency: "INR",
			mode: "UPI",
			purpose: "payout",
			fund_account: {
				account_type: "vpa",
				vpa: { address: merchant.upiId },
				contact: {
					name: merchant.businessName || "Merchant",
					email: merchant.email || "merchant@offlinepay.in",
					contact: merchant.phone || "9999999999",
					type: "vendor",
				},
			},
			queue_if_low_balance: true,
			reference_id: voucherId,
			narration: `OfflinePay: Voucher ${voucherId}`,
			notes: { voucherId, merchantId },
		});

		console.log(`💸 Payout initiated: ₹${amount} → ${merchant.upiId} (${payout.id})`);

		// Record payout in merchant history
		await db.collection("payouts").insertOne({
			payoutId: payout.id,
			merchantId,
			voucherId,
			amount,
			upiId: merchant.upiId,
			status: payout.status,
			createdAt: new Date().toISOString(),
		});

		return { success: true, payoutId: payout.id, status: payout.status };
	} catch (error) {
		console.error(`❌ Payout failed for merchant ${merchantId}:`, error.message);
		return { success: false, reason: error.message };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payment/payout-status/:payoutId
// Check status of a payout (processed / queued / failed).
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payment/payout-status/:payoutId", authMiddleware, async (req, res) => {
	try {
		const payout = await razorpay.payouts.fetch(req.params.payoutId);
		return res.json({
			payoutId: payout.id,
			status: payout.status,
			amount: payout.amount / 100,
			utrNumber: payout.utr || null,
		});
	} catch (error) {
		console.error("Payout status error:", error);
		return res.status(500).json({ error: "Failed to fetch payout status" });
	}
});

export default router;
