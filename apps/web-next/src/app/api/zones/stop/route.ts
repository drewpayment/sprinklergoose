import { NextResponse } from "next/server";
import { executor, ExecutorError } from "@/lib/executor";
import { getSession, jsonError, unauthorized } from "@/lib/session";

/** Stop all irrigation (the executor's only stop primitive). */
export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const result = await executor.stopAll();
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExecutorError) return jsonError(e.status, e.detail);
    throw e;
  }
}
