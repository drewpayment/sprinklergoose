"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(
        error.status === 403 || error.status === 401
          ? "Wrong email or password, or your account is disabled."
          : (error.message ?? "Sign-in failed. Try again."),
      );
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-xs text-muted-foreground">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-xs text-muted-foreground">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-11"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-primary">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy}
        className="mt-1 min-h-[50px] w-full justify-start text-[15px]"
      >
        {busy ? "Signing in…" : "Sign in"}
        <ArrowRight className="ml-auto size-[17px]" strokeWidth={2.2} />
      </Button>
    </form>
  );
}
