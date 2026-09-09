import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM helpers for the Care Circle document vault.
 *
 * The encryption key is held server-side only as VAULT_KEY_HEX (64 hex
 * chars / 32 bytes). It is never sent to the browser. Plaintext bytes
 * pass through these helpers exactly once: client uploads to
 * /api/vault/upload, the route encrypts and stores ciphertext in the
 * private storage bucket, and the matching download route reverses it.
 *
 * Layout on disk: ciphertext || 16-byte GCM auth tag. The IV is stored
 * separately on the vault_files row (base64). Both are required to
 * decrypt; losing either makes the object permanently unrecoverable.
 */

const KEY_HEX = (process.env.VAULT_KEY_HEX || "").trim();

function getKey(): Buffer {
  if (!KEY_HEX) {
    throw new Error("VAULT_KEY_HEX is not configured");
  }
  if (KEY_HEX.length !== 64 || !/^[0-9a-fA-F]+$/.test(KEY_HEX)) {
    throw new Error("VAULT_KEY_HEX must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(KEY_HEX, "hex");
}

export interface EncryptedBlob {
  ivBase64: string;
  ciphertext: Buffer;
}

export function encryptGCM(plaintext: Buffer): EncryptedBlob {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ivBase64: iv.toString("base64"),
    ciphertext: Buffer.concat([encrypted, tag]),
  };
}

export function decryptGCM(ciphertext: Buffer, ivBase64: string): Buffer {
  const key = getKey();
  const iv = Buffer.from(ivBase64, "base64");
  if (iv.length !== 12) throw new Error("invalid IV length");
  if (ciphertext.length < 16) throw new Error("ciphertext too short");
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const ct = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
