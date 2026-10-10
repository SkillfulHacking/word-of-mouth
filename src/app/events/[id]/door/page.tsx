import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageEvent } from "@/lib/invites";
import { DoorScreen } from "./door-screen";

export const dynamic = "force-dynamic";

export default async function DoorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  const event = db.prepare("SELECT id, coordinator_id, codename FROM events WHERE id = ?").get(id) as
    | { id: string; coordinator_id: number; codename: string }
    | undefined;
  if (!event || !canManageEvent(user, event)) notFound();

  return (
    <>
      <p>
        <Link href={`/events/${id}`}>← Back to the event</Link>
      </p>
      <h1>Door: {event.codename}</h1>
      <DoorScreen eventId={id} />
    </>
  );
}
