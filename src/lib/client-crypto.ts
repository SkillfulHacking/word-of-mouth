// Runs in the browser (and in Node >= 20 for tests): WebCrypto + Shamir only.
import { combine } from "shamir-secret-sharing";

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type EventDetails = {
  title: string;
  startsAt: string;
  venue: string;
  address: string;
  notes: string;
};

/** blob = base64url(iv[12] || ciphertext || gcmTag[16]); shares are base64url Shamir shares. */
export async function unlockDetails(blob: string, shares: string[]): Promise<EventDetails> {
  const decoded = shares.map(b64uDecode);
  // A 32-byte code is the raw key (threshold 1). Shamir shares are 33 bytes: 32 of data plus the x coordinate.
  const key = decoded.some((d) => d.length === 32) ? decoded.find((d) => d.length === 32)! : await combine(decoded);
  const raw = b64uDecode(blob);
  const aes = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, aes, raw.slice(12));
  return JSON.parse(new TextDecoder().decode(plain)) as EventDetails;
}
