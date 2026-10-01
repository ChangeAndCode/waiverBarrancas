import jwt from "jsonwebtoken";

export function signWaiverToken(waiverId, secret) {
  // Business validity is evaluated from the waiver on every lookup: Staff assigns
  // the visit time later. A fixed JWT expiry could invalidate a pending visit early.
  return jwt.sign({ waiverId }, secret);
}

export function verifyWaiverToken(token, secret) {
  return jwt.verify(token, secret);
}
