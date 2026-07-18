import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { LiveStatusProvider } from "@/components/live-status-provider";
import { UnitsProvider } from "@/components/units-provider";
import { getSession, isAdmin } from "@/lib/session";
import { normalizeUnits } from "@/lib/units";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <UnitsProvider initialUnits={normalizeUnits(session.user.units)}>
      <LiveStatusProvider>
        <div className="flex min-h-dvh flex-col">
          <AppHeader admin={isAdmin(session)} userName={session.user.name} />
          <div className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-[calc(88px+env(safe-area-inset-bottom))] md:max-w-5xl md:px-6 md:pt-6 md:pb-10">
            {children}
          </div>
          <BottomNav />
        </div>
      </LiveStatusProvider>
    </UnitsProvider>
  );
}
