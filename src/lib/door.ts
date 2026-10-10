import { randomBytes } from "node:crypto";
import { Group } from "@semaphore-protocol/group";
import { verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { z } from "zod";
import { db, type User } from "./db";
import { canManageEvent, type Fail } from "./invites";
import { isChallenge, messageFor, scopeFor, SNARK_FIELD } from "./zk-shared";

const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const CHALLENGE_SECONDS = 120;

const num = z.string().regex(/^\d{1,80}$/);
export const ProofSchema = z.object({
  merkleTreeDepth: z.number().int().min(1).max(32),
  merkleTreeRoot: num,
  nullifier: num,
  message: num,
  scope: num,
  points: z.tuple([num, num, num, num, num, num, num, num]),
});

type EventRow = { id: string; coordinator_id: number };
const getEvent = (id: string) => db.prepare("SELECT id, coordinator_id FROM events WHERE id = ?").get(id) as EventRow | undefined;

/** Public commitments in registration order. The order defines the Merkle tree, so it must be stable. */
export const groupCommitments = (eventId: string): string[] =>
  (db.prepare("SELECT commitment FROM door_passes WHERE event_id = ? ORDER BY rowid").all(eventId) as { commitment: string }[]).map((r) => r.commitment);

/** A ticket holder asks for the guest list so their phone can build the Merkle proof. Strangers can't. */
export function guestListFor(userId: number, eventId: string): { ok: true; commitments: string[] } | Fail {
  const ticket = db.prepare("SELECT 1 FROM tickets WHERE event_id = ? AND user_id = ?").get(eventId, userId);
  if (!ticket) return fail(403, "You don't have a ticket for this event.");
  return { ok: true, commitments: groupCommitments(eventId) };
}

export function passStatus(userId: number, eventId: string): { hasTicket: boolean; hasPass: boolean } {
  const t = db.prepare("SELECT id FROM tickets WHERE event_id = ? AND user_id = ?").get(eventId, userId) as { id: string } | undefined;
  if (!t) return { hasTicket: false, hasPass: false };
  return { hasTicket: true, hasPass: !!db.prepare("SELECT 1 FROM door_passes WHERE ticket_id = ?").get(t.id) };
}

/** Register the PUBLIC half of a phone-made identity against the caller's ticket. */
export function registerPass(userId: number, eventId: string, commitment: string): { ok: true } | Fail {
  if (!/^\d{1,78}$/.test(commitment) || BigInt(commitment) >= SNARK_FIELD || BigInt(commitment) === 0n) {
    return fail(400, "That isn't a valid pass.");
  }
  const ticket = db.prepare("SELECT id FROM tickets WHERE event_id = ? AND user_id = ?").get(eventId, userId) as { id: string } | undefined;
  if (!ticket) return fail(403, "You don't have a ticket for this event.");
  if (db.prepare("SELECT 1 FROM door_passes WHERE ticket_id = ?").get(ticket.id)) {
    return fail(409, "This ticket already has a door pass. If you set it up on another phone or browser, use that one.");
  }
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO door_passes (ticket_id, event_id, commitment) VALUES (?, ?, ?)").run(ticket.id, eventId, commitment);
      const members = groupCommitments(eventId);
      const root = new Group(members.map(BigInt)).root.toString();
      db.prepare("INSERT OR IGNORE INTO group_roots (event_id, root, size) VALUES (?, ?, ?)").run(eventId, root, members.length);
    })();
  } catch (e) {
    if (e instanceof Error && e.message.includes("UNIQUE")) return fail(409, "That pass is already registered.");
    throw e;
  }
  return { ok: true };
}

export function createChallenge(actor: User, eventId: string): { ok: true; challenge: string; expiresAt: number } | Fail {
  const event = getEvent(eventId);
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) return fail(403, "Only the event's coordinator or an admin can run the door.");
  db.prepare("DELETE FROM door_challenges WHERE event_id = ? AND expires_at < unixepoch() - 300").run(eventId);
  const challenge = randomBytes(16).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
  db.prepare("INSERT INTO door_challenges (id, event_id, expires_at) VALUES (?, ?, ?)").run(challenge, eventId, expiresAt);
  return { ok: true, challenge, expiresAt };
}

export type DoorStatus = {
  state: "pending" | "admitted" | "expired";
  lastError: string | null;
  admitted: number;
  tickets: number;
  passes: number;
};

export function doorStatus(actor: User, eventId: string, challenge: string): { ok: true; status: DoorStatus } | Fail {
  const event = getEvent(eventId);
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) return fail(403, "Only the event's coordinator or an admin can run the door.");
  const row = db.prepare("SELECT state, expires_at, last_error FROM door_challenges WHERE id = ? AND event_id = ?").get(challenge, eventId) as
    | { state: "pending" | "admitted"; expires_at: number; last_error: string | null }
    | undefined;
  if (!row) return fail(404, "Unknown door code.");
  const count = (sql: string) => (db.prepare(sql).get(eventId) as { n: number }).n;
  const expired = row.state === "pending" && row.expires_at <= Math.floor(Date.now() / 1000);
  return {
    ok: true,
    status: {
      state: expired ? "expired" : row.state,
      lastError: row.last_error,
      admitted: count("SELECT COUNT(*) AS n FROM checkins WHERE event_id = ?"),
      tickets: count("SELECT COUNT(*) AS n FROM tickets WHERE event_id = ?"),
      passes: count("SELECT COUNT(*) AS n FROM door_passes WHERE event_id = ?"),
    },
  };
}

const note = (challenge: string, message: string) => db.prepare("UPDATE door_challenges SET last_error = ? WHERE id = ? AND state = 'pending'").run(message, challenge);

/**
 * Check a guest in. Only a valid, new admission uses up the door code: a junk proof or a repeat must not,
 * or anyone who can see the door screen could jam the line by scanning it.
 */
export async function verifyCheckin(eventId: string, challenge: string, proofInput: unknown): Promise<{ ok: true } | Fail> {
  if (!isChallenge(challenge)) return fail(400, "That isn't a door code.");
  const row = db.prepare("SELECT state, expires_at FROM door_challenges WHERE id = ? AND event_id = ?").get(challenge, eventId) as
    | { state: string; expires_at: number }
    | undefined;
  if (!row) return fail(404, "Unknown door code. Scan the screen again.");
  if (row.state !== "pending") return fail(409, "That door code was already used. Scan the screen again.");
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return fail(410, "That door code expired. Scan the screen again.");

  const bad = (status: number, why: string): Fail => {
    note(challenge, why);
    return fail(status, why);
  };

  const parsed = ProofSchema.safeParse(proofInput);
  if (!parsed.success) return bad(400, "That pass is malformed.");
  const proof = parsed.data as SemaphoreProof;

  // The proof must be about THIS event and THIS door code, or it could be replayed from somewhere else.
  if (proof.scope !== scopeFor(eventId).toString()) return bad(400, "That pass is for a different event.");
  if (proof.message !== messageFor(challenge).toString()) return bad(400, "That pass was made for a different door code.");

  // The root must be one this event's guest list actually had. Otherwise anyone could prove membership in a list they made up.
  if (!db.prepare("SELECT 1 FROM group_roots WHERE event_id = ? AND root = ?").get(eventId, proof.merkleTreeRoot)) {
    return bad(403, "That pass isn't on this event's guest list.");
  }

  let valid = false;
  try {
    valid = await verifyProof(proof);
  } catch {
    valid = false;
  }
  if (!valid) return bad(403, "That pass didn't check out.");

  try {
    db.transaction(() => {
      const claimed = db.prepare("UPDATE door_challenges SET state = 'admitted', last_error = NULL WHERE id = ? AND state = 'pending'").run(challenge);
      if (claimed.changes !== 1) throw Object.assign(new Error("used"), { fail: fail(409, "That door code was already used. Scan the screen again.") });
      // The PRIMARY KEY (event_id, nullifier) is what stops the same pass being used twice.
      db.prepare("INSERT INTO checkins (event_id, nullifier) VALUES (?, ?)").run(eventId, proof.nullifier);
    })();
  } catch (e) {
    if (e instanceof Error && "fail" in e) return (e as Error & { fail: Fail }).fail;
    if (e instanceof Error && e.message.includes("UNIQUE")) return bad(409, "Already checked in.");
    throw e;
  }
  return { ok: true };
}
