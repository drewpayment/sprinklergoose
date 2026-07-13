import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UsersManager } from "@/components/users-manager";
import { auth } from "@/lib/auth";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Users — Sprinkler" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) redirect("/");

  const { users } = await auth.api.listUsers({
    headers: await headers(),
    query: { limit: 100, sortBy: "createdAt", sortDirection: "asc" },
  });

  return (
    <main>
      <h2 className="mb-1 text-lg font-semibold">Users</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Household accounts. Members can water enabled zones; admins can also
        manage zones, users and the rain delay.
      </p>
      <UsersManager
        currentUserId={session.user.id}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role ?? "member",
          banned: u.banned ?? false,
        }))}
      />
    </main>
  );
}
