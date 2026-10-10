import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ASPECTS, buildWorkflow, comfyStatus, ComfyError, DEFAULT_NEGATIVE, pickCheckpoint, runWorkflow, type Aspect, type ComfyStatus } from "./comfy";
import { db, type User } from "./db";
import { sanitizeImagePrompt } from "./image-prompt";
import { canManageEvent, type Fail } from "./invites";
import { stripPngMetadata } from "./png";

const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const SAFE_ID = /^[A-Za-z0-9_-]{6,24}$/;

export const MAX_PER_REQUEST = 4;
const MAX_ACTIVE = 6; // images being made or waiting, per event

/** Pictures live next to the database (inside the Docker volume), one folder per event. */
export function imagesDir(eventId: string): string {
  const f = process.env.DATABASE_FILE;
  const root = process.env.DATA_DIR ?? (f && f !== ":memory:" ? path.dirname(f) : path.join(process.cwd(), "data"));
  return path.join(root, "images", eventId);
}

export type Deps = {
  status: () => Promise<ComfyStatus>;
  run: (workflow: Record<string, unknown>) => Promise<Buffer>;
};
const realDeps: Deps = { status: () => comfyStatus(), run: (wf) => runWorkflow(wf) };

type EventRow = { id: string; coordinator_id: number };
const getEvent = (id: string) => db.prepare("SELECT id, coordinator_id FROM events WHERE id = ?").get(id) as EventRow | undefined;
const guard = (actor: User, eventId: string): { ok: true; event: EventRow } | Fail => {
  if (!SAFE_ID.test(eventId)) return fail(404, "No such event.");
  const event = getEvent(eventId);
  if (!event) return fail(404, "No such event.");
  if (!canManageEvent(actor, event)) return fail(403, "Only the event's coordinator or an admin can do that.");
  return { ok: true, event };
};

export type ImageRow = {
  id: string;
  event_id: string;
  prompt: string;
  width: number;
  height: number;
  status: "running" | "done" | "failed";
  error: string | null;
  selected: number;
  checkpoint: string;
  created_at: number;
};

// ---- making pictures ------------------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();
/** Resolves when every picture queued so far has finished. Used by tests and shutdown. */
export const idle = (): Promise<void> => queue;

async function makeOne(id: string, checkpoint: string, deps: Deps): Promise<void> {
  const row = db.prepare("SELECT * FROM event_images WHERE id = ?").get(id) as (ImageRow & { negative: string; seed: number }) | undefined;
  if (!row) return;
  try {
    const raw = await deps.run(buildWorkflow({ checkpoint, prompt: row.prompt, negative: row.negative, width: row.width, height: row.height, seed: row.seed }));
    const clean = stripPngMetadata(raw); // ComfyUI embeds the prompt and workflow in every PNG
    const web = await sharp(clean).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const dir = imagesDir(row.event_id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.png`), clean);
    fs.writeFileSync(path.join(dir, `${id}.jpg`), web);
    db.prepare("UPDATE event_images SET status = 'done', error = NULL WHERE id = ?").run(id);
  } catch (e) {
    const message = e instanceof ComfyError ? e.message : `Couldn't make that picture (${e instanceof Error ? e.message : String(e)}).`;
    db.prepare("UPDATE event_images SET status = 'failed', error = ? WHERE id = ?").run(message.slice(0, 300), id);
  }
}

export type StartInput = { prompt: string; aspect: Aspect; count: number; negative?: string };

/**
 * Queue pictures for an event. Returns at once; the pictures are made one at a time in the background
 * (a shared GPU does one thing at a time anyway), and the coordinator watches their status.
 */
export async function startImages(actor: User, eventId: string, input: StartInput, deps: Deps = realDeps): Promise<{ ok: true; ids: string[] } | Fail> {
  const g = guard(actor, eventId);
  if (!g.ok) return g;
  if (!(input.aspect in ASPECTS)) return fail(400, "Pick a shape for the picture.");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_PER_REQUEST) return fail(400, `Make between 1 and ${MAX_PER_REQUEST} pictures at a time.`);
  const prompt = sanitizeImagePrompt(input.prompt);
  if (prompt.length < 10) return fail(400, "Describe the scene in a few more words.");

  const active = (db.prepare("SELECT COUNT(*) AS n FROM event_images WHERE event_id = ? AND status = 'running'").get(eventId) as { n: number }).n;
  if (active + input.count > MAX_ACTIVE) return fail(429, "Some pictures are still being made. Wait for them to finish.");

  const status = await deps.status();
  if (!status.ok) return fail(503, status.error);
  const checkpoint = status.checkpoint ?? pickCheckpoint(status.checkpoints);

  const { width, height } = ASPECTS[input.aspect];
  const negative = (input.negative?.trim() || DEFAULT_NEGATIVE).slice(0, 400);
  const insert = db.prepare("INSERT INTO event_images (id, event_id, prompt, negative, width, height, seed, checkpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const ids: string[] = [];
  for (let i = 0; i < input.count; i++) {
    const id = randomBytes(8).toString("base64url");
    insert.run(id, eventId, prompt, negative, width, height, randomBytes(4).readUInt32BE() % 2_000_000_000, checkpoint);
    ids.push(id);
    queue = queue.then(() => makeOne(id, checkpoint, deps));
  }
  return { ok: true, ids };
}

// ---- looking after them ---------------------------------------------------------------------

export function listImages(actor: User, eventId: string): { ok: true; images: ImageRow[] } | Fail {
  const g = guard(actor, eventId);
  if (!g.ok) return g;
  const images = db
    .prepare("SELECT id, event_id, prompt, width, height, status, error, selected, checkpoint, created_at FROM event_images WHERE event_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(eventId) as ImageRow[];
  return { ok: true, images };
}

/** Make a finished picture the event's public image (or `null` to clear it). Only one can be selected. */
export function selectImage(actor: User, eventId: string, imageId: string | null): { ok: true } | Fail {
  const g = guard(actor, eventId);
  if (!g.ok) return g;
  if (imageId !== null) {
    const row = db.prepare("SELECT status FROM event_images WHERE id = ? AND event_id = ?").get(imageId, eventId) as { status: string } | undefined;
    if (!row) return fail(404, "No such picture.");
    if (row.status !== "done") return fail(409, "That picture isn't finished.");
  }
  db.transaction(() => {
    db.prepare("UPDATE event_images SET selected = 0 WHERE event_id = ?").run(eventId);
    if (imageId !== null) db.prepare("UPDATE event_images SET selected = 1 WHERE id = ? AND event_id = ?").run(imageId, eventId);
  })();
  return { ok: true };
}

export function deleteImage(actor: User, eventId: string, imageId: string): { ok: true } | Fail {
  const g = guard(actor, eventId);
  if (!g.ok) return g;
  if (!SAFE_ID.test(imageId)) return fail(404, "No such picture.");
  const row = db.prepare("SELECT status FROM event_images WHERE id = ? AND event_id = ?").get(imageId, eventId) as { status: string } | undefined;
  if (!row) return fail(404, "No such picture.");
  if (row.status === "running") return fail(409, "That picture is still being made.");
  db.prepare("DELETE FROM event_images WHERE id = ? AND event_id = ?").run(imageId, eventId);
  for (const ext of ["png", "jpg"]) fs.rmSync(path.join(imagesDir(eventId), `${imageId}.${ext}`), { force: true });
  return { ok: true };
}

/** The id of the event's public picture, if one is chosen and finished. */
export const coverId = (eventId: string): string | null =>
  (db.prepare("SELECT id FROM event_images WHERE event_id = ? AND selected = 1 AND status = 'done'").get(eventId) as { id: string } | undefined)?.id ?? null;

export type ImageFile = { file: string; contentType: string; isPublic: boolean };

/**
 * Where to read a picture from, if this person may see it. The event's chosen picture is public (it's on the
 * public pages anyway). Every other picture is private to the people who manage the event.
 */
export function imageFile(imageId: string, variant: "web" | "full", actor: User | null): ImageFile | null {
  if (!SAFE_ID.test(imageId)) return null;
  const row = db
    .prepare("SELECT i.event_id, i.selected, i.status, e.coordinator_id FROM event_images i JOIN events e ON e.id = i.event_id WHERE i.id = ?")
    .get(imageId) as { event_id: string; selected: number; status: string; coordinator_id: number } | undefined;
  if (!row || row.status !== "done") return null;
  const isPublic = row.selected === 1;
  if (!isPublic && !(actor && canManageEvent(actor, { id: row.event_id, coordinator_id: row.coordinator_id }))) return null;
  const ext = variant === "full" ? "png" : "jpg";
  const file = path.join(imagesDir(row.event_id), `${imageId}.${ext}`);
  return fs.existsSync(file) ? { file, contentType: variant === "full" ? "image/png" : "image/jpeg", isPublic } : null;
}
