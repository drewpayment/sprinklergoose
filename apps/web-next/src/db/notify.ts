import "server-only";
import { sql } from "drizzle-orm";
import { db } from ".";

/**
 * Change signal for the executor (docs/M2-SPEC.md): fired after any write to
 * programs / program_steps / run_requests. The executor LISTENs on this
 * channel and also polls every 15s, so NOTIFY is an optimization — a failure
 * here must never fail the mutation that already committed.
 */
export async function notifySprinklerEvents(): Promise<void> {
  try {
    await db.execute(sql`NOTIFY sprinkler_events`);
  } catch (e) {
    console.error("NOTIFY sprinkler_events failed", e);
  }
}
