import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ac, roles } from "./permissions";
import { parseTrustedOrigins } from "./trusted-origins";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Origins allowed to call the auth endpoints, beyond BETTER_AUTH_URL.
  // Comma-separated env var; defaults cover localhost + 127.0.0.1 dev access.
  trustedOrigins: parseTrustedOrigins(process.env.TRUSTED_ORIGINS),
  emailAndPassword: {
    enabled: true,
    // Public registration is disabled: the seeded admin creates all accounts.
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      // "metric" | "imperial" display preference; users set their own via
      // authClient.updateUser. Stored weather values stay metric.
      units: {
        type: "string",
        defaultValue: "metric",
        input: true,
      },
    },
  },
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
