import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type G = typeof globalThis & { __womDb?: { close(): void } };

/** Open the database module fresh, as the server does when it starts. */
async function openAt(file: string) {
  (globalThis as G).__womDb?.close();
  delete (globalThis as G).__womDb;
  vi.resetModules();
  vi.stubEnv("DATABASE_FILE", file);
  return (await import("./db")).db;
}

describe("starting the app again", () => {
  it("fails image jobs that were mid-flight when the server stopped, and leaves finished ones alone", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wom-restart-")), "wom.db");

    let db = await openAt(file);
    db.prepare("INSERT INTO users (id, username, pass_hash, role) VALUES (1, 'a', 'x', 'admin')").run();
    db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES ('e1', 1, 'Op', '13204', 'b', 2)").run();
    const add = db.prepare("INSERT INTO event_images (id, event_id, prompt, width, height, seed, status) VALUES (?, 'e1', 'p', 1, 1, 1, ?)");
    add.run("running-1", "running");
    add.run("running-2", "running");
    add.run("done-1", "done");
    add.run("failed-1", "failed");

    db = await openAt(file); // the server restarts
    const rows = db.prepare("SELECT id, status, error FROM event_images ORDER BY id").all() as { id: string; status: string; error: string | null }[];
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ "done-1": "done", "failed-1": "failed", "running-1": "failed", "running-2": "failed" });
    expect(rows.find((r) => r.id === "running-1")?.error).toBe("Interrupted by a restart.");
    expect(rows.find((r) => r.id === "done-1")?.error).toBeNull();
  });

  it("upgrades a database made before themes and batches existed, keeping its data", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wom-old-")), "wom.db");
    const Database = (await import("better-sqlite3")).default;
    const old = new Database(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE events (id TEXT PRIMARY KEY, coordinator_id INTEGER NOT NULL, codename TEXT NOT NULL, zip TEXT NOT NULL, blob TEXT NOT NULL, threshold INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE invites (code TEXT PRIMARY KEY, event_id TEXT NOT NULL, created_by INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT (unixepoch()), redeemed_by INTEGER, redeemed_at INTEGER);
      INSERT INTO users (id, username, pass_hash, role) VALUES (1, 'a', 'x', 'admin');
      INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES ('old1', 1, 'Old event', '13204', 'b', 2);
      INSERT INTO invites (code, event_id, created_by) VALUES ('c1', 'old1', 1);
    `);
    old.close();

    const db = await openAt(file);
    expect(db.prepare("SELECT codename, theme FROM events").get()).toEqual({ codename: "Old event", theme: "default" });
    expect(db.prepare("SELECT code, batch FROM invites").get()).toEqual({ code: "c1", batch: null });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'event_images'").get()).toBeTruthy();
  });
});
