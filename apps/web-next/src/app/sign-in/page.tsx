import type { Metadata } from "next";
import { GooseMark } from "@/components/brand";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in — Sprinkler" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <GooseMark size={52} className="mb-4" />
      <div className="text-[26px] leading-none font-extrabold tracking-[-0.02em] lowercase">
        sprinklergoose
      </div>
      <p className="mt-3 mb-7 max-w-[30ch] text-sm text-muted-foreground">
        Local control for your Rain Bird system. No cloud, no account to create.
      </p>
      <SignInForm />
      <p className="mt-5 text-[12.5px] text-muted-foreground">
        No account? Your admin creates it — public sign-up is off.
      </p>
    </main>
  );
}
