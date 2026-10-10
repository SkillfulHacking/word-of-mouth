"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type View =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "noticket" }
  | { kind: "setup" }
  | { kind: "ready" }
  | { kind: "elsewhere" };

export default function PassPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/events/${id}/pass`);
      if (res.status === 401) return setView({ kind: "signin" });
      const s = (await res.json()) as { hasTicket: boolean; hasPass: boolean };
      if (!s.hasTicket) return setView({ kind: "noticket" });
      if (!s.hasPass) return setView({ kind: "setup" });
      const zk = await import("@/lib/zk-client");
      setView({ kind: zk.loadIdentity(id) ? "ready" : "elsewhere" });
    })().catch(() => setError("Couldn't load your pass. Check your connection and try again."));
  }, [id]);

  async function setup() {
    setBusy(true);
    setError("");
    const zk = await import("@/lib/zk-client");
    const identity = zk.newIdentity();
    try {
      // Save before registering, so we never register a pass this browser can't use.
      zk.saveIdentity(id, identity);
    } catch {
      setBusy(false);
      return setError("This browser can't keep the pass (a private window?). Open your ticket in a normal window.");
    }
    // Only the PUBLIC commitment is sent. The secret stays in this browser.
    const res = await fetch(`/api/events/${id}/pass`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitment: identity.commitment.toString() }),
    });
    if (!res.ok) {
      zk.forgetIdentity(id);
      setBusy(false);
      return setError((await res.json().catch(() => null))?.error ?? "Couldn't set up your pass.");
    }
    setView({ kind: "ready" });
    setBusy(false);
    // Fetch the proof files now, over good Wi-Fi, so the door is quick.
    const g = await fetch(`/api/events/${id}/group`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (g) void zk.prefetchCircuit(zk.depthFor(g.commitments));
  }

  return (
    <>
      <h1>Door pass</h1>
      {view.kind === "loading" && !error && <p className="muted">Loading…</p>}
      {view.kind === "signin" && (
        <p>
          <Link href="/login">Sign in</Link> to set up your door pass.
        </p>
      )}
      {view.kind === "noticket" && <p>You don&apos;t have a ticket for this event on this account.</p>}
      {view.kind === "setup" && (
        <div className="card">
          <p>
            Your pass is a secret that stays on <strong>this phone</strong>. The server only gets a public fingerprint of
            it, enough to know you&apos;re on the list but not to impersonate you, and not enough to tell which entry at
            the door was yours.
          </p>
          <p className="muted">
            Set it up on the phone and browser you&apos;ll carry. If you clear this browser&apos;s data, the pass is gone.
          </p>
          <button onClick={setup} disabled={busy}>
            {busy ? "Setting up…" : "Set up my door pass on this phone"}
          </button>
        </div>
      )}
      {view.kind === "ready" && (
        <div className="card">
          <p>
            <strong>Your door pass is ready.</strong>
          </p>
          <p>At the door, scan the screen with your phone&apos;s camera and open the link. Keep this browser signed in.</p>
          <p className="muted">It works once. You&apos;ll see a green check when you&apos;re admitted.</p>
        </div>
      )}
      {view.kind === "elsewhere" && (
        <div className="card">
          <p>
            This ticket already has a door pass, but it isn&apos;t in <strong>this browser</strong>. Use the phone or browser
            you set it up on. If that&apos;s lost, ask the event coordinator.
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <p>
        <Link href="/tickets">← Your tickets</Link>
      </p>
    </>
  );
}
