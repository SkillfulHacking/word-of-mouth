import { notFound } from "next/navigation";
import { OsmCredit } from "@/components/osm-credit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HuntPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = db.prepare("SELECT codename, zip, threshold FROM events WHERE id = ?").get(id) as
    | { codename: string; zip: string; threshold: number }
    | undefined;
  if (!event) notFound();
  const spots = db.prepare("SELECT idx, clue FROM event_spots WHERE event_id = ? ORDER BY idx").all(id) as {
    idx: number;
    clue: string;
  }[];

  const fromMap = !!db.prepare("SELECT 1 FROM event_spots WHERE event_id = ? AND osm_ref IS NOT NULL").get(id);

  return (
    <>
      <h1>{event.codename}</h1>
      <p className="muted">Somewhere in ZIP code {event.zip}</p>
      <p>
        {spots.length === 1 ? (
          <>One code is hiding nearby. Find it and scan it with your phone to reveal where and when.</>
        ) : event.threshold === 1 ? (
          <>{spots.length} codes are hiding nearby. Find any one of them and scan it to reveal where and when.</>
        ) : (
          <>
            {spots.length} codes are hiding nearby. Find any <strong>{event.threshold}</strong> and scan them with your
            phone, one after another. Together they reveal where and when.
          </>
        )}
      </p>
      <h2>Clues</h2>
      <ol>
        {spots.map((s) => (
          <li key={s.idx}>{s.clue}</li>
        ))}
      </ol>
      <p className="muted">Scan a code to see your progress. Codes you&apos;ve found are remembered on this phone only.</p>
      {fromMap && <OsmCredit />}
    </>
  );
}
