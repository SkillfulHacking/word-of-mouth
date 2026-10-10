import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeImagePrompt } from "@/lib/image-prompt";
import { canManageEvent } from "@/lib/invites";
import { chatJson } from "@/lib/ollama";

const Body = z.object({ idea: z.string().min(3).max(300) });

/** The local language model turns a short idea into an image prompt. Only the idea and the theme's color words go to it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the mood in a few words." }, { status: 400 });
  const { id } = await params;
  const event = db.prepare("SELECT id, coordinator_id, theme FROM events WHERE id = ?").get(id) as { id: string; coordinator_id: number; theme: string } | undefined;
  if (!event) return NextResponse.json({ error: "No such event." }, { status: 404 });
  if (!canManageEvent(actor, event)) return NextResponse.json({ error: "Only the event's coordinator or an admin can do that." }, { status: 403 });
  try {
    return NextResponse.json({ prompt: await writeImagePrompt(parsed.data.idea, event.theme, (s, u, schema) => chatJson(s, u, schema)) });
  } catch (e) {
    return NextResponse.json({ error: `The local model couldn't write that: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
