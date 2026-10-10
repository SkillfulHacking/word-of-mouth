import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { PNG } from "pngjs";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { User } from "./db";
import { pngChunks } from "./png";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wom-images-"));
vi.stubEnv("DATABASE_FILE", ":memory:");
vi.stubEnv("DATA_DIR", dataDir);
const { db } = await import("./db");
const imgs = await import("./event-images");
const { sanitizeImagePrompt, writeImagePrompt, themeColorWords } = await import("./image-prompt");

// a 2000x500 PNG carrying ComfyUI-style text chunks
function comfyPng(): Buffer {
  const p = new PNG({ width: 2000, height: 500 });
  p.data.fill(180);
  const plain = PNG.sync.write(p);
  const idat = plain.indexOf("IDAT") - 4;
  const data = Buffer.from("prompt\0SECRET: the venue is Freddy's");
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write("tEXt", 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([plain.subarray(0, idat), head, data, crc, plain.subarray(idat)]);
}

let n = 0;
const mkUser = (role: User["role"]): User => {
  const name = `${role}${++n}`;
  return { id: Number(db.prepare("INSERT INTO users (username, pass_hash, role) VALUES (?, 'x', ?)").run(name, role).lastInsertRowid), username: name, role };
};
const mkEvent = (owner: User) => {
  const id = `evt${++n}ABC`;
  db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES (?, ?, 'Op', '13204', 'b', 2)").run(id, owner.id);
  return id;
};
let owner: User, other: User, boss: User, promoter: User, attendee: User;
beforeAll(() => {
  owner = mkUser("coordinator");
  other = mkUser("coordinator");
  boss = mkUser("admin");
  promoter = mkUser("promoter");
  attendee = mkUser("attendee");
});

let concurrent = 0, maxConcurrent = 0, runs = 0;
const okDeps = (): import("./event-images").Deps => ({
  status: async () => ({ ok: true, version: "1", device: "gpu", vramGb: 12, checkpoints: ["m"], checkpoint: "m", fast: true }),
  run: async () => {
    runs++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 15));
    concurrent--;
    return comfyPng();
  },
});
const start = (eventId: string, over: Partial<{ prompt: string; aspect: "landscape"; count: number }> = {}, who = owner, deps = okDeps()) =>
  imgs.startImages(who, eventId, { prompt: "glowing pumpkins on a dark table, mist", aspect: "landscape", count: 1, ...over }, deps);

describe("sanitizeImagePrompt", () => {
  it("removes the words that make an image model paint lettering", () => {
    expect(sanitizeImagePrompt("spooky Halloween party invitation banner, glowing pumpkins, text, poster style")).toBe("spooky Halloween party, glowing pumpkins, style");
    expect(sanitizeImagePrompt("A Flyer with a LOGO, candles")).toBe("A with a, candles");
  });
  it("only removes whole words", () => {
    expect(sanitizeImagePrompt("a signal fire, cardinal birds, adventure, tower")).toBe("a signal fire, cardinal birds, adventure, tower");
  });
  it("copes with nothing left, and with a very long prompt", () => {
    expect(sanitizeImagePrompt("poster, banner, text")).toBe("");
    expect(sanitizeImagePrompt("lantern, ".repeat(300)).length).toBeLessThanOrEqual(700);
  });
});

describe("writeImagePrompt", () => {
  it("asks the model with the idea and the theme's color words, and cleans what comes back", async () => {
    let seen = "";
    const ask = (async (_s: string, u: string) => ((seen = u), { prompt: '"glowing carved pumpkins, mist, purple and orange lighting, invitation poster, digital illustration, wide scene"' })) as never;
    const prompt = await writeImagePrompt("a spooky costume party", "amethyst-dawn", ask);
    expect(seen).toContain("a spooky costume party");
    for (const color of themeColorWords("amethyst-dawn")) expect(seen).toContain(color);
    expect(prompt).not.toMatch(/invitation|poster|^"/i);
    expect(prompt).toContain("glowing carved pumpkins");
  });
  it("refuses a model answer that is empty once cleaned", async () => {
    const ask = (async () => ({ prompt: "poster banner flyer text title lettering logo card" })) as never;
    await expect(writeImagePrompt("x", "default", ask)).rejects.toThrow(/wasn't usable/);
  });
});

describe("making pictures", () => {
  it("only lets the event's coordinator and admins ask for pictures", async () => {
    const e = mkEvent(owner);
    for (const who of [other, promoter, attendee]) expect(await start(e, {}, who), who.username).toMatchObject({ ok: false, status: 403 });
    expect((await start(e, {}, owner)).ok).toBe(true);
    expect((await start(e, {}, boss)).ok).toBe(true);
    await imgs.idle();
  });
  it("validates the request", async () => {
    const e = mkEvent(owner);
    for (const count of [0, 5, 1.5]) expect(await start(e, { count }), String(count)).toMatchObject({ ok: false, status: 400 });
    expect(await start(e, { aspect: "diagonal" as never })).toMatchObject({ ok: false, status: 400 });
    expect(await start(e, { prompt: "poster text" })).toMatchObject({ ok: false, status: 400 }); // nothing left after cleaning
    expect(await imgs.startImages(owner, "no-such-event", { prompt: "a lantern in mist", aspect: "landscape", count: 1 }, okDeps())).toMatchObject({ ok: false, status: 404 });
  });
  it("makes finished pictures with no prompt inside the file, and a smaller web copy", async () => {
    const e = mkEvent(owner);
    const r = (await start(e, { count: 2 })) as { ok: true; ids: string[] };
    expect(r.ids).toHaveLength(2);
    expect((imgs.listImages(owner, e) as { images: { status: string }[] }).images.every((i) => i.status === "running")).toBe(true);
    await imgs.idle();
    for (const id of r.ids) {
      const full = fs.readFileSync(path.join(imgs.imagesDir(e), `${id}.png`));
      expect(pngChunks(full)).not.toContain("tEXt");
      expect(full.toString("latin1")).not.toContain("SECRET");
      expect((await sharp(path.join(imgs.imagesDir(e), `${id}.jpg`)).metadata()).width).toBe(1600); // 2000 -> 1600
      expect((await sharp(full).metadata()).width).toBe(2000); // the print copy keeps full size
    }
    expect((imgs.listImages(owner, e) as { images: { status: string }[] }).images.every((i) => i.status === "done")).toBe(true);
  });
  it("makes one picture at a time", async () => {
    const e = mkEvent(owner);
    maxConcurrent = 0;
    await start(e, { count: 4 });
    await imgs.idle();
    expect(maxConcurrent).toBe(1);
  });
  it("sends the cleaned prompt, never the raw one", async () => {
    const e = mkEvent(owner);
    let sent = "";
    const deps = okDeps();
    const orig = deps.run;
    deps.run = async (wf) => { sent = JSON.stringify(wf); return orig(wf); };
    await start(e, { prompt: "pumpkins, mist, invitation banner with text" }, owner, deps);
    await imgs.idle();
    expect(sent).toContain("pumpkins, mist");
    expect(sent).not.toMatch(/invitation|banner/);
  });
  it("says so if ComfyUI is unreachable, and queues nothing", async () => {
    const e = mkEvent(owner);
    const down: import("./event-images").Deps = { status: async () => ({ ok: false, error: "Couldn't reach ComfyUI at http://x" }), run: async () => { throw new Error("unused"); } };
    expect(await start(e, {}, owner, down)).toMatchObject({ ok: false, status: 503, error: expect.stringContaining("Couldn't reach ComfyUI") });
    expect((imgs.listImages(owner, e) as { images: unknown[] }).images).toHaveLength(0);
  });
  it("records a failure with its reason instead of hanging", async () => {
    const e = mkEvent(owner);
    const deps = okDeps();
    deps.run = async () => { throw new (await import("./comfy")).ComfyError("ComfyUI failed: CUDA out of memory"); };
    await start(e, {}, owner, deps);
    await imgs.idle();
    const img = (imgs.listImages(owner, e) as { images: { status: string; error: string }[] }).images[0];
    expect(img).toMatchObject({ status: "failed", error: "ComfyUI failed: CUDA out of memory" });
  });
  it("won't pile up too many at once", async () => {
    const e = mkEvent(owner);
    const slow = okDeps();
    slow.run = () => new Promise((r) => setTimeout(() => r(comfyPng()), 60));
    expect((await start(e, { count: 4 }, owner, slow)).ok).toBe(true);
    expect(await start(e, { count: 4 }, owner, slow)).toMatchObject({ ok: false, status: 429 });
    await imgs.idle();
    expect((await start(e, { count: 4 }, owner, okDeps())).ok).toBe(true); // fine once they finish
    await imgs.idle();
  });
});

describe("choosing and seeing pictures", () => {
  const finished = async (e: string, count = 2) => {
    const r = (await start(e, { count })) as { ok: true; ids: string[] };
    await imgs.idle();
    return r.ids;
  };
  it("selects one at a time, and clears", async () => {
    const e = mkEvent(owner);
    const [a, b] = await finished(e);
    expect(imgs.coverId(e)).toBeNull();
    expect(imgs.selectImage(owner, e, a)).toEqual({ ok: true });
    expect(imgs.coverId(e)).toBe(a);
    expect(imgs.selectImage(owner, e, b)).toEqual({ ok: true });
    expect(imgs.coverId(e)).toBe(b);
    expect((db.prepare("SELECT COUNT(*) AS n FROM event_images WHERE event_id = ? AND selected = 1").get(e) as { n: number }).n).toBe(1);
    expect(imgs.selectImage(owner, e, null)).toEqual({ ok: true });
    expect(imgs.coverId(e)).toBeNull();
  });
  it("refuses to select something unfinished, someone else's, or by the wrong person", async () => {
    const e = mkEvent(owner), e2 = mkEvent(owner);
    const [a] = await finished(e, 1);
    const [theirs] = await finished(e2, 1);
    expect(imgs.selectImage(owner, e, theirs)).toMatchObject({ ok: false, status: 404 }); // an image from another event
    expect(imgs.selectImage(other, e, a)).toMatchObject({ ok: false, status: 403 });
    db.prepare("INSERT INTO event_images (id, event_id, prompt, width, height, seed) VALUES ('running1234', ?, 'p', 1, 1, 1)").run(e);
    expect(imgs.selectImage(owner, e, "running1234")).toMatchObject({ ok: false, status: 409 });
  });
  it("makes only the chosen picture public", async () => {
    const e = mkEvent(owner);
    const [chosen, spare] = await finished(e);
    imgs.selectImage(owner, e, chosen);
    // anyone can see the chosen one (it's on the public pages)
    expect(imgs.imageFile(chosen, "web", null)).toMatchObject({ isPublic: true, contentType: "image/jpeg" });
    expect(imgs.imageFile(chosen, "full", attendee)).toMatchObject({ isPublic: true, contentType: "image/png" });
    // the spare is private to the people who manage the event
    expect(imgs.imageFile(spare, "web", null)).toBeNull();
    expect(imgs.imageFile(spare, "web", attendee)).toBeNull();
    expect(imgs.imageFile(spare, "web", other)).toBeNull();
    expect(imgs.imageFile(spare, "web", promoter)).toBeNull();
    expect(imgs.imageFile(spare, "web", owner)).toMatchObject({ isPublic: false });
    expect(imgs.imageFile(spare, "full", boss)).toMatchObject({ isPublic: false });
    // un-choosing makes it private again
    imgs.selectImage(owner, e, null);
    expect(imgs.imageFile(chosen, "web", null)).toBeNull();
  });
  it("rejects hostile ids and missing or unfinished pictures", async () => {
    for (const bad of ["../../etc/passwd", "a/b", "..", "", "x".repeat(40), "has space1"]) expect(imgs.imageFile(bad, "web", boss), bad).toBeNull();
    expect(imgs.imageFile("doesnotexist1", "web", boss)).toBeNull();
    const e = mkEvent(owner);
    db.prepare("INSERT INTO event_images (id, event_id, prompt, width, height, seed, status, selected) VALUES ('failed12345', ?, 'p', 1, 1, 1, 'failed', 1)").run(e);
    expect(imgs.imageFile("failed12345", "web", boss)).toBeNull();
  });
  it("deletes a picture and its files, but not one still being made", async () => {
    const e = mkEvent(owner);
    const [a] = await finished(e, 1);
    expect(imgs.deleteImage(other, e, a)).toMatchObject({ ok: false, status: 403 });
    expect(imgs.deleteImage(owner, e, a)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(imgs.imagesDir(e), `${a}.png`))).toBe(false);
    expect(fs.existsSync(path.join(imgs.imagesDir(e), `${a}.jpg`))).toBe(false);
    expect(imgs.deleteImage(owner, e, a)).toMatchObject({ ok: false, status: 404 });
    db.prepare("INSERT INTO event_images (id, event_id, prompt, width, height, seed) VALUES ('busy1234567', ?, 'p', 1, 1, 1)").run(e);
    expect(imgs.deleteImage(owner, e, "busy1234567")).toMatchObject({ ok: false, status: 409 });
  });
});
