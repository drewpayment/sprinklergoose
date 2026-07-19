import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";

// Public landing page, served at `/` when nobody is signed in (the app
// layout renders it bare — no app chrome). Same Modernist system as the
// app: Archivo, red-on-off-white, zero radius, 2px rules, light + dark.

const FEATURES = [
  {
    kicker: "Live dashboard",
    title: "The whole yard, at a glance",
    body: "The dashboard's site plan is drawn from your real zone boundaries — not a list of station numbers. The running zone glows red with its countdown, one tap selects a zone, and Stop everything is always within reach.",
    image: "/marketing/dashboard.png",
    width: 2000,
    height: 1378,
    alt: "sprinklergoose dashboard: a site plan of the yard with a running zone counting down, next to a zone list with start buttons",
  },
  {
    kicker: "Zone map",
    title: "Zones on your actual property",
    body: "Draw each zone's boundary right on the satellite view of your yard and drop the home marker on your roof. “Mesa Verde” means the strip by the road because you drew it there — nobody has to memorize what station 4 is.",
    image: "/marketing/map.png",
    width: 2000,
    height: 1184,
    alt: "Satellite map with five colored zone boundaries drawn over a yard, plus current conditions and a 48-hour forecast panel",
  },
  {
    kicker: "Schedules",
    title: "Programs that run themselves",
    body: "Watering programs run from your server on your terms — the controller's own timers are never used. Weather-aware skips hold a run after real rain, before a storm, or in a freeze, and a rain delay pauses everything at once.",
    image: "/marketing/schedules.png",
    width: 2000,
    height: 656,
    alt: "Schedules page showing a daily morning lawn program with its next run time and run-now, edit, and delete controls",
  },
  {
    kicker: "History",
    title: "Every run, on the record",
    body: "Scheduled, quick run, skipped, or missed — every program run is logged with who or what started it and when. When a corner of the lawn goes brown, you can see exactly what happened.",
    image: "/marketing/history.png",
    width: 2000,
    height: 1657,
    alt: "History page listing program runs with statuses like running and completed, filterable by program and status",
  },
] as const;

const PILLARS = [
  {
    title: "Local-first",
    body: "Runs on your hardware and talks to the controller on your LAN. No cloud dependency, no vendor account, no telemetry.",
  },
  {
    title: "Weather-aware",
    body: "An hourly forecast drives skip decisions and shows you what's coming — watering predictions appear next to upcoming runs.",
  },
  {
    title: "For the household",
    body: "Admins manage zones, schedules, and users; members get the dashboard and quick runs. Installable as an app on any phone.",
  },
] as const;

export function MarketingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="border-b-2 border-border">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 md:px-6">
          <Brand wordmarkClassName="text-[17px]" />
          <Link
            href="/sign-in"
            className="inline-flex min-h-9 items-center bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-[var(--color-accent-600)]"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 md:px-6">
        {/* Hero */}
        <section className="border-b-2 border-border py-12 md:py-20">
          <p className="kicker mb-4 text-primary">
            Self-hosted irrigation control
          </p>
          <h1 className="max-w-3xl text-4xl leading-[1.05] font-extrabold tracking-[-0.02em] md:text-6xl">
            Your sprinklers.
            <br />
            Your server.
            <br />
            <span className="text-primary">No cloud.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:text-base">
            sprinklergoose turns a Rain&nbsp;Bird controller into a local-first
            smart irrigation system — a live map of your actual yard,
            weather-aware schedules, and a full run history. It runs on your
            own hardware and never phones home.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/sign-in"
              className="inline-flex min-h-12 items-center bg-primary px-6 text-[15px] font-extrabold text-primary-foreground hover:bg-[var(--color-accent-600)]"
            >
              Sign in to your yard
            </Link>
            <span className="text-[12.5px] text-muted-foreground">
              No public sign-up — your admin creates your account.
            </span>
          </div>
        </section>

        {/* Feature sections */}
        {FEATURES.map((f, i) => (
          <section
            key={f.kicker}
            className="grid grid-cols-1 items-center gap-6 border-b border-border py-10 md:grid-cols-2 md:gap-10 md:py-14"
          >
            <div className={i % 2 === 1 ? "md:order-2" : undefined}>
              <p className="kicker mb-3 text-primary">{f.kicker}</p>
              <h2 className="text-2xl font-extrabold tracking-[-0.01em] md:text-3xl">
                {f.title}
              </h2>
              <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
            <div className={i % 2 === 1 ? "md:order-1" : undefined}>
              <Image
                src={f.image}
                width={f.width}
                height={f.height}
                alt={f.alt}
                sizes="(min-width: 768px) 480px, 100vw"
                className="w-full border-2 border-border"
                priority={i === 0}
              />
            </div>
          </section>
        ))}

        {/* Pillars */}
        <section className="grid grid-cols-1 gap-px border-b-2 border-border bg-border md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-background py-8 md:px-6 md:first:pl-0 md:last:pr-0">
              <h3 className="text-[15px] font-extrabold">{p.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          ))}
        </section>

        {/* Closing CTA */}
        <section className="py-12 text-center md:py-16">
          <h2 className="text-2xl font-extrabold tracking-[-0.01em] md:text-3xl">
            Water the lawn, not the cloud.
          </h2>
          <div className="mt-6">
            <Link
              href="/sign-in"
              className="inline-flex min-h-12 items-center bg-primary px-6 text-[15px] font-extrabold text-primary-foreground hover:bg-[var(--color-accent-600)]"
            >
              Sign in
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 md:px-6">
          <Brand markSize={20} wordmarkClassName="text-[14px]" />
          <p className="text-[12px] text-muted-foreground">
            Local control for your Rain&nbsp;Bird system.
          </p>
        </div>
      </footer>
    </div>
  );
}
