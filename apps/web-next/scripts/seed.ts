/**
 * Seed script (idempotent): creates the initial admin from ADMIN_EMAIL /
 * ADMIN_PASSWORD and inserts the 7 zone rows (1-5 enabled, 6-7 disabled —
 * unwired expansion slots). Run after `npm run db:migrate`.
 *
 * IMPORTANT: a row must exist for ALL 7 stations — the executor treats a
 * station with no row as disabled.
 */
import "dotenv/config";
import { db } from "../src/db";
import { zones } from "../src/db/schema";
import { auth } from "../src/lib/auth";

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    console.log(`admin ${email} already exists — skipping`);
    return;
  }

  const user = await ctx.internalAdapter.createUser({
    email,
    name: "Admin",
    emailVerified: true,
    role: "admin",
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  console.log(`created admin ${email}`);
}

async function seedZones() {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    name: `Zone ${i + 1}`,
    enabled: i + 1 <= 5,
  }));
  const inserted = await db
    .insert(zones)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: zones.id });
  console.log(
    inserted.length > 0
      ? `seeded zones: ${inserted.map((r) => r.id).join(", ")} (1-5 enabled, 6-7 disabled)`
      : "zones already seeded — skipping",
  );
}

async function main() {
  await seedAdmin();
  await seedZones();
  console.log("seed complete");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
