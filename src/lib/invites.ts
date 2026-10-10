import { randomBytes } from "node:crypto";
import { db, type User } from "./db";

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

type EventRow = { id: string; coordinator_id: number };
const getEvent = (id: string) => db.prepare("SELECT id, coordinator_id FROM events WHERE id = ?").get(id) as EventRow | undefined;

/** Admins manage every event; a coordinator manages only the events they created. */
export function canManageEvent(user: User, event: EventRow): boolean {
  return user.role === "admin" || (user.role === "coordinator" && event.coordinator_id === user.id);
}

export function quotaFor(eventId: string, promoterId: number): { quota: number; used: number } {
  const quota =
    (db.prepare("SELECT quota FROM event_promoters WHERE event_id = ? AND promoter_id = ?").get(eventId, promoterId) as
      | { quota: number }
      | undefined)?.quota ?? 0;
  const used = (db.prepare("SELECT COUNT(*) AS n FROM invites WHERE event_id = ? AND created_by = ?").get(eventId, promoterId) as { n: number }).n;
  return { quota, used };
}

export function setPromoterQuota(actor: User, eventId: string, promoterId: number, quota: number): { ok: true } | Fail {
  const event = getEvent(eventId);
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) return fail(403, "Only the event's coordinator or an admin can do that.");
  const promoter = db.prepare("SELECT role FROM users WHERE id = ?").get(promoterId) as { role: string } | undefined;
  if (promoter?.role !== "promoter") return fail(400, "That user isn't a promoter.");
  if (quota <= 0) {
    // Removing a promoter doesn't delete invites they already sent; it just stops new ones.
    db.prepare("DELETE FROM event_promoters WHERE event_id = ? AND promoter_id = ?").run(eventId, promoterId);
    return { ok: true };
  }
  const { used } = quotaFor(eventId, promoterId);
  if (quota < used) return fail(409, `They have already created ${used} invites, so the quota can't go below ${used}.`);
  db.prepare(
    "INSERT INTO event_promoters (event_id, promoter_id, quota) VALUES (?, ?, ?) ON CONFLICT (event_id, promoter_id) DO UPDATE SET quota = excluded.quota",
  ).run(eventId, promoterId, quota);
  return { ok: true };
}

/** Who may mint: the event's coordinator, any admin, or a promoter assigned to it with quota left. */
export function mintInvite(actor: User, eventId: string, note: string): { ok: true; code: string } | Fail {
  const event = getEvent(eventId);
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) {
    if (actor.role !== "promoter") return fail(403, "Your role can't create invites.");
    const { quota, used } = quotaFor(eventId, actor.id);
    if (quota === 0) return fail(403, "You haven't been assigned to promote this event.");
    if (used >= quota) return fail(409, `You've used all ${quota} of your invites for this event.`);
  }
  const code = randomBytes(9).toString("base64url");
  db.prepare("INSERT INTO invites (code, event_id, created_by, note) VALUES (?, ?, ?, ?)").run(code, eventId, actor.id, note.trim());
  return { ok: true, code };
}

/** Revoke an unused invite. The coordinator/admin can revoke any; a promoter only their own. */
export function revokeInvite(actor: User, code: string): { ok: true } | Fail {
  const inv = db
    .prepare("SELECT i.created_by, i.redeemed_by, e.id AS event_id, e.coordinator_id FROM invites i JOIN events e ON e.id = i.event_id WHERE i.code = ?")
    .get(code) as { created_by: number; redeemed_by: number | null; event_id: string; coordinator_id: number } | undefined;
  if (!inv) return fail(404, "No such invite.");
  if (inv.redeemed_by !== null) return fail(409, "That invite has already been used.");
  const allowed = canManageEvent(actor, { id: inv.event_id, coordinator_id: inv.coordinator_id }) || inv.created_by === actor.id;
  if (!allowed) return fail(403, "You can only revoke invites you created.");
  db.prepare("DELETE FROM invites WHERE code = ? AND redeemed_by IS NULL").run(code);
  return { ok: true };
}

export type InviteView = { state: "open"; eventId: string; codename: string; zip: string } | { state: "unavailable" };

/** What an invite link may show a stranger. A used or unknown code reveals nothing about any event. */
export function inviteView(code: string): InviteView {
  const row = db
    .prepare("SELECT e.id AS eventId, e.codename, e.zip FROM invites i JOIN events e ON e.id = i.event_id WHERE i.code = ? AND i.redeemed_by IS NULL")
    .get(code) as { eventId: string; codename: string; zip: string } | undefined;
  return row ? { state: "open", ...row } : { state: "unavailable" };
}

const ticketSerial = () => randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/, "$1-");

/**
 * Turn an open invite into a ticket for `userId`. The UPDATE ... WHERE redeemed_by IS NULL is the real
 * lock: if two people open the same link at once, exactly one UPDATE changes a row.
 */
export function redeemInvite(code: string, userId: number): { ok: true; ticketId: string; eventId: string } | Fail {
  return db.transaction((): { ok: true; ticketId: string; eventId: string } | Fail => {
    const inv = db.prepare("SELECT event_id FROM invites WHERE code = ?").get(code) as { event_id: string } | undefined;
    if (!inv) return fail(404, "This invite isn't valid.");
    const already = db.prepare("SELECT id FROM tickets WHERE event_id = ? AND user_id = ?").get(inv.event_id, userId);
    if (already) return fail(409, "You already have a ticket for this event.");
    const claimed = db
      .prepare("UPDATE invites SET redeemed_by = ?, redeemed_at = unixepoch() WHERE code = ? AND redeemed_by IS NULL")
      .run(userId, code);
    if (claimed.changes !== 1) return fail(409, "This invite has already been used.");
    const ticketId = ticketSerial();
    db.prepare("INSERT INTO tickets (id, event_id, user_id, invite_code) VALUES (?, ?, ?, ?)").run(ticketId, inv.event_id, userId, code);
    return { ok: true, ticketId, eventId: inv.event_id };
  })();
}

/** Create an attendee account and redeem in one step; if the invite is bad, no account is created. */
export function signUpAndRedeem(code: string, username: string, passHash: string): { ok: true; userId: number; ticketId: string } | Fail {
  try {
    return db.transaction((): { ok: true; userId: number; ticketId: string } | Fail => {
      if (inviteView(code).state !== "open") return fail(409, "This invite has already been used or isn't valid.");
      let userId: number;
      try {
        userId = Number(db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, ?, 'attendee')").run(username.toLowerCase(), passHash).lastInsertRowid);
      } catch (e) {
        if (e instanceof Error && e.message.includes("UNIQUE")) return fail(409, "That username is taken.");
        throw e;
      }
      const r = redeemInvite(code, userId);
      // Throwing is how a better-sqlite3 transaction rolls back, so the new account disappears too.
      if (!r.ok) throw Object.assign(new Error(r.error), { fail: r });
      return { ok: true, userId, ticketId: r.ticketId };
    })();
  } catch (e) {
    if (e instanceof Error && "fail" in e) return (e as Error & { fail: Fail }).fail;
    throw e;
  }
}
