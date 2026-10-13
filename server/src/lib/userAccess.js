import mongoose from "mongoose";
import { User } from "../models/User.js";

export const USER_ROLES = ["admin", "staff", "taquilla"];
export function validUserId(id) {
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id) && mongoose.isValidObjectId(id);
}
export function validateUserPayload(body, creating = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Payload inválido.";
  const allowed = creating ? ["name", "email", "password", "role"] : ["name", "email", "password", "role", "active"];
  if (!Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) return "Campos no permitidos.";
  for (const field of ["name", "email", "password", "role"]) {
    if ((creating || field in body) && typeof body[field] !== "string") return `Campo ${field} inválido.`;
  }
  if ("name" in body && (!body.name.trim() || body.name.trim().length > 150)) return "Nombre obligatorio, máximo 150 caracteres.";
  if ("email" in body && (body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) return "Correo inválido.";
  // Preserve password exactly; bcrypt uses at most 72 bytes.
  if ("password" in body && (body.password.length < 6 || !body.password.trim() || Buffer.byteLength(body.password, "utf8") > 72)) return "Contraseña: mínimo 6 caracteres y máximo 72 bytes.";
  if ("role" in body && !USER_ROLES.includes(body.role)) return "Perfil inválido.";
  if ("active" in body && typeof body.active !== "boolean") return "Estado inválido.";
  return null;
}

// Deliberately a normal-operation guard, NOT a concurrency guarantee.
export async function accessChangeError(actor, target, changes, deleting = false) {
  const reducing = deleting || changes.active === false || (changes.role !== undefined && changes.role !== "admin");
  if (String(actor._id) === String(target._id) && reducing) return "No puedes suspender, eliminar o degradar tu propia cuenta.";
  if (target.role === "admin" && target.active && reducing) {
    const remaining = await User.countDocuments({ role: "admin", active: true, deletedAt: null, _id: { $ne: target._id } });
    if (!remaining) return "Debe permanecer al menos un Administrador activo.";
  }
  return null;
}
