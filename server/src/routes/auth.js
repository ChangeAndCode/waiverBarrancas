import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { signAuthToken, requireAuth } from "../lib/auth.js";

export function authRoutes({ jwtSecret }) {
  const router = Router();

  router.post("/login", async (req, res, next) => {
    try {
      if (typeof req.body?.email !== "string" || typeof req.body?.password !== "string") return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
      const email = req.body.email.toLowerCase().trim();
      const password = String(req.body?.password || "");

      if (!email || !password) {
        return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
      }

      const user = await User.findOne({ email, active: true, deletedAt: null });
      if (!user) return res.status(401).json({ error: "Credenciales inválidas." });

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: "Credenciales inválidas." });

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
    } catch (error) { next(error); }
  });

  router.get("/me", requireAuth(jwtSecret), (req, res) => {
    res.json({ id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role });
  });

  return router;
}
