"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useUnits } from "@/components/units-provider";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const links = (admin: boolean) => [
  { href: "/", label: "Dashboard" },
  { href: "/map", label: "Map" },
  { href: "/schedules", label: "Schedules" },
  { href: "/history", label: "History" },
  ...(admin
    ? [
        { href: "/admin/zones", label: "Zones" },
        { href: "/admin/weather", label: "Weather" },
        { href: "/admin/users", label: "Users" },
      ]
    : []),
];

export function AppHeader({
  admin,
  userName,
}: {
  admin: boolean;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { units, setUnits } = useUnits();

  const signOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
        <Link href="/">Sprinkler</Link>
      </h1>
      <div className="flex items-center gap-0.5 md:gap-1">
        <nav className="flex items-center gap-0.5 md:gap-1" aria-label="Main">
          {links(admin).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-lg px-1.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground md:px-3 md:text-sm",
                (pathname === l.href ||
                  (l.href !== "/" && pathname.startsWith(`${l.href}/`))) &&
                  "bg-secondary text-secondary-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          onClick={() =>
            setUnits(units === "metric" ? "imperial" : "metric")
          }
          aria-label={
            units === "metric"
              ? "Switch to imperial units (°F, inches)"
              : "Switch to metric units (°C, mm)"
          }
          title={
            units === "metric"
              ? "Units: °C / mm — switch to °F / in"
              : "Units: °F / in — switch to °C / mm"
          }
          className="text-[13px] font-semibold text-muted-foreground"
        >
          {units === "metric" ? "°C" : "°F"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          aria-label={`Sign out ${userName}`}
          title={`Sign out (${userName})`}
          className="text-muted-foreground"
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
