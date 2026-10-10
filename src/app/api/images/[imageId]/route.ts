import fs from "node:fs";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { imageFile } from "@/lib/event-images";

// An event's chosen picture is public. Every other picture is only for the people who manage the event.
export async function GET(req: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const variant = new URL(req.url).searchParams.get("v") === "full" ? "full" : "web";
  const found = imageFile(imageId, variant, await currentUser());
  if (!found) return NextResponse.json({ error: "No such picture." }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(found.file)), {
    headers: {
      "content-type": found.contentType,
      // Ids never change what they point at, but the picture can be un-chosen, so don't let shared caches hold it forever.
      "cache-control": found.isPublic ? "public, max-age=3600" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
