import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

export function signAuthToken(user, jwtSecret) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
      name: user.name
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

export function requireAuth(jwtSecret) {
  return async (req, res, next) => {
    const raw = req.header("authorization") || "";
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Token requerido." });
    try {
      const claims = jwt.verify(token, jwtSecret);
      const userId = String(claims.sub || "").trim();
      if (!userId) {
        return res.status(401).json({ error: "Token inválido." });
      }

      const user = await User.findOne({ _id: userId, active: true })
        .select("name email role active")
        .lean();

      if (!user) {
        return res.status(401).json({ error: "Usuario inactivo o no encontrado." });
      }

      // El rol y el estado actuales de MongoDB son la autoridad real;
      // no se confía en los valores antiguos almacenados en el JWT.
      req.auth = {
        ...claims,
        sub: user._id.toString(),
        role: user.role,
        email: user.email,
        name: user.name
      };
      req.user = user;
      return next();
    } catch (_error) {
      return res.status(401).json({ error: "Token inválido." });
    }
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "No autorizado." });
    }
    return next();
  };
}

// Permisos de negocio centralizados. La autorización siempre se aplica en el
// backend; el frontend únicamente refleja estos permisos en la interfaz.
export const ROLE_PERMISSIONS = Object.freeze({
  staff: Object.freeze([
    "auth.login",
    "waiver.scan",
    "waiver.read.scanned",
    "waiver.review",
    "waiver.comment",
    "waiver.schedule.assign",
    "waiver.ticket.print"
  ]),
  admin: Object.freeze([
    "auth.login",
    "waiver.scan",
    "waiver.read.scanned",
    "waiver.review",
    "waiver.comment",
    "waiver.schedule.assign",
    "waiver.ticket.print",
    "waiver.history.read",
    "waiver.export",
    "waiver.delete",
    "users.manage",
    "settings.manage",
    "admin.panel"
  ])
});

export function requirePermissions(...permissions) {
  return (req, res, next) => {
    const granted = ROLE_PERMISSIONS[req.user?.role] || [];
    const allowed = permissions.every((permission) => granted.includes(permission));
    if (!allowed) return res.status(403).json({ error: "No autorizado." });
    return next();
  };
}
