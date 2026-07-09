import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Stream keys are secrets equivalent to a password for the destination
// channel — encrypt at rest so a leaked DB file/backup doesn't hand out
// live RTMP keys. The env var can be any passphrase; we hash it down to
// a stable 32-byte key rather than requiring exact hex/base64 input.
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const passphrase = process.env.ENCRYPTION_KEY;
  if (!passphrase) {
    throw new Error("ENCRYPTION_KEY must be set to store destination stream keys");
  }
  return createHash("sha256").update(passphrase).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, authTagB64, dataB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
