import express from "express";
import { getDB } from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.get("/keys/users", authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== "merchant") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const db = getDB();
    const users = await db
      .collection("users")
      .find({ publicKeyHex: { $exists: true, $ne: null } }, {
        projection: { userId: 1, publicKeyHex: 1, registeredAt: 1, createdAt: 1 },
      })
      .toArray();

    const keys = users
      .filter((u) => u && u.publicKeyHex)
      .map((u) => ({
        userId: u.userId,
        publicKeyHex: u.publicKeyHex,
        registeredAt: u.registeredAt || u.createdAt || null,
      }));

    return res.json({ success: true, count: keys.length, keys });
  } catch (error) {
    console.error("Get user keys error:", error);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
