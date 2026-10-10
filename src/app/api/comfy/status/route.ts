import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { comfyStatus } from "@/lib/comfy";

export async function GET() {
  const actor = await apiUser("coordinator");
  if (actor instanceof NextResponse) return actor;
  return NextResponse.json(await comfyStatus(), { headers: { "cache-control": "no-store" } });
}
