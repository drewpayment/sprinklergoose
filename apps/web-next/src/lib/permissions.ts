import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Roles for the admin plugin: `admin` (full user management) and `member`
 * (no admin capabilities). Shared by the server plugin and the client plugin
 * so "member" is a typed role everywhere.
 */
export const ac = createAccessControl(defaultStatements);

export const roles = {
  admin: ac.newRole(adminAc.statements),
  member: ac.newRole({}),
};
