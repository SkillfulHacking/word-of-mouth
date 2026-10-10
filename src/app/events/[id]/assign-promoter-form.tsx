"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AssignPromoterForm({ eventId, promoters }: { eventId: string; promoters: { id: number; username: string }[] }) {
  const router = useRouter();
  const [promoterId, setPromoterId] = useState(promoters[0]?.id ?? 0);
  const [quota, setQuota] = useState(5);
  const [error, setError] = useState("");

  async function save(q: number, id = promoterId) {
    setError("");
    const res = await fetch(`/api/events/${eventId}/promoters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promoterId: id, quota: q }),
    });
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => null))?.error ?? "Couldn't save.");
  }

  if (promoters.length === 0) return <p className="muted">No promoter accounts yet. An admin can add some under Users and roles.</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(quota);
      }}
    >
      <div className="row">
        <div>
          <label htmlFor="promoter">Promoter</label>
          <select id="promoter" value={promoterId} onChange={(e) => setPromoterId(Number(e.target.value))}>
            {promoters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.username}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="quota">Invites they can send</label>
          <input id="quota" type="number" min={1} max={100} value={quota} onChange={(e) => setQuota(Number(e.target.value))} />
        </div>
        <button style={{ flex: "none", alignSelf: "end" }}>Assign</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function RemovePromoterButton({ eventId, promoterId }: { eventId: string; promoterId: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await fetch(`/api/events/${eventId}/promoters`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ promoterId, quota: 0 }),
        });
        router.refresh();
      }}
    >
      Remove
    </button>
  );
}
