import { redirect } from "next/navigation";
import { can, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewUserForm } from "./new-user-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await currentUser();
  if (!can(user, "admin")) redirect("/login");

  const users = db.prepare("SELECT id, username, role, created_at FROM users ORDER BY id").all() as {
    id: number;
    username: string;
    role: string;
    created_at: number;
  }[];

  return (
    <>
      <h1>Users and roles</h1>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>
                <span className="pill">{u.role}</span>
              </td>
              <td className="muted">{new Date(u.created_at * 1000).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Add a user</h2>
      <NewUserForm />
    </>
  );
}
