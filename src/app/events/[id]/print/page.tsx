"use client";

import QRCode from "qrcode";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Share = { idx: number; share: string; label: string; clue: string };
type Card = { key: string; title: string; url: string; qr: string; place?: string; secret: boolean };

type NdefWriter = { write(message: unknown): Promise<void> };
type NdefCtor = new () => NdefWriter;

export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [codename, setCodename] = useState("");
  const [status, setStatus] = useState("");
  const [nfcOk, setNfcOk] = useState(false);

  useEffect(() => {
    setNfcOk("NDEFReader" in window);
    const raw = sessionStorage.getItem(`wom:print:${id}`);
    if (!raw) {
      setCards([]);
      return;
    }
    const { codename, shares } = JSON.parse(raw) as { codename: string; shares: Share[] };
    setCodename(codename);
    const origin = location.origin;
    const defs = [
      { key: "flyer", title: "Flyer: hunt page", url: `${origin}/e/${id}`, secret: false, place: "Public. Goes on the flyer." },
      ...shares.map((s) => ({
        key: `s${s.idx}`,
        title: `Shard ${s.idx}`,
        // The shard rides in the #fragment, which browsers never send to a server.
        url: `${origin}/s/${id}#${s.idx}.${s.share}`,
        secret: true,
        place: `Place at: ${s.label}`,
      })),
    ];
    Promise.all(defs.map((d) => QRCode.toDataURL(d.url, { errorCorrectionLevel: "M", margin: 1, width: 320 }))).then(
      (qrs) => setCards(defs.map((d, i) => ({ ...d, qr: qrs[i] }))),
    );
  }, [id]);

  async function writeNfc(card: Card) {
    const NDEF = (window as unknown as { NDEFReader?: NdefCtor }).NDEFReader;
    if (!NDEF) return;
    setStatus(`Hold a blank tag to the back of your phone for "${card.title}"…`);
    try {
      await new NDEF().write({ records: [{ recordType: "url", data: card.url }] });
      setStatus(`Wrote "${card.title}" to the tag.`);
    } catch (e) {
      setStatus(`NFC write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (cards === null) return <p className="muted">Rendering codes…</p>;
  if (cards.length === 0) {
    return (
      <>
        <h1>Shards already shown</h1>
        <p>
          For safety the server never keeps the shard codes, and this browser no longer has them. If you didn&apos;t
          save the sheet, create the event again.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="noprint">
        <h1>{codename}: shard sheet</h1>
        <p className="muted">
          This is the only time these codes exist outside the printed paper and the tags. Print now, or write them to NFC
          tags. Laminate or sleeve anything that will live outdoors.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <button onClick={() => window.print()}>Print sheet</button>
        </div>
        <p className="muted">
          {nfcOk
            ? "NFC writing is available on this device (Chrome on Android, over HTTPS)."
            : "NFC writing needs Chrome on Android over HTTPS. QR printing works everywhere."}
        </p>
        {status && <p role="status">{status}</p>}
      </div>
      <div className="sheet">
        {cards.map((c) => (
          <div className="tag" key={c.key}>
            <div className="n">{c.title}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.qr} alt={`QR code for ${c.title}`} />
            <div className="place">{c.place}</div>
            {nfcOk && (
              <button className="secondary noprint" style={{ marginTop: 8 }} onClick={() => writeNfc(c)}>
                Write to NFC tag
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
