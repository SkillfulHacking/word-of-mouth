import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const tickets = db
    .prepare(
      `SELECT t.id, t.event_id AS eventId, e.codename, e.zip, cu.username AS invitedBy,
              EXISTS (SELECT 1 FROM door_passes dp WHERE dp.ticket_id = t.id) AS hasPass
       FROM tickets t
       JOIN events e ON e.id = t.event_id
       JOIN invites i ON i.code = t.invite_code
       JOIN users cu ON cu.id = i.created_by
       WHERE t.user_id = ? ORDER BY t.created_at DESC`,
    )
    .all(user.id) as { id: string; eventId: string; codename: string; zip: string; invitedBy: string; hasPass: number }[];

  return (
    <>
      <h1>Your tickets</h1>
      {tickets.length === 0 && <p className="muted">You don&apos;t have any tickets yet. They arrive as invite links from people who want you there.</p>}
      {tickets.map((t) => (
        <div className="card" key={t.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{t.codename}</h2>
            <span className="pill" style={{ flex: "none" }}>
              valid
            </span>
          </div>
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            Somewhere in ZIP code {t.zip} · invited by {t.invitedBy}
          </p>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.5rem", letterSpacing: 2, margin: "0 0 12px" }} aria-label={`Ticket number ${t.id}`}>
            {t.id}
          </p>
          <p>
            {t.hasPass ? (
              <>
                Door pass: <strong>ready</strong> · <Link href={`/pass/${t.eventId}`}>details</Link>
              </>
            ) : (
              <Link className="btn" href={`/pass/${t.eventId}`}>
                Set up your door pass
              </Link>
            )}
          </p>
          <p>
            Your ticket doesn&apos;t say where the party is. <Link href={`/e/${t.eventId}`}>Start the hunt</Link> and find the hidden codes.
          </p>
        </div>
      ))}
    </>
  );
}
