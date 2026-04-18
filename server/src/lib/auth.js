import jwt from "jsonwebtoken";

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
  return (req, res, next) => {
    const raw = req.header("authorization") || "";
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Token requerido." });
    try {
      req.auth = jwt.verify(token, jwtSecret);
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
