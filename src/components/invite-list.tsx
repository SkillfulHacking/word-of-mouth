"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type InviteRow = { code: string; note: string; by?: string; redeemedBy: string | null; canRevoke: boolean };

function Row({ invite }: { invite: InviteRow }) {
  const router = useRouter();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const open = invite.redeemedBy === null;
  const link = () => `${location.origin}/i/${invite.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Long-press the QR code or share the link another way.");
    }
  }
  async function toggleQr() {
    setQr(qr ? "" : await QRCode.toDataURL(link(), { margin: 1, width: 240, errorCorrectionLevel: "M" }));
  }
  async function revoke() {
    setError("");
    const res = await fetch(`/api/invites/${invite.code}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => null))?.error ?? "Couldn't revoke.");
  }

  return (
    <div className="card" style={{ margin: "8px 0" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>{invite.note || "No note"}</strong>
          {invite.by && <span className="muted"> · made by {invite.by}</span>}
        </span>
        <span className="pill" style={{ flex: "none" }}>
          {open ? "open" : `used by ${invite.redeemedBy}`}
        </span>
      </div>
      {open && (
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" className="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="secondary" onClick={toggleQr}>
            {qr ? "Hide QR" : "Show QR"}
          </button>
          {invite.canRevoke && (
            <button type="button" className="secondary" onClick={revoke}>
              Revoke
            </button>
          )}
        </div>
      )}
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code for this invite link" width={200} height={200} style={{ marginTop: 8, background: "#fff" }} />
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function InviteList({ invites }: { invites: InviteRow[] }) {
  if (invites.length === 0) return <p className="muted">No invites yet.</p>;
  return (
    <>
      {invites.map((i) => (
        <Row key={i.code} invite={i} />
      ))}
    </>
  );
}
