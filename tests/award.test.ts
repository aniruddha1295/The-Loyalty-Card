import { describe, expect, it, vi } from "vitest";
import { AwardRejectedError, TokenVerificationError, awardStamp } from "@/lib/award";
import type { Customer } from "@/lib/domain";
import { MAX_STAMPS_PER_CARD } from "@/lib/domain";
import { StampLimitReachedError } from "@/lib/store";
import type { LoyaltyStore, StampInput } from "@/lib/store";
import type { AuthTokenClaims } from "@privy-io/server-auth";

function makeClaims(userId: string): AuthTokenClaims {
  return {
    appId: "app-test",
    issuer: "privy:test",
    issuedAt: 1_700_000_000,
    expiration: 1_700_000_000 + 3_600,
    sessionId: `session-${userId}`,
    userId,
  };
}

function fakeStore() {
  const customers = new Map<string, Customer>();
  const codes = new Map<string, { userId: string; expiresAt: string; usedAt: string | null }>();
  const stamps: Array<{ userId: string; awardedBy: string; viaCode: string | null }> = [];
  let seq = 0;

  const store: LoyaltyStore = {
    getCustomer: (userId) => customers.get(userId) ?? null,
    upsertCustomer: (input) => {
      const existing = customers.get(input.userId) ?? {
        userId: input.userId,
        email: null,
        displayName: null,
        walletAddress: null,
        balance: 0,
        createdAt: new Date(0).toISOString(),
      };
      const next: Customer = {
        ...existing,
        userId: input.userId,
        email: input.email ?? existing.email ?? null,
        displayName: input.displayName ?? existing.displayName ?? null,
        walletAddress: input.walletAddress ?? existing.walletAddress ?? null,
      };
      customers.set(input.userId, next);
      return { ...next };
    },
    awardStamp: (input: StampInput) => {
      const existing = store.getCustomer(input.userId) ?? {
        userId: input.userId,
        email: null,
        displayName: null,
        walletAddress: null,
        balance: 0,
        createdAt: new Date(0).toISOString(),
      };
      if (existing.balance >= MAX_STAMPS_PER_CARD) throw new StampLimitReachedError();
      const customer = { ...existing, balance: existing.balance + 1 };
      customers.set(input.userId, customer);
      stamps.push({ userId: input.userId, awardedBy: input.awardedBy, viaCode: input.viaCode ?? null });
      return { customer: { ...customer }, newBalance: customer.balance };
    },
    createCounterCode: (userId, ttlMinutes) => {
      seq += 1;
      const code = String(seq).padStart(6, "0");
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
      codes.set(code, { userId, expiresAt, usedAt: null });
      return { code, userId, expiresAt };
    },
    consumeCounterCode: (code) => {
      const row = codes.get(code);
      if (!row) return null;
      if (row.usedAt) return null;
      if (Date.parse(row.expiresAt) < Date.now()) return null;
      row.usedAt = new Date().toISOString();
      return { code, userId: row.userId, expiresAt: row.expiresAt };
    },
    countStamps: (userId) => stamps.filter((s) => s.userId === userId).length,
    listStampEvents: () => [],
    listCustomers: () => [...customers.values()].map((c) => ({ ...c })),
    close: () => {},
  };

  return { store, customers, codes, stamps };
}

describe("awardStamp — stamped identity always comes from verified claims, never the request body", () => {
  it("P7-5/rejects an invalid token with 401 before touching any state", async () => {
    const { store, customers } = fakeStore();
    const verifyToken = vi.fn(async () => {
      throw new TokenVerificationError();
    });

    await expect(
      awardStamp(
        { verifyToken, store, isStaff: () => false },
        { token: "forged-token", counterCode: null },
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);

    expect(store.getCustomer("user_customer")).toBeNull();
    expect([...customers.entries()]).toHaveLength(0);
    expect(verifyToken).toHaveBeenCalledWith("forged-token");
  });

  it("P7-6/stamps claims.userId for a self-service award and ignores any body-supplied identity", async () => {
    const { store, customers } = fakeStore();
    const claims = makeClaims("user_customer_1");
    const verifyToken = vi.fn(async () => claims);

    const result = await awardStamp(
      { verifyToken, store, isStaff: () => false },
      { token: "real-token" },
    );

    expect(result.mode).toBe("customer-self");
    expect(result.customer.userId).toBe("user_customer_1");
    expect(result.newBalance).toBe(1);
    expect(customers.get("user_customer_1")?.balance).toBe(1);
    expect(customers.get("attacker-id")).toBeUndefined();
  });

  it("staff redemptions resolve the customer from the code binding, never from the request body", async () => {
    const { store, customers, codes } = fakeStore();
    const staffClaims = makeClaims("staff_priya");
    const customerBinding = store.createCounterCode("user_customer_2", 5);

    const result = await awardStamp(
      { verifyToken: async () => staffClaims, store, isStaff: () => true },
      { token: "staff-token", counterCode: customerBinding.code },
    );

    expect(result.mode).toBe("staff-customer");
    expect(result.awarderUserId).toBe("staff_priya");
    expect(result.customer.userId).toBe("user_customer_2");
    expect(customers.get("user_customer_2")?.balance).toBe(1);
    expect(customers.get("attacker-id")).toBeUndefined();
    expect(codes.get(customerBinding.code)?.usedAt).not.toBeNull();
  });

  it("rejects a non-staff member redeeming a counter code with 403 and leaves state unchanged", async () => {
    const { store, codes } = fakeStore();
    const customerBinding = store.createCounterCode("user_customer_3", 5);

    await expect(
      awardStamp(
        { verifyToken: async () => makeClaims("user_customer_3"), store, isStaff: () => false },
        { token: "customer-token", counterCode: customerBinding.code },
      ),
    ).rejects.toMatchObject({ code: "STAFF_REQUIRED", status: 403 });

    expect(codes.get(customerBinding.code)?.usedAt).toBeNull();
  });

  it("rejects invalid, expired, or already-used codes with 409 and does not stamp", async () => {
    const { store, codes } = fakeStore();
    const binding = store.createCounterCode("user_customer_4", 5);

    await expect(
      awardStamp(
        { verifyToken: async () => makeClaims("staff_a"), store, isStaff: () => true },
        { token: "staff-token", counterCode: "999999" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CODE", status: 409 });

    // consume once successfully
    await awardStamp(
      { verifyToken: async () => makeClaims("staff_a"), store, isStaff: () => true },
      { token: "staff-token", counterCode: binding.code },
    );

    // reuse is rejected
    await expect(
      awardStamp(
        { verifyToken: async () => makeClaims("staff_a"), store, isStaff: () => true },
        { token: "staff-token", counterCode: binding.code },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CODE", status: 409 });

    expect(codes.get(binding.code)?.usedAt).not.toBeNull();
  });

  it("rejects an expired counter code", async () => {
    const { store } = fakeStore();
    const expired = store.createCounterCode("user_customer_5", -1);

    await expect(
      awardStamp(
        { verifyToken: async () => makeClaims("staff_a"), store, isStaff: () => true },
        { token: "staff-token", counterCode: expired.code },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CODE", status: 409 });
  });

  it("ignores counter codes that arrive as whitespace (treated as self-service)", async () => {
    const { store } = fakeStore();
    const result = await awardStamp(
      { verifyToken: async () => makeClaims("user_whitespace"), store, isStaff: () => false },
      { token: "real-token", counterCode: "   " },
    );
    expect(result.mode).toBe("customer-self");
    expect(result.customer.userId).toBe("user_whitespace");
  });

  describe("hard 10-stamp cap", () => {
    it("self-service rejects a stamp once the card is complete (10/10) and writes nothing", async () => {
      const { store, customers, stamps } = fakeStore();
      for (let i = 0; i < 10; i += 1) {
        store.awardStamp({ userId: "user_full", awardedBy: "user_full", viaCode: null });
      }

      await expect(
        awardStamp(
          {
            verifyToken: async () => makeClaims("user_full"),
            store,
            isStaff: () => false,
          },
          { token: "customer-token" },
        ),
      ).rejects.toBeInstanceOf(StampLimitReachedError);

      expect(customers.get("user_full")?.balance).toBe(10);
      expect(stamps).toHaveLength(10);
    });

    it("staff redemption of a code for a complete card rejects with CARD_COMPLETE (code is spent, balance kept at 10)", async () => {
      const { store, customers, codes, stamps } = fakeStore();
      for (let i = 0; i < 10; i += 1) {
        store.awardStamp({ userId: "user_full_staff", awardedBy: "user_full_staff", viaCode: null });
      }
      const binding = store.createCounterCode("user_full_staff", 5);

      await expect(
        awardStamp(
          { verifyToken: async () => makeClaims("staff_priya"), store, isStaff: () => true },
          { token: "staff-token", counterCode: binding.code },
        ),
      ).rejects.toMatchObject({ code: "CARD_COMPLETE", status: 409 });

      expect(customers.get("user_full_staff")?.balance).toBe(10);
      expect(codes.get(binding.code)?.usedAt).not.toBeNull();
      expect(stamps).toHaveLength(10);
    });

    it("two in-flight awards on a card at 9 cannot both succeed", async () => {
      const { store, stamps } = fakeStore();
      for (let i = 0; i < 9; i += 1) {
        store.awardStamp({ userId: "user_conc", awardedBy: "user_conc", viaCode: null });
      }

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let verifyCalls = 0;
      const verifyToken = vi.fn(async () => {
        verifyCalls += 1;
        if (verifyCalls === 2) release();
        await gate;
        return makeClaims("user_conc");
      });

      const results = await Promise.allSettled([
        awardStamp({ verifyToken, store, isStaff: () => false }, { token: "req-1" }),
        awardStamp({ verifyToken, store, isStaff: () => false }, { token: "req-2" }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(store.getCustomer("user_conc")?.balance).toBe(10);
      expect(stamps).toHaveLength(10);
    });
  });
});