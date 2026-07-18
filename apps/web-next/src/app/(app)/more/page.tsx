import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MoreMenu } from "@/components/more-menu";
import { db } from "@/db";
import { weatherSettings, zones } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "More — Sprinkler" };
export const dynamic = "force-dynamic";

// The mobile "home" for everything the old top nav crammed in — admin config,
// preferences (units + theme), controller info, sign-out — so daily use stays
// a clean four-tab bar. On desktop these live in the top nav; this route still
// works there but the bottom bar that surfaces it is mobile-only.
export default async function MorePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const admin = isAdmin(session);

  let zonesTotal = 0;
  let zonesOff = 0;
  let usersCount = 0;
  let weatherEnabled = false;

  if (admin) {
    const zoneRows = await db.select().from(zones);
    zonesTotal = zoneRows.length;
    zonesOff = zoneRows.filter((z) => !z.enabled).length;

    const [settings] = await db
      .select()
      .from(weatherSettings)
      .where(eq(weatherSettings.id, 1));
    weatherEnabled = settings?.enabled ?? false;

    const { users, total } = await auth.api.listUsers({
      headers: await headers(),
      query: { limit: 200 },
    });
    usersCount = total ?? users.length;
  }

  return (
    <main>
      <MoreMenu
        admin={admin}
        userName={session.user.name}
        zonesTotal={zonesTotal}
        zonesOff={zonesOff}
        usersCount={usersCount}
        weatherEnabled={weatherEnabled}
      />
    </main>
  );
}
