"use client";

import { CalendarDays, Droplet, History, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Mobile bottom tab bar — the daily-use nav (replaces the old cramped 7-item
// top nav). Admin config lives under More. Active cell = red icon/label with a
// 2px accent top rule pulled up onto the divider.
const tabs = [
  { href: "/", label: "Home", Icon: Droplet },
  { href: "/schedules", label: "Schedules", Icon: CalendarDays },
  { href: "/history", label: "History", Icon: History },
  { href: "/more", label: "More", Icon: Menu },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/more")
    // More is the mobile home for admin + preferences.
    return (
      pathname === "/more" ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/more/")
    );
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t-2 border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-[3px] py-2.5 text-muted-foreground",
              active && "-mt-0.5 border-t-2 border-primary text-primary",
            )}
          >
            <Icon
              className="size-5"
              strokeWidth={active ? 1.9 : 1.8}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-[10px]",
                active ? "font-extrabold" : "font-bold",
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
