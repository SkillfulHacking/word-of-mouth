import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { deleteImage, selectImage } from "@/lib/event-images";
import { failResponse } from "@/lib/respond";

const Body = z.object({ action: z.enum(["select", "unselect"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose select or unselect." }, { status: 400 });
  const { id, imageId } = await params;
  const r = selectImage(actor, id, parsed.data.action === "select" ? imageId : null);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  const { id, imageId } = await params;
  const r = deleteImage(actor, id, imageId);
  return r.ok ? NextResponse.json({ ok: true }) : failResponse(r);
}
