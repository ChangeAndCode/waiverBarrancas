import { Router } from "express";
import bcrypt from "bcryptjs";
import { Attraction } from "../models/Attraction.js";
import { Waiver } from "../models/Waiver.js";
import { User } from "../models/User.js";
import { requireAuth, requireRoles } from "../lib/auth.js";

export function adminRoutes({ jwtSecret }) {
  const router = Router();

  router.use(requireAuth(jwtSecret), requireRoles("admin"));

  router.get("/attractions", async (_req, res) => {
    const items = await Attraction.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  });

  router.post("/attractions", async (req, res) => {
    const { name, code, description, waiverText, active = true } = req.body ?? {};
    if (!name || !code) return res.status(400).json({ error: "name y code son requeridos." });

    const created = await Attraction.create({
      name,
      code: String(code).toUpperCase(),
      description: description ?? "",
      waiverText,
      active
    });
    res.status(201).json(created);
  });

  router.patch("/attractions/:id", async (req, res) => {
    const payload = { ...req.body };
    if (payload.code) payload.code = String(payload.code).toUpperCase();
    const updated = await Attraction.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Atraccion no encontrada." });
    res.json(updated);
  });

  router.get("/waivers", async (req, res) => {
    const query = {};
    if (req.query.attractionId) query.attractionId = req.query.attractionId;
    const waivers = await Waiver.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json(waivers);
  });

  router.patch("/waivers/:id/revoke", async (req, res) => {
    const updated = await Waiver.findByIdAndUpdate(
      req.params.id,
      { status: "revoked" },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Waiver no encontrado." });
    res.json(updated);
  });

  router.get("/users", async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 }).select("-passwordHash").lean();
    res.json(users);
  });

  router.post("/users", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    const role = req.body?.role;

    if (!name || !email || !password || !["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Datos de usuario invalidos." });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: "Email ya registrado." });

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.create({ name, email, passwordHash, role, active: true });
    res.status(201).json({
      id: created._id,
      name: created.name,
      email: created.email,
      role: created.role,
      active: created.active
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const payload = {};
    if (typeof req.body?.name === "string") payload.name = req.body.name.trim();
    if (typeof req.body?.active === "boolean") payload.active = req.body.active;
    if (typeof req.body?.role === "string" && ["admin", "staff"].includes(req.body.role)) {
      payload.role = req.body.role;
    }
    if (typeof req.body?.password === "string" && req.body.password.length >= 6) {
      payload.passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, payload, { new: true })
      .select("-passwordHash")
      .lean();
    if (!updated) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(updated);
  });

  return router;
}
