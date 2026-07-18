"use client";

import { ChevronRight, LogOut, MapPin, Users } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSharedLiveStatus } from "@/components/live-status-provider";
import { useUnits } from "@/components/units-provider";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

function CloudIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 6.5 19Z" />
    </svg>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex border border-border text-xs"
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "px-3 py-1.5 font-semibold",
            i > 0 && "border-l border-border",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-foreground/[0.07]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MoreMenu({
  admin,
  userName,
  zonesTotal,
  zonesOff,
  usersCount,
  weatherEnabled,
}: {
  admin: boolean;
  userName: string;
  zonesTotal: number;
  zonesOff: number;
  usersCount: number;
  weatherEnabled: boolean;
}) {
  const router = useRouter();
  const { units, setUnits } = useUnits();
  const { theme, setTheme } = useTheme();
  const { status, offline } = useSharedLiveStatus();
  // next-themes is only correct after hydration; gate the Theme control's
  // selected state on mount to avoid an SSR/client mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  };

  const adminRows = [
    {
      href: "/admin/zones",
      label: "Zones",
      meta: `${zonesTotal}${zonesOff > 0 ? ` · ${zonesOff} off` : ""}`,
      Icon: MapPin,
    },
    {
      href: "/admin/weather",
      label: "Weather skip",
      meta: weatherEnabled ? "On" : "Off",
      Icon: CloudIcon,
    },
    {
      href: "/admin/users",
      label: "Users",
      meta: String(usersCount),
      Icon: Users,
    },
  ];

  return (
    <div className="border-t-2 border-border">
      {admin && (
        <section>
          <h3 className="kicker px-1 pt-4 pb-2 text-primary">Admin</h3>
          {adminRows.map(({ href, label, meta, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3.5 border-t border-border px-1 py-3.5"
            >
              <Icon className="size-5 flex-none" aria-hidden="true" />
              <span className="flex-1 text-[15px] font-bold">{label}</span>
              <span className="text-[11.5px] text-muted-foreground">
                {meta}
              </span>
              <ChevronRight
                className="size-[18px] text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          ))}
        </section>
      )}

      <section>
        <h3 className="kicker border-t-2 border-border px-1 pt-4 pb-2 text-primary">
          Preferences
        </h3>
        <div className="flex items-center gap-3 border-t border-border px-1 py-3">
          <span className="flex-1 text-[15px] font-bold">Units</span>
          <Segmented
            ariaLabel="Units"
            value={units}
            onChange={setUnits}
            options={[
              { value: "metric", label: "°C · mm" },
              { value: "imperial", label: "°F · in" },
            ]}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-border px-1 py-3">
          <span className="flex-1 text-[15px] font-bold">Theme</span>
          <Segmented
            ariaLabel="Theme"
            value={mounted ? (theme as string) : undefined}
            onChange={setTheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </section>

      <section>
        <h3 className="kicker border-t-2 border-border px-1 pt-4 pb-2 text-primary">
          Controller
        </h3>
        <div className="border-t border-border px-1 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {status?.controller ? (
            <>
              {status.controller.model} · firmware {status.controller.firmware}
              <br />
              {offline ? "Offline — retrying" : "Reachable"}
              <br />
              Rain delay:{" "}
              {status.rain_delay_days > 0
                ? `${status.rain_delay_days} day${
                    status.rain_delay_days === 1 ? "" : "s"
                  }`
                : "off"}
            </>
          ) : (
            "Connecting to controller…"
          )}
        </div>
      </section>

      <div className="border-t-2 border-border py-4">
        <button
          type="button"
          onClick={signOut}
          className="flex min-h-12 w-full items-center gap-2 border border-border px-4 text-sm font-extrabold text-primary hover:bg-foreground/[0.07]"
        >
          <LogOut className="size-[17px]" strokeWidth={1.9} aria-hidden="true" />
          Sign out — {userName}
        </button>
      </div>
    </div>
  );
}
