import { createCipheriv, randomBytes } from "node:crypto";
import { split } from "shamir-secret-sharing";
import type { EventDetails } from "./client-crypto";

export type Sealed = {
  /** Safe to store: base64url(iv || ciphertext || tag). */
  blob: string;
  /** One per spot, base64url. Show once, then forget; the server keeps none of these. */
  shares: string[];
};

/**
 * Encrypt event details under a fresh random key, then split that key into
 * `count` Shamir shares so that any `threshold` of them recover it. The key
 * itself is never returned or stored.
 *
 * Shamir sharing needs a threshold of at least 2. When a single code should be enough (threshold 1),
 * every code carries the 32-byte key itself: there is nothing to split, so any one code opens the event.
 */
export async function sealDetails(details: EventDetails, count: number, threshold: number): Promise<Sealed> {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  const blob = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
  if (threshold === 1) {
    const only = Buffer.from(key).toString("base64url");
    key.fill(0);
    return { blob, shares: Array.from({ length: count }, () => only) };
  }
  // The library checks `instanceof Uint8Array`, which a Node Buffer can fail across realms.
  const shares = (await split(Uint8Array.from(key), count, threshold)).map((s) =>
    Buffer.from(s).toString("base64url"),
  );
  key.fill(0);
  return { blob, shares };
}
