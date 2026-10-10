import { beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "./db";

vi.stubEnv("DATABASE_FILE", ":memory:");
const { db } = await import("./db");
const inv = await import("./invites");

let n = 0;
const mkUser = (role: User["role"], name = `${role}${++n}`): User => {
  const id = Number(db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, 'x', ?)").run(name, role).lastInsertRowid);
  return { id, username: name, role };
};
const mkEvent = (coordinator: User, id = `ev${++n}`) => {
  db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES (?, ?, 'Op Test', '13204', 'blob', 2)").run(id, coordinator.id);
  return id;
};

let coord: User, otherCoord: User, admin: User, promoter: User, promoter2: User, attendee: User, event: string;
beforeAll(() => {
  coord = mkUser("coordinator");
  otherCoord = mkUser("coordinator");
  admin = mkUser("admin");
  promoter = mkUser("promoter");
  promoter2 = mkUser("promoter");
  attendee = mkUser("attendee");
  event = mkEvent(coord);
});

describe("who may manage an event", () => {
  it("lets its coordinator and any admin, but not another coordinator", () => {
    expect(inv.setPromoterQuota(coord, event, promoter.id, 2)).toEqual({ ok: true });
    expect(inv.setPromoterQuota(admin, event, promoter.id, 2)).toEqual({ ok: true });
    expect(inv.setPromoterQuota(otherCoord, event, promoter.id, 2)).toMatchObject({ ok: false, status: 403 });
    expect(inv.setPromoterQuota(promoter, event, promoter.id, 99)).toMatchObject({ ok: false, status: 403 });
  });
  it("only assigns users who are promoters", () => {
    expect(inv.setPromoterQuota(coord, event, attendee.id, 2)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("minting invites", () => {
  it("enforces a promoter's quota", () => {
    expect(inv.mintInvite(promoter, event, "Sam").ok).toBe(true);
    expect(inv.mintInvite(promoter, event, "Riley").ok).toBe(true);
    expect(inv.mintInvite(promoter, event, "one too many")).toMatchObject({ ok: false, status: 409 });
  });
  it("refuses a promoter who wasn't assigned, and attendees", () => {
    expect(inv.mintInvite(promoter2, event, "")).toMatchObject({ ok: false, status: 403 });
    expect(inv.mintInvite(attendee, event, "")).toMatchObject({ ok: false, status: 403 });
  });
  it("lets the coordinator and admin mint without a quota, but not another coordinator", () => {
    expect(inv.mintInvite(coord, event, "VIP").ok).toBe(true);
    expect(inv.mintInvite(admin, event, "VIP").ok).toBe(true);
    expect(inv.mintInvite(otherCoord, event, "")).toMatchObject({ ok: false, status: 403 });
  });
  it("won't lower a quota below what's already been used", () => {
    expect(inv.setPromoterQuota(coord, event, promoter.id, 1)).toMatchObject({ ok: false, status: 409 });
    expect(inv.setPromoterQuota(coord, event, promoter.id, 5)).toEqual({ ok: true });
  });
});

describe("revoking", () => {
  it("frees a promoter's quota, and only the owner or the coordinator may revoke", () => {
    const e = mkEvent(coord);
    inv.setPromoterQuota(coord, e, promoter.id, 1);
    const a = inv.mintInvite(promoter, e, "") as { ok: true; code: string };
    expect(inv.mintInvite(promoter, e, "")).toMatchObject({ ok: false });
    expect(inv.revokeInvite(promoter2, a.code)).toMatchObject({ ok: false, status: 403 });
    expect(inv.revokeInvite(promoter, a.code)).toEqual({ ok: true });
    expect(inv.mintInvite(promoter, e, "").ok).toBe(true);
  });
});

describe("redeeming", () => {
  it("shows a stranger only the codename and ZIP, and nothing once the invite is used or bogus", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    expect(inv.inviteView(code)).toEqual({ state: "open", eventId: e, codename: "Op Test", zip: "13204" });
    expect(inv.redeemInvite(code, attendee.id).ok).toBe(true);
    expect(inv.inviteView(code)).toEqual({ state: "unavailable" });
    expect(inv.inviteView("nope")).toEqual({ state: "unavailable" });
  });
  it("is single-use even when two people try", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    const a = mkUser("attendee"), b = mkUser("attendee");
    expect(inv.redeemInvite(code, a.id).ok).toBe(true);
    expect(inv.redeemInvite(code, b.id)).toMatchObject({ ok: false, status: 409 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE invite_code = ?").get(code) as { n: number }).n).toBe(1);
  });
  it("gives one ticket per account per event", () => {
    const e = mkEvent(coord);
    const a = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    const b = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    const person = mkUser("attendee");
    expect(inv.redeemInvite(a.code, person.id).ok).toBe(true);
    expect(inv.redeemInvite(b.code, person.id)).toMatchObject({ ok: false, status: 409 });
    expect(inv.inviteView(b.code).state).toBe("open"); // the second invite is not burned
  });
  it("rejects an unknown code", () => {
    expect(inv.redeemInvite("nope", attendee.id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("signing up through an invite", () => {
  it("creates the attendee and the ticket together", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    const r = inv.signUpAndRedeem(code, "New.Person", "hash");
    expect(r.ok).toBe(true);
    const u = db.prepare("SELECT id, role FROM users WHERE username = 'new.person'").get() as { id: number; role: string };
    expect(u.role).toBe("attendee");
    expect(db.prepare("SELECT 1 FROM tickets WHERE user_id = ? AND event_id = ?").get(u.id, e)).toBeTruthy();
  });
  it("creates no account when the invite is already used", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    inv.redeemInvite(code, attendee.id);
    expect(inv.signUpAndRedeem(code, "ghost", "hash")).toMatchObject({ ok: false, status: 409 });
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'ghost'").get()).toBeUndefined();
  });
  it("creates no account when the username is taken, and doesn't burn the invite", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    expect(inv.signUpAndRedeem(code, attendee.username, "hash")).toMatchObject({ ok: false, status: 409 });
    expect(inv.inviteView(code).state).toBe("open");
  });
  it("rolls the new account back if someone else claims the invite in the meantime", () => {
    const e = mkEvent(coord);
    const { code } = inv.mintInvite(coord, e, "") as { ok: true; code: string };
    // Simulate losing the race: the invite looks open when checked, but the claiming UPDATE changes nothing.
    db.exec(`CREATE TRIGGER lose_race BEFORE UPDATE ON invites WHEN OLD.code = '${code}' BEGIN SELECT RAISE(IGNORE); END`);
    try {
      expect(inv.signUpAndRedeem(code, "race-loser", "hash")).toMatchObject({ ok: false, status: 409 });
      expect(db.prepare("SELECT 1 FROM users WHERE username = 'race-loser'").get()).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM tickets WHERE invite_code = ?").get(code)).toBeUndefined();
    } finally {
      db.exec("DROP TRIGGER lose_race");
    }
  });
});
