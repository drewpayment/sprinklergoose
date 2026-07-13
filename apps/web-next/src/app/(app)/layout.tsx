import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getSession, isAdmin } from "@/lib/session";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] md:max-w-4xl md:pt-8">
      <AppHeader admin={isAdmin(session)} userName={session.user.name} />
      {children}
    </div>
  );
}
