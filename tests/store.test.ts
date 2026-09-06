import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StampLimitReachedError, createLoyaltyStore } from "@/lib/store";
import type { LoyaltyStore } from "@/lib/store";

const tmpDirs: string[] = [];
const stores: LoyaltyStore[] = [];

function openTempStore(): { store: LoyaltyStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtd-p7-"));
  tmpDirs.push(dir);
  const store = createLoyaltyStore(path.join(dir, "loyalty.db"));
  stores.push(store);
  return { store, dir };
}

afterEach(() => {
  for (const store of stores) store.close();
  stores.length = 0;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("LoyaltyStore (better-sqlite3)", () => {
  it("is empty before any customer exists", () => {
    const { store } = openTempStore();
    expect(store.getCustomer("user_1")).toBeNull();
    expect(store.listCustomers()).toEqual([]);
    expect(store.countStamps("user_1")).toBe(0);
  });

  it("upserts a customer and coalesces partial identity updates", () => {
    const { store } = openTempStore();
    store.upsertCustomer({ userId: "user_1", email: "a@example.com" });
    store.upsertCustomer({ userId: "user_1", walletAddress: "0xabc" });

    const customer = store.getCustomer("user_1");
    expect(customer?.userId).toBe("user_1");
    expect(customer?.email).toBe("a@example.com");
    expect(customer?.walletAddress).toBe("0xabc");
    expect(customer?.balance).toBe(0);
  });

  it("awardStamp increments the balance and records a stamped event atomically", () => {
    const { store } = openTempStore();
    store.awardStamp({ userId: "user_1", awardedBy: "staff_priya", viaCode: "000001" });
    store.awardStamp({ userId: "user_1", awardedBy: "user_1", viaCode: null });
    store.awardStamp({ userId: "user_2", awardedBy: "staff_priya", viaCode: "000003" });

    expect(store.getCustomer("user_1")?.balance).toBe(2);
    expect(store.getCustomer("user_2")?.balance).toBe(1);
    expect(store.countStamps("user_1")).toBe(2);
    expect(store.listCustomers()).toHaveLength(2);
    expect(store.listStampEvents()).toHaveLength(3);
    expect(store.listStampEvents()[0].awardedBy).toBe("staff_priya");
    expect(store.listStampEvents()[0].viaCode).toBe("000001");
  });

  it("creates a short-lived one-time counter code bound to the verified user", () => {
    const { store } = openTempStore();
    const binding = store.createCounterCode("user_1", 5);

    expect(binding.code).toMatch(/^\d{6}$/);
    expect(binding.userId).toBe("user_1");

    const consumed = store.consumeCounterCode(binding.code);
    expect(consumed?.userId).toBe("user_1");
    expect(Date.parse(consumed?.expiresAt as string)).toBeGreaterThan(Date.now());

    expect(store.consumeCounterCode(binding.code)).toBeNull();
    expect(store.consumeCounterCode("999999")).toBeNull();
  });

  it("refuses to consume an expired counter code", () => {
    const { store } = openTempStore();
    const binding = store.createCounterCode("user_1", -1);
    expect(store.consumeCounterCode(binding.code)).toBeNull();
  });

  it("enforces the 10-stamp cap: the 10th stamp succeeds, the 11th is rejected atomically", () => {
    const { store } = openTempStore();
    for (let i = 0; i < 9; i += 1) {
      store.awardStamp({ userId: "user_10", awardedBy: "user_10", viaCode: null });
    }
    const tenth = store.awardStamp({ userId: "user_10", awardedBy: "user_10", viaCode: null });
    expect(tenth.newBalance).toBe(10);

    expect(() => store.awardStamp({ userId: "user_10", awardedBy: "user_10", viaCode: null })).toThrow(
      StampLimitReachedError,
    );

    const customer = store.getCustomer("user_10");
    expect(customer?.balance).toBe(10);
    expect(store.countStamps("user_10")).toBe(10);
    expect(store.listStampEvents()).toHaveLength(10);
  });

  it("two awards racing on a card at 9 can never produce an 11th stamp", () => {
    const { store } = openTempStore();
    for (let i = 0; i < 9; i += 1) {
      store.awardStamp({ userId: "user_race", awardedBy: "user_race", viaCode: null });
    }
    // Two in-flight awards: the first bumps 9 -> 10 via the guarded UPDATE, the
    // second finds balance no longer < cap, throws, and its transaction rolls
    // back (no orphaned event row).
    const successes: number[] = [];
    const rejections: unknown[] = [];
    const attempt = () => {
      try {
        const result = store.awardStamp({
          userId: "user_race",
          awardedBy: "user_race",
          viaCode: null,
        });
        successes.push(result.newBalance);
      } catch (err) {
        rejections.push(err);
      }
    };
    attempt();
    attempt();

    expect(successes).toEqual([10]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toBeInstanceOf(StampLimitReachedError);
    const customer = store.getCustomer("user_race");
    expect(customer?.balance).toBe(10);
    expect(store.countStamps("user_race")).toBe(10);
  });

  it("the 11th attempt leaves no orphaned stamp event behind", () => {
    const { store } = openTempStore();
    for (let i = 0; i < 10; i += 1) {
      store.awardStamp({ userId: "user_orchestra", awardedBy: "user_orchestra", viaCode: null });
    }
    try {
      store.awardStamp({ userId: "user_orchestra", awardedBy: "user_orchestra", viaCode: null });
    } catch {
      // expected StampLimitReachedError
    }
    expect(store.countStamps("user_orchestra")).toBe(10);
    expect(store.listStampEvents()).toHaveLength(10);
  });

  it("records a server-generated timestamp with every awarded stamp", () => {
    const { store } = openTempStore();
    store.awardStamp({ userId: "user_ts", awardedBy: "staff_ts", viaCode: null });
    store.awardStamp({ userId: "user_ts", awardedBy: "user_ts", viaCode: null });

    const events = store.listStampEvents();
    expect(events).toHaveLength(2);
    const before = new Date().toISOString();
    for (const event of events) {
      expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const parsed = Date.parse(event.createdAt);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(Date.parse(event.createdAt)).toBeLessThanOrEqual(Date.parse(before));
      expect(Date.parse(event.createdAt)).toBeGreaterThan(
        Date.parse(before) - 60_000,
      );
    }
  });
});