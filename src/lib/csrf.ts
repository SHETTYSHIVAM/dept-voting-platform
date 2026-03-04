import crypto from "crypto";

export function generateCSRFToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function verifyCSRFToken(cookie?: string, header?: string) {
  if (!cookie || !header) return false;

  const cookieBuf = Buffer.from(cookie);
  const headerBuf = Buffer.from(header);

  // timingSafeEqual REQUIRES buffers to be the same length
  if (cookieBuf.length !== headerBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(cookieBuf, headerBuf);
}