// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stamps/award/route";
import { TokenVerificationError } from "@/lib/award";
import type { AwardDeps } from "@/lib/award";
import type { AuthTokenClaims } from "@privy-io/server-auth";
import type { Customer } from "@/lib/domain";
import { MAX_STAMPS_PER_CARD } from "@/lib/domain";
import { StampLimitReachedError } from "@/lib/store";
import type { LoyaltyStore, StampInput } from "@/lib/store";

const depsMock = vi.hoisted(() => ({
  buildAwardDeps: vi.fn(),
  loadStore: vi.fn(),
}));

vi.mock("@/lib/deps", () => depsMock);

afterEach(() => {
  depsMock.buildAwardDeps.mockReset();
  depsMock.loadStore.mockReset();
});

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
  const stamped: StampInput[] = [];
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
        balance: existing.balance + 1,
        email: input.email ?? existing.email ?? null,
        displayName: input.displayName ?? existing.displayName ?? null,
        walletAddress: input.walletAddress ?? existing.walletAddress ?? null,
      };
      customers.set(input.userId, next);
      return { ...next };
    },
    awardStamp: (input: StampInput) => {
      const existing = customers.get(input.userId) ?? {
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
      stamped.push(input);
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
      if (!row || row.usedAt || Date.parse(row.expiresAt) < Date.now()) return null;
      row.usedAt = new Date().toISOString();
      return { code, userId: row.userId, expiresAt: row.expiresAt };
    },
    countStamps: (userId) => stamped.filter((s) => s.userId === userId).length,
    listStampEvents: () => [],
    listCustomers: () => [...customers.values()].map((c) => ({ ...c })),
    close: () => {},
  };

  return { store, codes, stamped, customers };
}

async function postAward(body: Record<string, unknown>, token: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/stamps/award", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/stamps/award — HTTP security boundary", () => {
  it("rejects a request with no bearer token (401) before any award logic or store write", async () => {
    const res = await postAward({}, null);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_TOKEN" });
    expect(depsMock.buildAwardDeps).not.toHaveBeenCalled();
  });

  it("rejects a forged token (401) and never reaches store.awardStamp", async () => {
    const { store, stamped } = fakeStore();
    const verifyToken = vi.fn(async () => {
      throw new TokenVerificationError();
    });
    depsMock.buildAwardDeps.mockReturnValue({
      verifyToken,
      store,
      isStaff: () => false,
    } satisfies AwardDeps);

    const res = await postAward({}, "forged-token");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_TOKEN" });
    expect(verifyToken).toHaveBeenCalledWith("forged-token");
    expect(stamped).toHaveLength(0);
  });

  it("stamps the verified claims.userId even when the body tries to supply another identity", async () => {
    const { store, stamped, customers } = fakeStore();
    const claims = makeClaims("did:privy:real-customer");
    depsMock.buildAwardDeps.mockReturnValue({
      verifyToken: async () => claims,
      store,
      isStaff: () => false,
    } satisfies AwardDeps);

    const res = await postAward(
      {
        userId: "did:privy:attacker",
        email: "attacker@evil.invalid",
        walletAddress: "0x1111222233334444555566667777888899990000",
      },
      "good-token",
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.customer.userId).toBe("did:privy:real-customer");
    expect(stamped[0]?.userId).toBe("did:privy:real-customer");
    expect(customers.has("did:privy:attacker")).toBe(false);
  });

  it("redeems a staff counter code against its server-bound customer, and the code is single-use", async () => {
    const { store, stamped, codes } = fakeStore();
    const customerBinding = store.createCounterCode("did:privy:customer-2", 5);
    depsMock.buildAwardDeps.mockReturnValue({
      verifyToken: async () => makeClaims("staff_priya"),
      store,
      isStaff: () => true,
    } satisfies AwardDeps);

    const res = await postAward({ counterCode: customerBinding.code }, "staff-token");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.customer.userId).toBe("did:privy:customer-2");
    expect(stamped[0]?.userId).toBe("did:privy:customer-2");
    expect(stamped[0]?.awardedBy).toBe("staff_priya");
    expect(codes.get(customerBinding.code)?.usedAt).not.toBeNull();

    const reused = await postAward({ counterCode: customerBinding.code }, "staff-token");
    expect(reused.status).toBe(409);
    await expect(reused.json()).resolves.toMatchObject({ code: "INVALID_CODE" });
    expect(stamped).toHaveLength(1);
  });

  it("returns 409 CARD_COMPLETE when the verified card already holds 10 stamps (never an 11th)", async () => {
    const { store, stamped } = fakeStore();
    const claims = makeClaims("did:privy:full-card");
    depsMock.buildAwardDeps.mockReturnValue({
      verifyToken: async () => claims,
      store,
      isStaff: () => false,
    } satisfies AwardDeps);

    for (let i = 0; i < 10; i += 1) {
      store.awardStamp({ userId: claims.userId, awardedBy: claims.userId, viaCode: null });
    }

    const res = await postAward({}, "good-token");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "CARD_COMPLETE" });

    expect(store.getCustomer(claims.userId)?.balance).toBe(10);
    expect(stamped).toHaveLength(10);
  });
});