import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for connector secrets at rest. Ciphertext is stored as
 * `v1.<iv>.<tag>.<payload>`, all base64url, so the format can be versioned
 * without a migration.
 */

const VERSION = "v1";

function key() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set — generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error(`APP_ENCRYPTION_KEY must decode to 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const payload = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    payload.toString("base64url"),
  ].join(".");
}

export function decryptSecret(cipherText: string): string {
  const [version, iv, tag, payload] = cipherText.split(".");
  if (version !== VERSION || !iv || !tag || !payload) {
    throw new Error("Stored secret is not in the expected v1 format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a key is configured, so callers can degrade instead of throwing. */
export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
