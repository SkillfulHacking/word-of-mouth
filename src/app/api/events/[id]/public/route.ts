import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { coverId } from "@/lib/event-images";

type EventRow = { codename: string; zip: string; blob: string; threshold: number; theme: string };
type SpotRow = { idx: number; clue: string };

// Everything here is safe to expose: the blob is useless without `threshold` shards,
// and clues are riddles, not coordinates.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = db.prepare("SELECT codename, zip, blob, threshold, theme FROM events WHERE id = ?").get(id) as
    | EventRow
    | undefined;
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  const spots = db.prepare("SELECT idx, clue FROM event_spots WHERE event_id = ? ORDER BY idx").all(id) as SpotRow[];
  return NextResponse.json({ ...event, spots, cover: coverId(id) });
}
