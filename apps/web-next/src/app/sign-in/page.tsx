import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in — Sprinkler" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Sprinkler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to control watering
        </p>
      </div>
      <SignInForm />
    </main>
  );
}
