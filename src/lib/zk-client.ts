// Browser-only. Import this lazily (await import(...)) so the heavy proof code loads only when needed.
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import { messageFor, scopeFor, ZK_BASE } from "./zk-shared";

const storageKey = (eventId: string) => `wom:pass:${eventId}`;

export const newIdentity = () => new Identity();

/** The identity (including its secret) lives only in this browser's storage. One per event, so events can't be linked. */
export function loadIdentity(eventId: string): Identity | null {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    return raw ? Identity.import(raw) : null;
  } catch {
    return null;
  }
}

/** Throws if storage is unavailable (e.g. a private window), so callers can stop before registering a pass they'd lose. */
export function saveIdentity(eventId: string, identity: Identity): void {
  localStorage.setItem(storageKey(eventId), identity.export());
  if (localStorage.getItem(storageKey(eventId)) === null) throw new Error("storage unavailable");
}

export function forgetIdentity(eventId: string): void {
  try {
    localStorage.removeItem(storageKey(eventId));
  } catch {
    /* nothing to forget */
  }
}

/** Semaphore picks the circuit by tree depth; a tree always has depth >= 1 here. */
export const depthFor = (commitments: string[]) => Math.max(1, new Group(commitments.map(BigInt)).depth);

export const artifactUrls = (depth: number) => ({
  wasm: `${ZK_BASE}/semaphore-${depth}.wasm`,
  zkey: `${ZK_BASE}/semaphore-${depth}.zkey`,
});

/** Warm the browser cache so the proof at the door doesn't wait on a ~4 MB download. */
export async function prefetchCircuit(depth: number): Promise<void> {
  const { wasm, zkey } = artifactUrls(depth);
  await Promise.all([fetch(wasm), fetch(zkey)]).catch(() => undefined);
}

export async function makeProof(identity: Identity, commitments: string[], eventId: string, challenge: string) {
  const group = new Group(commitments.map(BigInt));
  const depth = Math.max(1, group.depth);
  return generateProof(identity, group, messageFor(challenge), scopeFor(eventId), depth, artifactUrls(depth));
}
