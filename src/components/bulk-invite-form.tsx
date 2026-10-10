"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_BATCH } from "@/lib/limits";

/** Make a run of invites for printing, then go straight to the print sheet. `max` is how many this person may still make. */
export function BulkInviteForm({ eventId, max }: { eventId: string; max: number | null }) {
  const router = useRouter();
  const cap = Math.min(MAX_BATCH, max ?? MAX_BATCH);
  const [count, setCount] = useState(Math.min(10, cap));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/events/${eventId}/invites/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count, note }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) router.push(`/print/invites/${eventId}?batch=${body.batch}`);
    else {
      setError(body?.error ?? "Couldn't create the invites.");
      setBusy(false);
    }
  }

  if (cap < 1) return <p className="muted">You&apos;ve used all your invites for this event.</p>;
  return (
    <form onSubmit={submit}>
      <div className="row">
        <div>
          <label htmlFor={`bulk-count-${eventId}`}>How many invites?</label>
          <input id={`bulk-count-${eventId}`} type="number" min={1} max={cap} value={count} onChange={(e) => setCount(Number(e.target.value))} required />
        </div>
        <div style={{ flex: "2 1 220px" }}>
          <label htmlFor={`bulk-note-${eventId}`}>Label for this batch (just for you)</label>
          <input id={`bulk-note-${eventId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Flyers for the farmers market" />
        </div>
        <button disabled={busy || count < 1 || count > cap} style={{ flex: "none", alignSelf: "end" }}>
          {busy ? "Creating…" : "Create and print"}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        Each one is a different single-use code, up to {cap} at a time{max !== null ? ` (you have ${max} left)` : ""}.
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
