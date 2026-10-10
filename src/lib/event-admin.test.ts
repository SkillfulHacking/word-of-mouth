import { beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "./db";
import { customValue } from "./themes";

vi.stubEnv("DATABASE_FILE", ":memory:");
const { db } = await import("./db");
const admin = await import("./event-admin");
const inv = await import("./invites");

let n = 0;
const mkUser = (role: User["role"]): User => {
  const name = `${role}${++n}`;
  return { id: Number(db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, 'x', ?)").run(name, role).lastInsertRowid), username: name, role };
};
let owner: User, other: User, boss: User, promoter: User, attendee: User, event: string;
beforeAll(() => {
  owner = mkUser("coordinator");
  other = mkUser("coordinator");
  boss = mkUser("admin");
  promoter = mkUser("promoter");
  attendee = mkUser("attendee");
  event = `ev${++n}`;
  db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES (?, ?, 'Op', '13204', 'b', 2)").run(event, owner.id);
});
const themeOf = () => (db.prepare("SELECT theme FROM events WHERE id = ?").get(event) as { theme: string }).theme;

describe("setEventTheme", () => {
  it("starts on the default theme", () => expect(themeOf()).toBe("default"));
  it("lets the event's coordinator and any admin change it", () => {
    expect(admin.setEventTheme(owner, event, "fireside")).toEqual({ ok: true });
    expect(themeOf()).toBe("fireside");
    expect(admin.setEventTheme(boss, event, "wraith")).toEqual({ ok: true });
    expect(themeOf()).toBe("wraith");
  });
  it("refuses everyone else", () => {
    for (const who of [other, promoter, attendee]) {
      expect(admin.setEventTheme(who, event, "inked")).toMatchObject({ ok: false, status: 403 });
    }
    expect(themeOf()).toBe("wraith");
  });
  it("accepts a custom theme", () => {
    const v = customValue("#102030", "#eeeeee", "#ff8800");
    expect(admin.setEventTheme(owner, event, v)).toEqual({ ok: true });
    expect(themeOf()).toBe(v);
  });
  it("refuses unknown themes and CSS-injection attempts, leaving the theme unchanged", () => {
    const before = themeOf();
    for (const bad of ["", "nonsense", "custom:#102030,#eeeeee,#ff8800}body{display:none", "fireside;color:red"]) {
      expect(admin.setEventTheme(owner, event, bad), bad).toMatchObject({ ok: false, status: 400 });
    }
    expect(themeOf()).toBe(before);
  });
  it("404s for a missing event", () => expect(admin.setEventTheme(owner, "nope", "inked")).toMatchObject({ ok: false, status: 404 }));
  it("shows up on the invite link a stranger opens", () => {
    admin.setEventTheme(owner, event, "marina");
    const { code } = inv.mintInvite(owner, event, "") as { ok: true; code: string };
    expect(inv.inviteView(code)).toMatchObject({ state: "open", theme: "marina" });
  });
});
