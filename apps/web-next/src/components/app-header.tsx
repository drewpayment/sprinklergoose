"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { useSharedLiveStatus } from "@/components/live-status-provider";
import { useUnits } from "@/components/units-provider";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const primaryLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/schedules", label: "Schedules" },
  { href: "/history", label: "History" },
];

const adminLinks = [
  { href: "/admin/zones", label: "Zones" },
  { href: "/admin/weather", label: "Weather" },
  { href: "/admin/users", label: "Users" },
];

function isActive(pathname: string, href: string): boolean {
  return (
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
  );
}

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
  const { status, offline } = useSharedLiveStatus();

  const signOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  };

  const linkClass = (href: string) =>
    cn(
      "text-sm transition-colors",
      isActive(pathname, href)
        ? "font-extrabold text-primary"
        : "font-semibold text-muted-foreground hover:text-foreground",
    );

  return (
    <header className="border-b-2 border-border">
      <div className="mx-auto flex w-full max-w-md items-center gap-4 px-4 py-3 md:max-w-5xl md:gap-6 md:px-6">
        <Link href="/" aria-label="sprinklergoose — dashboard">
          <Brand markSize={26} wordmarkClassName="text-[16.5px] md:text-lg" />
        </Link>

        <nav className="hidden items-center gap-5 md:flex" aria-label="Main">
          {primaryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href) ? "page" : undefined}
              className={linkClass(l.href)}
            >
              {l.label}
            </Link>
          ))}
          {admin && (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-px bg-border"
              />
              {adminLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(pathname, l.href) ? "page" : undefined}
                  className={linkClass(l.href)}
                >
                  {l.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3 md:gap-4">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-[7px] flex-none rounded-full",
                offline
                  ? "pulse-dot bg-primary"
                  : "bg-foreground",
              )}
            />
            {offline ? (
              "offline"
            ) : (
              <>
                <span className="hidden md:inline">
                  {status?.controller?.model ?? "Controller"} ·{" "}
                </span>
                online
              </>
            )}
          </span>

          <button
            type="button"
            onClick={() => setUnits(units === "metric" ? "imperial" : "metric")}
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
            className="hidden text-[13px] font-extrabold text-muted-foreground hover:text-foreground md:inline"
          >
            {units === "metric" ? "°C" : "°F"}
          </button>

          <button
            type="button"
            onClick={signOut}
            aria-label={`Sign out ${userName}`}
            title={`Sign out (${userName})`}
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
          >
            <LogOut className="size-[19px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
