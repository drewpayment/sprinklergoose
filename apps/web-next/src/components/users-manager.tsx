"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async (
    fn: () => Promise<{
      error: { message?: string; statusText?: string } | null;
    }>,
    ok: string,
  ) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(error.message ?? error.statusText ?? "Request failed");
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  };

  return (
    <div>
      <div className="border-2 border-border">
        {users.map((u) => {
          const self = u.id === currentUserId;
          const admin = u.role === "admin";
          return (
            <div key={u.id} className="border-t border-border px-4 py-3.5 first:border-t-0">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-[38px] flex-none items-center justify-center text-[15px] font-extrabold",
                    admin
                      ? "bg-primary text-primary-foreground"
                      : "bg-[color-mix(in_srgb,var(--color-ink)_12%,transparent)] text-foreground",
                  )}
                >
                  {initials(u.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] leading-tight font-extrabold break-words">
                    {u.name}
                    {self && (
                      <span className="font-semibold text-[11.5px] text-muted-foreground">
                        {" "}
                        · you
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground break-all">
                    {u.email}
                  </div>
                </div>
                <Badge variant={admin ? "default" : "secondary"} className="capitalize">
                  {u.role}
                </Badge>
                {u.banned && <Badge variant="outline">Disabled</Badge>}
              </div>

              {!self && (
                <div className="mt-2.5 flex flex-wrap gap-2 pl-[50px]">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="min-h-9"
                    onClick={() =>
                      void run(
                        () =>
                          authClient.admin.setRole({
                            userId: u.id,
                            role: admin ? "member" : "admin",
                          }),
                        `${u.name} is now ${admin ? "a member" : "an admin"}`,
                      )
                    }
                  >
                    Make {admin ? "member" : "admin"}
                  </Button>
                  {u.banned ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="min-h-9"
                      onClick={() =>
                        void run(
                          () => authClient.admin.unbanUser({ userId: u.id }),
                          `${u.name} re-enabled`,
                        )
                      }
                    >
                      Enable account
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="min-h-9 text-primary"
                      onClick={() =>
                        void run(
                          () => authClient.admin.banUser({ userId: u.id }),
                          `${u.name} disabled`,
                        )
                      }
                    >
                      Disable account
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-l-[3px] border-l-primary border border-border p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Roles:</strong> members view status
        &amp; history, start/stop zones, run programs and Quick Run. Admins
        additionally set rain delay, weather, zones and users.
      </div>

      <CreateUserForm busy={busy} onCreate={run} />
    </div>
  );
}

function CreateUserForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (
    fn: () => Promise<{
      error: { message?: string; statusText?: string } | null;
    }>,
    ok: string,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onCreate(
      () =>
        authClient.admin.createUser({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
        }),
      `Account created for ${name.trim()}`,
    );
    if (ok) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
    }
  };

  return (
    <section className="mt-5 border-2 border-border p-4">
      <h3 className="kicker mb-3 text-primary">Add a person</h3>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id="new-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-email" className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input
            id="new-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="new-password"
            className="text-xs text-muted-foreground"
          >
            Password
          </Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11"
          />
          <p className="text-xs text-muted-foreground">
            At least 8 characters. Share it with them; they can’t register
            themselves.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Role</Label>
          <div
            className="inline-flex border border-border"
            role="radiogroup"
            aria-label="Role"
          >
            {(["member", "admin"] as const).map((r, i) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  "min-h-11 flex-1 px-6 text-sm font-semibold capitalize",
                  i > 0 && "border-l border-border",
                  role === r
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-foreground/[0.07]",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={busy} className="mt-1 min-h-12 justify-center">
          Create account
        </Button>
      </form>
    </section>
  );
}
