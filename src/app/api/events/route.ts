import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MAX_SPOTS } from "@/lib/limits";
import { sealDetails } from "@/lib/seal";

const Spot = z
  .object({
    label: z.string().min(1).max(120),
    clue: z.string().min(1).max(500),
    lat: z.number().min(-90).max(90).nullish(),
    lon: z.number().min(-180).max(180).nullish(),
    osmRef: z.string().max(40).nullish(),
  })
  .refine((s) => (s.lat == null) === (s.lon == null), { message: "A map point needs both latitude and longitude." });

const Body = z
  .object({
    codename: z.string().min(2).max(60),
    // The only location shown publicly until enough codes are collected.
    zip: z.string().regex(/^\d{5}$/, "ZIP code must be 5 digits."),
    details: z.object({
      title: z.string().min(1).max(120),
      startsAt: z.string().min(1).max(40),
      venue: z.string().max(200),
      address: z.string().max(300),
      notes: z.string().max(1000),
    }),
    threshold: z.number().int().min(1),
    spots: z.array(Spot).min(1).max(MAX_SPOTS),
  })
  .refine((b) => b.threshold <= b.spots.length, { message: "Threshold can't exceed the number of spots." });

export async function POST(req: Request) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { codename, zip, details, threshold, spots } = parsed.data;

  const { blob, shares } = await sealDetails(details, spots.length, threshold);
  const id = randomBytes(5).toString("base64url");

  db.transaction(() => {
    db.prepare("INSERT INTO events (id, coordinator_id, codename, zip, blob, threshold) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      actor.id,
      codename,
      zip,
      blob,
      threshold,
    );
    const insert = db.prepare(
      "INSERT INTO event_spots (event_id, idx, label, clue, lat, lon, osm_ref) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    spots.forEach((s, i) => insert.run(id, i + 1, s.label, s.clue, s.lat ?? null, s.lon ?? null, s.osmRef ?? null));
  })();

  // The shares are returned exactly once. The server keeps no copy.
  return NextResponse.json(
    { id, shares: shares.map((share, i) => ({ idx: i + 1, share, label: spots[i].label, clue: spots[i].clue })) },
    { status: 201 },
  );
}
