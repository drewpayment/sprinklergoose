import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getSession, isAdmin } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <Dashboard admin={isAdmin(session)} />;
}
