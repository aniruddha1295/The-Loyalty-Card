// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/stamps/checkin/route";
import type { AuthTokenClaims } from "@privy-io/server-auth";
import type { CounterCodeBinding, Customer, Identity } from "@/lib/domain";
import { MAX_STAMPS_PER_CARD } from "@/lib/domain";
import type { LoyaltyStore, StampInput } from "@/lib/store";

const authMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  resolveIdentityFromToken: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    verifyAccessToken: authMock.verifyAccessToken,
    resolveIdentityFromToken: authMock.resolveIdentityFromToken,
  };
});

const depsMock = vi.hoisted(() => ({
  loadStore: vi.fn(),
}));

vi.mock("@/lib/deps", () => depsMock);

afterEach(() => {
  authMock.verifyAccessToken.mockReset();
  authMock.resolveIdentityFromToken.mockReset();
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
  const codes: CounterCodeBinding[] = [];

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
      const next: Customer = { ...existing, balance: existing.balance };
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
      const customer = { ...existing, balance: existing.balance + 1 };
      customers.set(input.userId, customer);
      return { customer: { ...customer }, newBalance: customer.balance };
    },
    createCounterCode: (userId, ttlMinutes) => {
      const binding: CounterCodeBinding = {
        code: "123456",
        userId,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      };
      codes.push(binding);
      return binding;
    },
    consumeCounterCode: () => null,
    countStamps: () => 0,
    listStampEvents: () => [],
    listCustomers: () => [...customers.values()].map((c) => ({ ...c })),
    close: () => {},
  };

  return { store, customers, codes };
}

async function postCheckin(token: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/stamps/checkin", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
}

describe("POST /api/stamps/checkin — one-time counter codes on a non-complete card", () => {
  it("rejects a request with no bearer token (401) before issuing a code", async () => {
    depsMock.loadStore.mockReturnValue(fakeStore().store);
    const res = await postCheckin(null);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("issues a 6-digit code bound to the verified customer while the card is below 10", async () => {
    const { store, codes } = fakeStore();
    for (let i = 0; i < 9; i += 1) {
      store.awardStamp({ userId: "user_9", awardedBy: "user_9", viaCode: null });
    }
    depsMock.loadStore.mockReturnValue(store);
    authMock.verifyAccessToken.mockResolvedValue(makeClaims("user_9"));
    authMock.resolveIdentityFromToken.mockResolvedValue({
      userId: "user_9",
      email: "mina@example.com",
      displayName: null,
      walletAddress: null,
    } satisfies Identity);

    const res = await postCheckin("good-token");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toMatch(/^\d{6}$/);
    expect(codes).toHaveLength(1);
    expect(codes[0].userId).toBe("user_9");
  });

  it("refuses to mint a counter code for a complete card (10/10) — 409 CARD_COMPLETE and no code is created", async () => {
    const { store, codes } = fakeStore();
    for (let i = 0; i < MAX_STAMPS_PER_CARD; i += 1) {
      store.awardStamp({ userId: "user_full", awardedBy: "user_full", viaCode: null });
    }
    depsMock.loadStore.mockReturnValue(store);
    authMock.verifyAccessToken.mockResolvedValue(makeClaims("user_full"));

    const res = await postCheckin("good-token");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "CARD_COMPLETE" });
    expect(codes).toHaveLength(0);
  });
});