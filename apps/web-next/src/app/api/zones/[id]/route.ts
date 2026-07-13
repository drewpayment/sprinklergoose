import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { zones } from "@/db/schema";
import {
  forbidden,
  getSession,
  isAdmin,
  jsonError,
  unauthorized,
} from "@/lib/session";

/**
 * Admin-only zone config: rename and/or enable/disable. Writes the app DB
 * (the zones table is the source of truth; the executor reads it — the old
 * executor rename endpoint is not used by this app).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return jsonError(404, "unknown zone");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError(422, "invalid body");
  }

  const patch: { name?: string; enabled?: boolean } = {};
  if ("name" in body) {
    if (typeof body.name !== "string") return jsonError(422, "invalid name");
    const name = body.name.trim();
    if (name.length < 1 || name.length > 40) {
      return jsonError(422, "name must be 1-40 characters");
    }
    patch.name = name;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return jsonError(422, "invalid enabled flag");
    }
    patch.enabled = body.enabled;
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(422, "nothing to update");
  }

  const [updated] = await db
    .update(zones)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(zones.id, id))
    .returning();
  if (!updated) return jsonError(404, "unknown zone");

  return NextResponse.json(updated);
}
