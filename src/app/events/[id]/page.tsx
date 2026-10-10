import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageEvent } from "@/lib/invites";
import { InviteList, type InviteRow } from "@/components/invite-list";
import { MintForm } from "@/components/mint-form";
import { BulkInviteForm } from "@/components/bulk-invite-form";
import { BatchList, type BatchRow } from "@/components/batch-list";
import { AssignPromoterForm, RemovePromoterButton } from "./assign-promoter-form";
import { ImageStudio } from "./image-studio";
import { LookAndFeel } from "./look-and-feel";

export const dynamic = "force-dynamic";

export default async function ManageEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  const event = db.prepare("SELECT id, coordinator_id, codename, zip, threshold, theme FROM events WHERE id = ?").get(id) as
    | { id: string; coordinator_id: number; codename: string; zip: string; threshold: number; theme: string }
    | undefined;
  if (!event || !canManageEvent(user, event)) notFound();

  const assigned = db
    .prepare(
      `SELECT u.id, u.username, ep.quota,
              (SELECT COUNT(*) FROM invites i WHERE i.event_id = ep.event_id AND i.created_by = ep.promoter_id) AS used
       FROM event_promoters ep JOIN users u ON u.id = ep.promoter_id WHERE ep.event_id = ? ORDER BY u.username`,
    )
    .all(id) as { id: number; username: string; quota: number; used: number }[];
  const promoters = db.prepare("SELECT id, username FROM users WHERE role = 'promoter' ORDER BY username").all() as { id: number; username: string }[];
  const invites = (
    db
      .prepare(
        `SELECT i.code, i.note, cu.username AS by, ru.username AS redeemedBy
         FROM invites i JOIN users cu ON cu.id = i.created_by LEFT JOIN users ru ON ru.id = i.redeemed_by
         WHERE i.event_id = ? AND i.batch IS NULL ORDER BY i.created_at DESC`,
      )
      .all(id) as { code: string; note: string; by: string; redeemedBy: string | null }[]
  ).map((i): InviteRow => ({ ...i, canRevoke: true }));
  const batches = db
    .prepare(
      `SELECT i.batch, MAX(i.note) AS note, COUNT(*) AS total, SUM(i.redeemed_by IS NULL) AS open, MAX(cu.username) AS by
       FROM invites i JOIN users cu ON cu.id = i.created_by
       WHERE i.event_id = ? AND i.batch IS NOT NULL GROUP BY i.batch ORDER BY MIN(i.created_at) DESC, MIN(i.rowid) DESC LIMIT 20`,
    )
    .all(id) as BatchRow[];
  const tickets = db
    .prepare("SELECT t.id, u.username FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.event_id = ? ORDER BY t.created_at")
    .all(id) as { id: string; username: string }[];

  return (
    <>
      <p>
        <Link href="/events">← All events</Link>
      </p>
      <h1>{event.codename}</h1>
      <p className="muted">
        ZIP {event.zip} · <Link href={`/e/${event.id}`}>public hunt page</Link>
      </p>

      <p>
        <Link className="btn" href={`/events/${id}/door`}>
          Open the door
        </Link>
      </p>

      <h2>Look and feel</h2>
      <LookAndFeel eventId={id} initial={event.theme} />

      <h2>Event image</h2>
      <ImageStudio eventId={id} />

      <h2>Promoters</h2>
      <p className="muted">A promoter can send this many single-use invites. You can always send invites yourself, with no limit.</p>
      {assigned.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Promoter</th>
              <th>Sent</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assigned.map((p) => (
              <tr key={p.id}>
                <td>{p.username}</td>
                <td>
                  {p.used} of {p.quota}
                </td>
                <td style={{ textAlign: "right" }}>
                  <RemovePromoterButton eventId={id} promoterId={p.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="card">
        <AssignPromoterForm eventId={id} promoters={promoters} />
      </div>

      <h2>Invites ({invites.length})</h2>
      <div className="card">
        <MintForm eventId={id} />
      </div>
      <InviteList invites={invites} />

      <h3 style={{ margin: "16px 0 4px" }}>Print a batch</h3>
      <div className="card">
        <BulkInviteForm eventId={id} max={null} />
      </div>
      <BatchList eventId={id} batches={batches} />
      <p>
        <Link href={`/print/invites/${id}`}>Print every unused invite</Link>
      </p>

      <h2>Tickets ({tickets.length})</h2>
      {tickets.length === 0 ? (
        <p className="muted">Nobody has accepted an invite yet.</p>
      ) : (
        <table>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>{t.username}</td>
                <td className="muted">{t.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
