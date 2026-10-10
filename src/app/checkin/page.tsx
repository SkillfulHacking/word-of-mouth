"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

type State = { kind: "working"; msg: string } | { kind: "in" } | { kind: "stop"; msg: string; signin?: boolean };

function CheckIn() {
  const params = useSearchParams();
  const eventId = params.get("e") ?? "";
  const challenge = params.get("c") ?? "";
  const [state, setState] = useState<State>({ kind: "working", msg: "Getting the guest list…" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice in dev; one proof is enough
    started.current = true;
    (async () => {
      if (!eventId || !challenge) return setState({ kind: "stop", msg: "This isn't a door code. Scan the screen at the door." });
      const zk = await import("@/lib/zk-client");

      const identity = zk.loadIdentity(eventId);
      if (!identity) {
        return setState({ kind: "stop", msg: "There's no door pass in this browser. Open this link in the browser where you set up your pass (find it under Your tickets)." });
      }

      const res = await fetch(`/api/events/${eventId}/group`);
      if (res.status === 401) return setState({ kind: "stop", msg: "Sign in first, then scan the door screen again.", signin: true });
      if (!res.ok) return setState({ kind: "stop", msg: (await res.json().catch(() => null))?.error ?? "Couldn't load the guest list." });
      const { commitments } = (await res.json()) as { commitments: string[] };
      if (!commitments.includes(identity.commitment.toString())) {
        return setState({ kind: "stop", msg: "Your pass isn't on the guest list. Set it up under Your tickets, then try again." });
      }

      setState({ kind: "working", msg: "Making your pass. This takes a few seconds…" });
      const proof = await zk.makeProof(identity, commitments, eventId, challenge);

      setState({ kind: "working", msg: "Checking in…" });
      // credentials: "omit" so the server can't tie this check-in to your account.
      const out = await fetch(`/api/events/${eventId}/checkin`, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, proof }),
      });
      if (out.ok) return setState({ kind: "in" });
      setState({ kind: "stop", msg: (await out.json().catch(() => null))?.error ?? "That didn't work." });
    })().catch((e: unknown) => setState({ kind: "stop", msg: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` }));
  }, [eventId, challenge]);

  if (state.kind === "in") {
    return (
      <div role="status" style={{ textAlign: "center", padding: "48px 0" }}>
        <div style={{ fontSize: 96, lineHeight: 1, color: "var(--accent)" }} aria-hidden>
          ✓
        </div>
        <h1>You&apos;re in</h1>
        <p className="muted">Enjoy the party.</p>
      </div>
    );
  }
  if (state.kind === "stop") {
    return (
      <>
        <h1>Couldn&apos;t check you in</h1>
        <p className="error">{state.msg}</p>
        {state.signin && (
          <p>
            <Link className="btn" href="/login">
              Sign in
            </Link>
          </p>
        )}
        <p>
          <Link href="/tickets">Your tickets</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Checking you in</h1>
      <p role="status">{state.msg}</p>
    </>
  );
}

export default function CheckInPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <CheckIn />
    </Suspense>
  );
}
