import Link from "next/link";
import { redirect } from "next/navigation";
import { can, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const user = await currentUser();
  if (!can(user, "coordinator")) redirect("/login");

  // A coordinator sees only their own events; an admin sees everything.
  const events = db
    .prepare(
      `SELECT e.id, e.codename, e.zip, e.threshold, e.created_at,
              (SELECT COUNT(*) FROM event_spots s WHERE s.event_id = e.id) AS spots
       FROM events e WHERE (? = 'admin' OR e.coordinator_id = ?) ORDER BY e.created_at DESC`,
    )
    .all(user.role, user.id) as { id: string; codename: string; zip: string; threshold: number; created_at: number; spots: number }[];

  return (
    <>
      <h1>Events</h1>
      <p>
        <Link className="btn" href="/events/new">
          New event
        </Link>
      </p>
      {events.length === 0 && <p className="muted">No events yet.</p>}
      {events.map((e) => (
        <div className="card" key={e.id}>
          <strong>{e.codename}</strong> <span className="muted">· ZIP {e.zip}</span>
          <div className="muted">
            Collect {e.threshold} of {e.spots} shards to unlock
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Link href={`/events/${e.id}`}>Invites and tickets</Link>
            <Link href={`/e/${e.id}`}>Public hunt page</Link>
          </div>
        </div>
      ))}
    </>
  );
}
