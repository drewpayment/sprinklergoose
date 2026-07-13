"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
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

  const run = async (fn: () => Promise<{ error: { message?: string; statusText?: string } | null }>, ok: string) => {
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
    <div className="flex flex-col gap-3">
      {users.map((u) => {
        const self = u.id === currentUserId;
        return (
          <section
            key={u.id}
            className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <span className="block text-[15px] font-semibold break-words">
                  {u.name}
                  {self && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      (you)
                    </span>
                  )}
                </span>
                <span className="block text-[13px] text-muted-foreground break-all">
                  {u.email}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={u.role === "admin" ? "default" : "secondary"}
                  className="capitalize"
                >
                  {u.role}
                </Badge>
                {u.banned && <Badge variant="destructive">Disabled</Badge>}
              </div>
            </div>
            {!self && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="h-9 rounded-lg"
                  onClick={() =>
                    void run(
                      () =>
                        authClient.admin.setRole({
                          userId: u.id,
                          role: u.role === "admin" ? "member" : "admin",
                        }),
                      `${u.name} is now ${u.role === "admin" ? "a member" : "an admin"}`,
                    )
                  }
                >
                  Make {u.role === "admin" ? "member" : "admin"}
                </Button>
                {u.banned ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="h-9 rounded-lg"
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
                    className="h-9 rounded-lg text-destructive"
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
          </section>
        );
      })}

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
    fn: () => Promise<{ error: { message?: string; statusText?: string } | null }>,
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
    <Card className="mt-2 shadow-(--shadow-card)">
      <CardContent className="pt-5">
        <h3 className="mb-3 text-[15px] font-semibold">Add a person</h3>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input
              id="new-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl"
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. Share it with them; they can’t register
              themselves.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Role">
              {(["member", "admin"] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  variant={role === r ? "default" : "outline"}
                  onClick={() => setRole(r)}
                  className="h-11 flex-1 rounded-xl capitalize"
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={busy} className="mt-1 h-12 rounded-xl">
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
