// Used by both the phone and the server, so they always agree on what a proof is "about".
// Semaphore hashes the message and scope itself, so these only need to be unique numbers.

/** Where the browser loads circuit files from (copied here by `pnpm fetch-zk`; no third-party CDN). */
export const ZK_BASE = "/zk/semaphore-4.13.0";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Nullifiers are per scope: one person gets one nullifier per event, and different ones at different events. */
export const scopeFor = (eventId: string): bigint => BigInt("0x" + hex(new TextEncoder().encode(`wom:${eventId}`)));

/** The one-time door code is 32 hex characters (128 bits). */
export const messageFor = (challenge: string): bigint => BigInt("0x" + challenge);

export const isChallenge = (c: string) => /^[0-9a-f]{32}$/.test(c);

// The BN254 scalar field. A commitment must be a number below this.
export const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
