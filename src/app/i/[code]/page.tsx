import { currentUser } from "@/lib/auth";
import { inviteView } from "@/lib/invites";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = inviteView(code);

  // A used, revoked or made-up code says nothing about which event it belonged to.
  if (view.state !== "open") {
    return (
      <>
        <h1>This invite isn&apos;t available</h1>
        <p className="muted">It may have already been used, or the person who sent it took it back. Ask them for a new one.</p>
      </>
    );
  }

  const user = await currentUser();
  return (
    <>
      <h1>You&apos;re invited</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{view.codename}</h2>
        <p className="muted">Somewhere in ZIP code {view.zip}</p>
        <p>
          Someone thought of you for this one. Accepting gives you a ticket. The place and time stay secret: you&apos;ll
          have to find the hidden codes to learn them.
        </p>
      </div>
      <AcceptForm code={code} signedInAs={user?.username ?? null} />
    </>
  );
}
