import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
	cors({
		origin: true,
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
	})
);

app.use(express.json());

const createEmptyRouter = () => express.Router();

export async function registerRoutes() {
	const authModule = await import("./routes/auth.js").catch(() => ({}));
	const balanceModule = await import("./routes/balance.js").catch(() => ({}));
	const vouchersModule = await import("./routes/vouchers.js").catch(() => ({}));
	const merchantModule = await import("./routes/merchant.js").catch(() => ({}));
	const keysModule = await import("./routes/keys.js").catch(() => ({}));
	const transactionsModule = await import("./routes/transactions.js").catch(() => ({}));
	const paymentsModule = await import("./routes/payments.js").catch(() => ({}));
	const adminModule = await import("./routes/admin.js").catch(() => ({}));
	const aiModule = await import("./routes/ai.js").catch(() => ({}));

	const authRoutes = authModule.default || createEmptyRouter();
	const balanceRoutes = balanceModule.default || createEmptyRouter();
	const vouchersRoutes = vouchersModule.default || createEmptyRouter();
	const merchantRoutes = merchantModule.default || createEmptyRouter();
	const keysRoutes = keysModule.default || createEmptyRouter();
	const transactionsRoutes = transactionsModule.default || createEmptyRouter();
	const paymentsRoutes = paymentsModule.default || createEmptyRouter();
	const adminRoutes = adminModule.default || createEmptyRouter();
	const aiRoutes = aiModule.default || createEmptyRouter();

	// ── Landing page & static assets (registered FIRST — owns GET /) ──
	const publicDir = path.join(__dirname, "../public");
	app.use(express.static(publicDir));
	app.get("/", (_req, res) => {
		res.sendFile(path.join(publicDir, "index.html"));
	});

	// ── API routes ────────────────────────────────────────────────────
	app.use("/api", authRoutes);
	app.use("/api", balanceRoutes);
	app.use("/api", vouchersRoutes);
	app.use("/api", merchantRoutes);
	app.use("/api", keysRoutes);
	app.use("/api", transactionsRoutes);
	app.use("/api", paymentsRoutes);
	app.use("/api", aiRoutes);

	// ── Admin dashboard at /admin ─────────────────────────────────────
	app.use("/", adminRoutes);

	app.use(errorHandler);
}

export default app;
