import type { User } from "@privy-io/server-auth";
import { extractIdentity } from "./auth";

export function loadStaffEmails(): string[] {
  return (process.env.STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function anyStaffConfigured(): boolean {
  return loadStaffEmails().length > 0;
}

export async function isStaffMember(user: User | null | undefined): Promise<boolean> {
  const staff = loadStaffEmails();
  if (staff.length === 0 || !user) return false;
  const identity = extractIdentity(user);
  const candidates = [
    identity.email,
    user.email?.address,
    user.google?.email,
    ...user.linkedAccounts
      .filter((a) => a.type === "email" && "address" in a)
      .map((a) => (a as { address?: unknown }).address),
  ]
    .filter((e): e is string => typeof e === "string" && e.length > 0)
    .map((e) => e.toLowerCase());
  return candidates.some((email) => staff.includes(email));
}