import Database from "better-sqlite3";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_STAMPS_PER_CARD } from "./domain";
import type { CounterCodeBinding, Customer, StampEvent } from "./domain";

export class StampLimitReachedError extends Error {
  readonly status = 409;
  readonly code = "CARD_COMPLETE";
  constructor(message = "Card already complete — no additional stamp can be added.") {
    super(message);
    this.name = "StampLimitReachedError";
  }
}

export interface StampInput {
  userId: string;
  awardedBy: string;
  viaCode?: string | null;
}

export interface LoyaltyStore {
  getCustomer(userId: string): Customer | null;
  upsertCustomer(input: {
    userId: string;
    email?: string | null;
    displayName?: string | null;
    walletAddress?: string | null;
  }): Customer;
  awardStamp(input: StampInput): { customer: Customer; newBalance: number };
  createCounterCode(userId: string, ttlMinutes: number): CounterCodeBinding;
  consumeCounterCode(code: string): CounterCodeBinding | null;
  countStamps(userId: string): number;
  listStampEvents(): StampEvent[];
  listCustomers(): Customer[];
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  user_id        TEXT PRIMARY KEY,
  email          TEXT,
  display_name   TEXT,
  wallet_address TEXT,
  balance        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stamp_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  awarded_by TEXT NOT NULL,
  via_code   TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counter_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_stamp_events_user ON stamp_events (user_id, id);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createLoyaltyStore(dbPath: string): LoyaltyStore {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(path.resolve(dbPath));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const stmtGetCustomer = db.prepare("SELECT * FROM customers WHERE user_id = ?");
  const stmtUpsertCustomer = db.prepare(`
    INSERT INTO customers (user_id, email, display_name, wallet_address, created_at)
    VALUES (@userId, @email, @displayName, @walletAddress, @createdAt)
    ON CONFLICT(user_id) DO UPDATE SET
      email          = COALESCE(@email, email),
      display_name   = COALESCE(@displayName, display_name),
      wallet_address = COALESCE(@walletAddress, wallet_address)
  `);
  const stmtAward = db.transaction(
    (userId: string, awardedBy: string, viaCode: string | null) => {
      stmtUpsertCustomer.run({
        userId,
        email: null,
        displayName: null,
        walletAddress: null,
        createdAt: nowIso(),
      });
      // Authoritative cap: the conditional UPDATE only bumps rows still below the
      // limit, so a card can never exceed MAX_STAMPS_PER_CARD even if two awards
      // race. When both conditions fail the transaction throws (and rolls back),
      // which also prevents any orphaned stamp_events row.
      const update = db
        .prepare("UPDATE customers SET balance = balance + 1 WHERE user_id = ? AND balance < ?")
        .run(userId, MAX_STAMPS_PER_CARD);
      if (update.changes !== 1) {
        throw new StampLimitReachedError();
      }
      db.prepare(
        "INSERT INTO stamp_events (user_id, awarded_by, via_code, created_at) VALUES (?, ?, ?, ?)",
      ).run(userId, awardedBy, viaCode, nowIso());
      return rowToCustomer(stmtGetCustomer.get(userId) as unknown as CustomerRow);
    },
  );

  const store: LoyaltyStore = {
    getCustomer(userId) {
      const row = stmtGetCustomer.get(userId) as unknown as CustomerRow | undefined;
      return row ? rowToCustomer(row) : null;
    },

    upsertCustomer(input) {
      stmtUpsertCustomer.run({
        userId: input.userId,
        email: input.email ?? null,
        displayName: input.displayName ?? null,
        walletAddress: input.walletAddress ?? null,
        createdAt: nowIso(),
      });
      const row = stmtGetCustomer.get(input.userId) as unknown as CustomerRow;
      return rowToCustomer(row);
    },

    awardStamp(input) {
      const customer = stmtAward(input.userId, input.awardedBy, input.viaCode ?? null);
      return { customer, newBalance: customer.balance };
    },

    createCounterCode(userId, ttlMinutes) {
      let code = generateCode();
      while (
        (db.prepare("SELECT 1 FROM counter_codes WHERE code = ?").get(code) as
          | { 1: number }
          | undefined) !== undefined
      ) {
        code = generateCode();
      }
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
      db.prepare(
        "INSERT INTO counter_codes (code, user_id, expires_at) VALUES (?, ?, ?)",
      ).run(code, userId, expiresAt);
      return { code, userId, expiresAt };
    },

    consumeCounterCode(code) {
      return db.transaction(() => {
        const row = db
          .prepare("SELECT * FROM counter_codes WHERE code = ?")
          .get(code) as CounterCodeRow | undefined;
        if (!row) return null;
        if (row.used_at) return null;
        if (Date.parse(row.expires_at) < Date.now()) return null;
        db.prepare("UPDATE counter_codes SET used_at = ? WHERE code = ?").run(nowIso(), code);
        return { code: row.code, userId: row.user_id, expiresAt: row.expires_at };
      })();
    },

    countStamps(userId) {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM stamp_events WHERE user_id = ?")
        .get(userId) as { n: number };
      return row.n;
    },

    listStampEvents() {
      const rows = db
        .prepare("SELECT * FROM stamp_events ORDER BY id ASC")
        .all() as StampEventRow[];
      return rows.map(rowToStampEvent);
    },

    listCustomers() {
      const rows = db.prepare("SELECT * FROM customers ORDER BY created_at ASC").all() as unknown as CustomerRow[];
      return rows.map(rowToCustomer);
    },

    close() {
      db.close();
    },
  };

  return store;
}

interface CustomerRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  wallet_address: string | null;
  balance: number;
  created_at: string;
}

interface StampEventRow {
  id: number;
  user_id: string;
  awarded_by: string;
  via_code: string | null;
  created_at: string;
}

interface CounterCodeRow {
  code: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    userId: row.user_id,
    email: row.email ?? undefined,
    displayName: row.display_name ?? undefined,
    walletAddress: row.wallet_address ?? undefined,
    balance: row.balance,
    createdAt: row.created_at,
  };
}

function rowToStampEvent(row: StampEventRow): StampEvent {
  return {
    id: row.id,
    userId: row.user_id,
    awardedBy: row.awarded_by,
    viaCode: row.via_code ?? undefined,
    createdAt: row.created_at,
  };
}