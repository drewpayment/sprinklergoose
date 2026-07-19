import { ArrowLeft } from "lucide-react";
import Link from "next/link";

// Modernist page header: an optional mobile back link (desktop uses the top
// nav), a big Archivo-800 title, a muted description, and an optional action
// (e.g. a "New" button) pinned right.
export function PageHeading({
  title,
  description,
  back,
  action,
}: {
  title: string;
  description?: string;
  /** Mobile-only back link (md:hidden) — desktop relies on the top nav. */
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground md:hidden"
        >
          <ArrowLeft className="size-[18px]" strokeWidth={2} />
          {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl md:text-[26px]">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex-none">{action}</div>}
      </div>
    </div>
  );
}
