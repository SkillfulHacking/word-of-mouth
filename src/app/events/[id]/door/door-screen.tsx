"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = { state: "pending" | "admitted" | "expired"; lastError: string | null; admitted: number; tickets: number; passes: number };

export function DoorScreen({ eventId }: { eventId: string }) {
  const [qr, setQr] = useState("");
  const [link, setLink] = useState("");
  const [challenge, setChallenge] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const starting = useRef(false);

  const next = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    try {
      const res = await fetch(`/api/events/${eventId}/door/challenge`, { method: "POST" });
      if (!res.ok) return setError((await res.json().catch(() => null))?.error ?? "Couldn't start the door.");
      const { challenge: c } = (await res.json()) as { challenge: string };
      const url = `${location.origin}/checkin?e=${eventId}&c=${c}`;
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" }));
      setLink(url);
      setChallenge(c);
      setStatus((s) => (s ? { ...s, state: "pending", lastError: null } : s));
      setError("");
    } finally {
      starting.current = false;
    }
  }, [eventId]);

  useEffect(() => {
    void next();
  }, [next]);

  // Poll the current door code. A valid admission flashes green, then a fresh code appears for the next guest.
  useEffect(() => {
    if (!challenge) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/events/${eventId}/door/status?c=${challenge}`, { cache: "no-store" }).catch(() => null);
      if (stop || !res || !res.ok) return;
      const s = (await res.json()) as Status;
      setStatus(s);
      if (s.state === "admitted") {
        stop = true;
        setFlash(true);
        setTimeout(() => {
          setFlash(false);
          void next();
        }, 2500);
      } else if (s.state === "expired") {
        stop = true;
        void next();
      }
    };
    const t = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [challenge, eventId, next]);

  const thin = status !== null && status.passes < 3;

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div
        className="card"
        role="status"
        style={{ textAlign: "center", background: flash ? "var(--accent)" : undefined, color: flash ? "var(--accent-fg)" : undefined }}
      >
        {flash ? (
          <>
            <div style={{ fontSize: 96, lineHeight: 1 }} aria-hidden>
              ✓
            </div>
            <h2 style={{ margin: "8px 0" }}>Admitted</h2>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Scan to check in</h2>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Door QR code" width={280} height={280} style={{ background: "#fff", maxWidth: "100%", height: "auto" }} />
            ) : (
              <p className="muted">Starting…</p>
            )}
            <p className="muted" style={{ margin: "8px 0 0" }}>
              Guests scan this with their phone camera. The code changes after every guest.
            </p>
            {status?.lastError && <p className="error">Last attempt: {status.lastError}</p>}
          </>
        )}
      </div>

      {status && (
        <p>
          <strong>
            {status.admitted} of {status.tickets}
          </strong>{" "}
          tickets checked in · {status.passes} door passes set up
        </p>
      )}
      {thin && (
        <p className="muted">
          With fewer than 3 passes set up, a check-in isn&apos;t really anonymous: there are too few people it could have been.
        </p>
      )}
      {link && (
        <details>
          <summary>Link for this code</summary>
          <p style={{ wordBreak: "break-all" }} className="muted">
            {link}
          </p>
        </details>
      )}
    </>
  );
}
