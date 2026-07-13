import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth, type Session } from "./auth";

/** Resolve the Better Auth session for the current request (null if none). */
export async function getSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

export function isAdmin(session: Session): boolean {
  return session.user.role === "admin";
}

export function jsonError(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

export const unauthorized = () => jsonError(401, "unauthorized");
export const forbidden = () => jsonError(403, "forbidden");
