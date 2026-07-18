import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
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
      <PageHeading
        title="Users"
        description="You create every account — public sign-up is off. Members can run zones; admins configure."
        back={{ href: "/more", label: "More" }}
      />
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
