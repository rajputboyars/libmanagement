/** Roles that must have two-step sign-in. Staff and students may opt in but are never forced. */
const PRIVILEGED = new Set(["owner", "super-admin"]);
export const requiresTwoFactor = (role: string | undefined) => !!role && PRIVILEGED.has(role);
