import { NextResponse, type NextRequest } from "next/server";
import { executor, ExecutorError } from "@/lib/executor";
import {
  forbidden,
  getSession,
  isAdmin,
  jsonError,
  unauthorized,
} from "@/lib/session";

/** Any authenticated user may view the rain delay. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const result = await executor.getRainDelay();
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExecutorError) return jsonError(e.status, e.detail);
    throw e;
  }
}

/** Only admins may set the rain delay (authorization matrix, M1 spec). */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const body = await request.json().catch(() => null);
  const days = body?.days;
  if (!Number.isInteger(days) || days < 0 || days > 14) {
    return jsonError(422, "days must be an integer between 0 and 14");
  }

  try {
    const result = await executor.setRainDelay(days);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExecutorError) return jsonError(e.status, e.detail);
    throw e;
  }
}
