import path from "node:path";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "./db";
import { messageFor, scopeFor } from "./zk-shared";

vi.stubEnv("DATABASE_FILE", ":memory:");
const { db } = await import("./db");
const inv = await import("./invites");
const door = await import("./door");

const dir = path.join(process.cwd(), "public", "zk", "semaphore-4.13.0");
const artifacts = (d: number) => ({ wasm: path.join(dir, `semaphore-${d}.wasm`), zkey: path.join(dir, `semaphore-${d}.zkey`) });

let n = 0;
const mkUser = (role: User["role"]): User => {
  const name = `${role}${++n}`;
  const id = Number(db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, 'x', ?)").run(name, role).lastInsertRowid);
  return { id, username: name, role };
};
const mkEvent = (coord: User) => {
  const id = `ev${++n}`;
  db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES (?, ?, 'Op', '13204', 'b', 2)").run(id, coord.id);
  return id;
};
/** A guest with a ticket (through the real invite flow) and a phone-side identity. */
const mkGuest = (coord: User, eventId: string) => {
  const user = mkUser("attendee");
  const { code } = inv.mintInvite(coord, eventId, "") as { ok: true; code: string };
  expect(inv.redeemInvite(code, user.id).ok).toBe(true);
  return { user, identity: new Identity() };
};
const prove = (identity: Identity, members: string[], eventId: string, challenge: string, scopeEvent = eventId) => {
  const group = new Group(members.map(BigInt));
  const depth = Math.max(1, group.depth);
  return generateProof(identity, group, messageFor(challenge), scopeFor(scopeEvent), depth, artifacts(depth));
};
const challengeFor = (coord: User, eventId: string) => (door.createChallenge(coord, eventId) as { ok: true; challenge: string }).challenge;

let coord: User, otherCoord: User, admin: User;
beforeAll(() => {
  coord = mkUser("coordinator");
  otherCoord = mkUser("coordinator");
  admin = mkUser("admin");
});

describe("registering a door pass", () => {
  it("needs a ticket, and takes only the public commitment", () => {
    const e = mkEvent(coord);
    const stranger = mkUser("attendee");
    const id = new Identity();
    expect(door.registerPass(stranger.id, e, id.commitment.toString())).toMatchObject({ ok: false, status: 403 });
    const g = mkGuest(coord, e);
    expect(door.registerPass(g.user.id, e, g.identity.commitment.toString())).toEqual({ ok: true });
    expect(door.groupCommitments(e)).toEqual([g.identity.commitment.toString()]);
    // Nothing the server stores contains the identity's secret.
    const dump = JSON.stringify(db.prepare("SELECT * FROM door_passes").all());
    expect(dump).not.toContain(g.identity.secretScalar.toString());
  });
  it("allows one pass per ticket and one ticket per commitment", () => {
    const e = mkEvent(coord);
    const a = mkGuest(coord, e), b = mkGuest(coord, e);
    expect(door.registerPass(a.user.id, e, a.identity.commitment.toString()).ok).toBe(true);
    expect(door.registerPass(a.user.id, e, new Identity().commitment.toString())).toMatchObject({ ok: false, status: 409 });
    expect(door.registerPass(b.user.id, e, a.identity.commitment.toString())).toMatchObject({ ok: false, status: 409 });
  });
  it("rejects values that aren't valid commitments", () => {
    const e = mkEvent(coord);
    const g = mkGuest(coord, e);
    for (const bad of ["0", "abc", "-5", "", "9".repeat(90), (2n ** 256n).toString()]) {
      expect(door.registerPass(g.user.id, e, bad)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it("only shows the guest list to ticket holders", () => {
    const e = mkEvent(coord);
    const g = mkGuest(coord, e);
    door.registerPass(g.user.id, e, g.identity.commitment.toString());
    expect(door.guestListFor(g.user.id, e)).toMatchObject({ ok: true, commitments: [g.identity.commitment.toString()] });
    expect(door.guestListFor(mkUser("attendee").id, e)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("running the door", () => {
  it("is only for the event's coordinator or an admin", () => {
    const e = mkEvent(coord);
    expect(door.createChallenge(otherCoord, e)).toMatchObject({ ok: false, status: 403 });
    expect(door.createChallenge(mkUser("promoter"), e)).toMatchObject({ ok: false, status: 403 });
    expect(door.createChallenge(coord, e).ok).toBe(true);
    expect(door.createChallenge(admin, e).ok).toBe(true);
  });
});

describe("checking in with a proof", () => {
  /** An event with three registered guests. */
  const setup = () => {
    const e = mkEvent(coord);
    const guests = [mkGuest(coord, e), mkGuest(coord, e), mkGuest(coord, e)];
    for (const g of guests) door.registerPass(g.user.id, e, g.identity.commitment.toString());
    return { e, guests, members: door.groupCommitments(e) };
  };

  it("admits a valid guest, once, and the door code is then used up", async () => {
    const { e, guests, members } = setup();
    const c = challengeFor(coord, e);
    const proof = await prove(guests[0].identity, members, e, c);
    expect(await door.verifyCheckin(e, c, proof)).toEqual({ ok: true });
    const status = door.doorStatus(coord, e, c) as { ok: true; status: { state: string; admitted: number; tickets: number; passes: number } };
    expect(status.status).toMatchObject({ state: "admitted", admitted: 1, tickets: 3, passes: 3 });
    expect(await door.verifyCheckin(e, c, proof)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses the same pass a second time but does not burn the door code", async () => {
    const { e, guests, members } = setup();
    const c1 = challengeFor(coord, e);
    expect((await door.verifyCheckin(e, c1, await prove(guests[0].identity, members, e, c1))).ok).toBe(true);
    const c2 = challengeFor(coord, e);
    const again = await door.verifyCheckin(e, c2, await prove(guests[0].identity, members, e, c2));
    expect(again).toMatchObject({ ok: false, status: 409, error: "Already checked in." });
    // the next, different guest can still use that same door code
    expect((await door.verifyCheckin(e, c2, await prove(guests[1].identity, members, e, c2))).ok).toBe(true);
  });

  it("does not let a captured proof be replayed on a different door code", async () => {
    const { e, guests, members } = setup();
    const cA = challengeFor(coord, e), cB = challengeFor(coord, e);
    const proofA = await prove(guests[0].identity, members, e, cA);
    expect(await door.verifyCheckin(e, cB, proofA)).toMatchObject({ ok: false, status: 400 });
  });

  it("does not accept a proof made for another event", async () => {
    const { e, guests, members } = setup();
    const other = setup();
    const c = challengeFor(coord, e);
    const wrongScope = await prove(guests[0].identity, members, e, c, other.e);
    expect(await door.verifyCheckin(e, c, wrongScope)).toMatchObject({ ok: false, status: 400 });
  });

  it("does not accept someone proving membership in a guest list they made up", async () => {
    const { e } = setup();
    const outsider = new Identity();
    const fake = [outsider.commitment.toString(), new Identity().commitment.toString()];
    const c = challengeFor(coord, e);
    expect(await door.verifyCheckin(e, c, await prove(outsider, fake, e, c))).toMatchObject({ ok: false, status: 403 });
  });

  it("does not accept a tampered proof", async () => {
    const { e, guests, members } = setup();
    const c = challengeFor(coord, e);
    const proof = await prove(guests[0].identity, members, e, c);
    const forged = { ...proof, nullifier: (BigInt(proof.nullifier) + 1n).toString() };
    expect(await door.verifyCheckin(e, c, forged)).toMatchObject({ ok: false, status: 403 });
    const wrongPoint = { ...proof, points: [...proof.points.slice(0, 7), (BigInt(proof.points[7]) + 1n).toString()] };
    expect(await door.verifyCheckin(e, c, wrongPoint)).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects junk and expired codes, and junk does not burn the door code", async () => {
    const { e, guests, members } = setup();
    const c = challengeFor(coord, e);
    for (const junk of [null, {}, "x", { merkleTreeDepth: 99 }, { merkleTreeDepth: 1, merkleTreeRoot: "1" }]) {
      expect(await door.verifyCheckin(e, c, junk)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await door.verifyCheckin(e, "not-hex", {})).toMatchObject({ ok: false, status: 400 });
    expect(await door.verifyCheckin(e, "0".repeat(32), {})).toMatchObject({ ok: false, status: 404 });
    expect((await door.verifyCheckin(e, c, await prove(guests[2].identity, members, e, c))).ok).toBe(true);

    const c2 = challengeFor(coord, e);
    db.prepare("UPDATE door_challenges SET expires_at = unixepoch() - 1 WHERE id = ?").run(c2);
    expect(await door.verifyCheckin(e, c2, await prove(guests[1].identity, members, e, c2))).toMatchObject({ ok: false, status: 410 });
  });

  it("still accepts a proof made just before another guest registered", async () => {
    const { e, guests, members } = setup();
    const c = challengeFor(coord, e);
    const proof = await prove(guests[0].identity, members, e, c); // built from a 3-member list
    const late = mkGuest(coord, e);
    expect(door.registerPass(late.user.id, e, late.identity.commitment.toString()).ok).toBe(true); // list is now 4
    expect((await door.verifyCheckin(e, c, proof)).ok).toBe(true);
  });

  it("keeps no link between a check-in and a ticket or account", () => {
    const cols = (db.prepare("PRAGMA table_info(checkins)").all() as { name: string }[]).map((c) => c.name).sort();
    expect(cols).toEqual(["at", "event_id", "nullifier"]);
  });
});
