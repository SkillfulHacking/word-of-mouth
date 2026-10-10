import { NextResponse } from "next/server";
import type { Fail } from "./invites";

/** Turn a rules-layer failure into an HTTP response. */
export const failResponse = (f: Fail) => NextResponse.json({ error: f.error }, { status: f.status });
