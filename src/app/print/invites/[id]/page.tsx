import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { coverId } from "@/lib/event-images";
import { printData } from "@/lib/invites";
import { InviteSheet } from "./invite-sheet";

export const dynamic = "force-dynamic";

export default async function PrintInvitesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ batch?: string }> }) {
  const { id } = await params;
  const { batch } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const data = printData(user, id, batch);
  if (!data.ok) notFound();

  return <InviteSheet event={data.event} invites={data.invites} defaultBase={process.env.PUBLIC_BASE_URL ?? ""} batch={batch ?? null} coverUrl={coverId(id) ? `/api/images/${coverId(id)}?v=full` : null} />;
}
