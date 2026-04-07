import jwt from "jsonwebtoken";

const EXPIRATION_DAYS = 3650;

export function signWaiverToken(waiverId, secret) {
  return jwt.sign({ waiverId }, secret, { expiresIn: `${EXPIRATION_DAYS}d` });
}

export function verifyWaiverToken(token, secret) {
  return jwt.verify(token, secret);
}
