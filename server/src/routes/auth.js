import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { signAuthToken } from "../lib/auth.js";

export function authRoutes({ jwtSecret }) {
  const router = Router();

  router.post("/login", async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "email y password son requeridos." });
    }

    const user = await User.findOne({ email, active: true });
    if (!user) return res.status(401).json({ error: "Credenciales invalidas." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Credenciales invalidas." });

    const token = signAuthToken(user, jwtSecret);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  });

  return router;
}
