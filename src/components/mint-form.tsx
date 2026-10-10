"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MintForm({ eventId, disabled }: { eventId: string; disabled?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/events/${eventId}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setBusy(false);
    if (res.ok) {
      setNote("");
      router.refresh();
    } else setError((await res.json().catch(() => null))?.error ?? "Couldn't create the invite.");
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={`note-${eventId}`}>Who is this invite for? (just a reminder for you)</label>
      <div className="row">
        <input id={`note-${eventId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Sam from the book club" />
        <button disabled={busy || disabled} style={{ flex: "none" }}>
          {busy ? "Creating…" : "Create invite"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
