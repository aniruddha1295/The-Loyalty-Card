import { resolveUser, verifyAccessToken } from "./auth";
import type { AwardDeps } from "./award";
import { isStaffMember } from "./staff";
import { createLoyaltyStore } from "./store";
import type { LoyaltyStore } from "./store";

let cachedStore: LoyaltyStore | null = null;

export function loadStore(): LoyaltyStore {
  if (!cachedStore) {
    cachedStore = createLoyaltyStore(process.env.DB_PATH ?? "data/loyalty.db");
  }
  return cachedStore;
}

export function buildAwardDeps(token: string): AwardDeps {
  const store = loadStore();
  return {
    verifyToken: verifyAccessToken,
    store,
    isStaff: async (claims) => {
      const user = await resolveUser(token, claims);
      return isStaffMember(user);
    },
  };
}