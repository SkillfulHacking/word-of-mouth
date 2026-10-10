"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { unlockDetails, type EventDetails } from "@/lib/client-crypto";

type Meta = { codename: string; zip: string; blob: string; threshold: number; spots: { idx: number; clue: string }[] };

export default function ShardPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [found, setFound] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [error, setError] = useState("");
  const storeKey = `wom:shards:${id}`;

  // 1) Pick up a shard from the URL fragment, remember it locally, and scrub it from the address bar.
  // Scanning the next code in the same tab only changes the #fragment (no page load), so this also
  // runs on `hashchange`, not just on first render.
  useEffect(() => {
    const ingest = () => {
      let stored: Record<string, string> = {};
      try {
        stored = JSON.parse(localStorage.getItem(storeKey) ?? "{}");
      } catch {
        /* storage blocked or corrupt: fall back to what's in memory */
      }
      const m = /^#(\d+)\.([\w-]+)$/.exec(location.hash);
      if (m) {
        stored[m[1]] = m[2];
        try {
          localStorage.setItem(storeKey, JSON.stringify(stored));
        } catch {
          /* keep it in memory for this visit */
        }
        history.replaceState(null, "", location.pathname);
      }
      setFound((prev) => ({ ...prev, ...stored }));
    };
    ingest();
    window.addEventListener("hashchange", ingest);
    return () => window.removeEventListener("hashchange", ingest);
  }, [storeKey]);

  useEffect(() => {
    fetch(`/api/events/${id}/public`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("This event doesn't exist."))))
      .then(setMeta)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  // 2) With enough shards, rebuild the key in the browser and decrypt. The server never sees any of it.
  useEffect(() => {
    if (!meta || details) return;
    const shares = Object.values(found);
    if (shares.length < meta.threshold) return;
    unlockDetails(meta.blob, shares)
      .then(setDetails)
      .catch(() => setError("Those shards don't fit together. One may be from a different event or damaged."));
  }, [meta, found, details]);

  if (error && !meta) return <p className="error">{error}</p>;
  if (!meta) return <p className="muted">Loading…</p>;

  const count = Object.keys(found).length;
  return (
    <>
      <h1>{meta.codename}</h1>
      {details ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{details.title}</h2>
          <p>
            <strong>When:</strong> {new Date(details.startsAt).toLocaleString()}
          </p>
          {details.venue && (
            <p>
              <strong>Where:</strong> {details.venue}
            </p>
          )}
          {details.address && <p>{details.address}</p>}
          {details.notes && <p className="muted">{details.notes}</p>}
        </div>
      ) : (
        <>
          <p>
            Shards found: <strong>{count}</strong> of <strong>{meta.threshold}</strong> needed.
          </p>
          <div className="dots" aria-hidden>
            {Array.from({ length: meta.threshold }, (_, i) => (
              <span key={i} className={i < count ? "dot on" : "dot"} />
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <h2>Still hunting</h2>
          <ol>
            {meta.spots.map((s) => (
              <li key={s.idx} style={{ opacity: found[String(s.idx)] ? 0.45 : 1 }}>
                {s.clue} {found[String(s.idx)] && "✓"}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
