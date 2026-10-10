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
    expect(inv.inviteView(code)).toEqual({ state: "open", eventId: e, codename: "Op Test", zip: "13204", theme: "default" });
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

describe("bulk invites", () => {
  it("creates exactly as many unique single-use invites as asked, in one run", () => {
    const e = mkEvent(coord);
    const r = inv.mintBatch(coord, e, 25, "Flyers") as { ok: true; batch: string; codes: string[] };
    expect(r.ok).toBe(true);
    expect(r.codes).toHaveLength(25);
    expect(new Set(r.codes).size).toBe(25);
    expect((db.prepare("SELECT COUNT(*) AS n FROM invites WHERE batch = ?").get(r.batch) as { n: number }).n).toBe(25);
    for (const code of r.codes) expect(inv.inviteView(code).state).toBe("open");
  });
  it("is all-or-nothing against a promoter's quota", () => {
    const e = mkEvent(coord);
    inv.setPromoterQuota(coord, e, promoter.id, 10);
    expect(inv.mintBatch(promoter, e, 11, "")).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("10 more") });
    expect((db.prepare("SELECT COUNT(*) AS n FROM invites WHERE event_id = ?").get(e) as { n: number }).n).toBe(0); // nothing was created
    expect(inv.mintBatch(promoter, e, 6, "").ok).toBe(true);
    expect(inv.mintBatch(promoter, e, 5, "")).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("4 more") });
    expect(inv.mintBatch(promoter, e, 4, "").ok).toBe(true);
    expect(inv.mintBatch(promoter, e, 1, "")).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("used all 10") });
  });
  it("counts bulk invites toward the quota like any other, and revoking frees them", () => {
    const e = mkEvent(coord);
    inv.setPromoterQuota(coord, e, promoter.id, 3);
    const r = inv.mintBatch(promoter, e, 3, "") as { ok: true; codes: string[] };
    expect(inv.mintInvite(promoter, e, "")).toMatchObject({ ok: false, status: 409 });
    inv.revokeInvite(promoter, r.codes[0]);
    expect(inv.mintInvite(promoter, e, "").ok).toBe(true);
  });
  it("rejects bad sizes, unassigned promoters, attendees and other coordinators", () => {
    const e = mkEvent(coord);
    for (const bad of [0, -1, 1.5, 201, Number.NaN]) expect(inv.mintBatch(coord, e, bad, ""), String(bad)).toMatchObject({ ok: false, status: 400 });
    expect(inv.mintBatch(coord, e, 200, "").ok).toBe(true); // the cap itself is allowed
    expect(inv.mintBatch(promoter2, e, 5, "")).toMatchObject({ ok: false, status: 403 });
    expect(inv.mintBatch(attendee, e, 5, "")).toMatchObject({ ok: false, status: 403 });
    expect(inv.mintBatch(otherCoord, e, 5, "")).toMatchObject({ ok: false, status: 403 });
    expect(inv.mintBatch(admin, e, 5, "").ok).toBe(true);
    expect(inv.mintBatch(coord, "nope", 5, "")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("printing invites", () => {
  it("shows a promoter only their own unused invites, numbered n of N within the run", () => {
    const e = mkEvent(coord);
    inv.setPromoterQuota(coord, e, promoter.id, 20);
    inv.setPromoterQuota(coord, e, promoter2.id, 20);
    const mine = inv.mintBatch(promoter, e, 5, "Mine") as { ok: true; batch: string; codes: string[] };
    inv.mintBatch(promoter2, e, 4, "Theirs");
    const d = inv.printData(promoter, e) as { ok: true; invites: { code: string; n: number; of: number }[] };
    expect(d.invites.map((i) => i.code)).toEqual(mine.codes);
    expect(d.invites.map((i) => `${i.n}/${i.of}`)).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
  });
  it("leaves out used invites but keeps the original numbering on a reprint", () => {
    const e = mkEvent(coord);
    const r = inv.mintBatch(coord, e, 4, "") as { ok: true; batch: string; codes: string[] };
    inv.redeemInvite(r.codes[1], mkUser("attendee").id);
    const d = inv.printData(coord, e, r.batch) as { ok: true; invites: { code: string; n: number; of: number }[] };
    expect(d.invites.map((i) => `${i.n}/${i.of}`)).toEqual(["1/4", "3/4", "4/4"]);
    expect(d.invites.map((i) => i.code)).not.toContain(r.codes[1]);
  });
  it("lets the coordinator and admins see everyone's, filtered by run", () => {
    const e = mkEvent(coord);
    inv.setPromoterQuota(coord, e, promoter.id, 20);
    const a = inv.mintBatch(promoter, e, 3, "") as { ok: true; batch: string };
    const b = inv.mintBatch(coord, e, 2, "") as { ok: true; batch: string };
    expect((inv.printData(coord, e) as { invites: unknown[] }).invites).toHaveLength(5);
    expect((inv.printData(admin, e) as { invites: unknown[] }).invites).toHaveLength(5);
    expect((inv.printData(coord, e, a.batch) as { invites: unknown[] }).invites).toHaveLength(3);
    expect((inv.printData(coord, e, b.batch) as { invites: unknown[] }).invites).toHaveLength(2);
    expect((inv.printData(coord, e, "unknown") as { invites: unknown[] }).invites).toHaveLength(0);
  });
  it("refuses people with no business printing this event's invites", () => {
    const e = mkEvent(coord);
    inv.mintBatch(coord, e, 2, "");
    for (const who of [promoter2, attendee, otherCoord]) expect(inv.printData(who, e), who.username).toMatchObject({ ok: false, status: 403 });
    expect(inv.printData(coord, "nope")).toMatchObject({ ok: false, status: 404 });
  });
  it("carries the event's public face and nothing secret", () => {
    const e = mkEvent(coord);
    inv.mintBatch(coord, e, 1, "");
    const d = inv.printData(coord, e) as { event: Record<string, unknown> };
    expect(Object.keys(d.event).sort()).toEqual(["codename", "id", "theme", "zip"]);
  });
});
