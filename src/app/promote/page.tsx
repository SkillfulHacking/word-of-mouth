import Link from "next/link";
import { redirect } from "next/navigation";
import { can, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotaFor } from "@/lib/invites";
import { InviteList, type InviteRow } from "@/components/invite-list";
import { MintForm } from "@/components/mint-form";

export const dynamic = "force-dynamic";

type Ev = { id: string; codename: string; zip: string };

export default async function PromotePage() {
  const user = await currentUser();
  if (!can(user, "promoter", "coordinator")) redirect("/login");

  // Promoters see the events they're assigned to; a coordinator sees their own; an admin sees all.
  const events = (
    user.role === "admin"
      ? db.prepare("SELECT id, codename, zip FROM events ORDER BY created_at DESC").all()
      : user.role === "coordinator"
        ? db.prepare("SELECT id, codename, zip FROM events WHERE coordinator_id = ? ORDER BY created_at DESC").all(user.id)
        : db
            .prepare("SELECT e.id, e.codename, e.zip FROM events e JOIN event_promoters ep ON ep.event_id = e.id WHERE ep.promoter_id = ? ORDER BY e.created_at DESC")
            .all(user.id)
  ) as Ev[];

  return (
    <>
      <h1>Spread the word</h1>
      <p className="muted">
        Each invite is a single-use link that also works as a sign-up page. Send it to someone you actually want there,
        or show them the QR code in person.
      </p>
      {events.length === 0 && <p>You haven&apos;t been assigned to any events yet. Ask the event coordinator.</p>}
      {events.map((ev) => {
        const limited = user.role === "promoter";
        const { quota, used } = quotaFor(ev.id, user.id);
        const left = quota - used;
        const mine = (
          db
            .prepare(
              `SELECT i.code, i.note, ru.username AS redeemedBy
               FROM invites i LEFT JOIN users ru ON ru.id = i.redeemed_by
               WHERE i.event_id = ? AND i.created_by = ? ORDER BY i.created_at DESC`,
            )
            .all(ev.id, user.id) as { code: string; note: string; redeemedBy: string | null }[]
        ).map((i): InviteRow => ({ ...i, canRevoke: true }));

        return (
          <section key={ev.id}>
            <h2>
              {ev.codename} <span className="muted">· ZIP {ev.zip}</span>
            </h2>
            {limited && (
              <p>
                <strong>
                  {left} of {quota}
                </strong>{" "}
                invites left
              </p>
            )}
            {!limited && (
              <p className="muted">
                You can send unlimited invites. Manage everyone from <Link href={`/events/${ev.id}`}>the event page</Link>.
              </p>
            )}
            <div className="card">
              <MintForm eventId={ev.id} disabled={limited && left <= 0} />
            </div>
            <InviteList invites={mine} />
          </section>
        );
      })}
    </>
  );
}
