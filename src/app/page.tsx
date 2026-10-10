import Link from "next/link";
import { can, currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();

  return (
    <>
      <h1>Word of Mouth</h1>
      <p className="muted">
        Private events you can only find by walking to them. The when-and-where is encrypted; the key is split across
        QR codes and NFC tags hidden around a short walk.
      </p>
      {!user && (
        <p>
          <Link className="btn" href="/login">
            Sign in
          </Link>
        </p>
      )}
      {user && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your tools</h2>
          <ul>
            {can(user, "admin") && (
              <li>
                <Link href="/admin/users">Manage users and roles</Link>
              </li>
            )}
            {can(user, "coordinator") && (
              <li>
                <Link href="/events">Events and shard sheets</Link>
              </li>
            )}
            {can(user, "promoter", "coordinator") && (
              <li>
                <Link href="/promote">Send invites</Link>
              </li>
            )}
            <li>
              <Link href="/tickets">Your tickets</Link>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
