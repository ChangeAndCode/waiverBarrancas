import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { Attraction } from "./models/Attraction.js";
import { User } from "./models/User.js";
import { defaultWaiverTextMx2026 } from "./lib/waiverText.js";
import { ensureParkAttractions } from "./lib/parkAttractions.js";
import { publicRoutes } from "./routes/public.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { reportRoutes } from "./routes/reports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "server/.env"),
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const app = express();
const port = process.env.PORT || 4000;
const mongoUri =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/waiver-app";
const jwtSecret = process.env.JWT_SECRET || "change-me-now";
const superAdminEmail = String(
  process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@waiver.local"
).toLowerCase();
const superAdminPassword = String(
  process.env.SUPERADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "Admin12345"
);
const clientDistPath = path.resolve(__dirname, "../../client/dist");
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

const corsConfig = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error("CORS origin no permitido."));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
};

app.use(cors(corsConfig));
app.options("*", cors(corsConfig));
app.use(express.json({ limit: "12mb" }));
app.use("/branding", express.static(path.resolve(__dirname)));

const latencyTrackedRoutes = new Set([
  "POST /api/public/waivers",
  "POST /api/public/create-checkout-session",
  "GET /api/reports/validate/:token"
]);

function latencyRouteKey(req) {
  if (req.method === "GET" && /^\/api\/reports\/validate\/[^/]+$/.test(req.path)) {
    return "GET /api/reports/validate/:token";
  }
  return `${req.method} ${req.path}`;
}

app.use((req, res, next) => {
  const routeKey = latencyRouteKey(req);
  if (!latencyTrackedRoutes.has(routeKey)) return next();

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `[latency] route="${routeKey}" status=${res.statusCode} ms=${elapsedMs.toFixed(1)}`
    );
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/public", publicRoutes({ jwtSecret }));
app.use("/api/auth", authRoutes({ jwtSecret }));
app.use("/api/admin", adminRoutes({ jwtSecret }));
app.use("/api/reports", reportRoutes({ jwtSecret }));

app.use(express.static(clientDistPath));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});

await mongoose.connect(mongoUri);
await ensureParkAttractions(Attraction, defaultWaiverTextMx2026);

const superAdmin = await User.findOne({ email: superAdminEmail });
if (!superAdmin) {
  const passwordHash = await bcrypt.hash(superAdminPassword, 10);
  await User.create({
    name: "Superadministrador",
    email: superAdminEmail,
    passwordHash,
    role: "admin",
    active: true
  });
  console.log(`Superadmin seed creado: ${superAdminEmail}`);
}

app.listen(port, () => {
  console.log(`API en http://localhost:${port}`);
});
