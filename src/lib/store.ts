import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "loyalty.json");
const STAMPS_PER_CAKE = 10;

type RedemptionEvent = { at: string };

type CustomerRecord = {
  stamps: number;
  redemptions: RedemptionEvent[];
};

type Db = Record<string, CustomerRecord>;

function readDb(): Db {
  if (!existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf-8")) as Db;
  } catch {
    return {};
  }
}

function writeDb(db: Db): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function getOrCreate(db: Db, privyDid: string): CustomerRecord {
  if (!db[privyDid]) {
    db[privyDid] = { stamps: 0, redemptions: [] };
  }
  return db[privyDid];
}

export function getBalance(privyDid: string) {
  const db = readDb();
  const record = getOrCreate(db, privyDid);
  return {
    stamps: record.stamps,
    stampsPerCake: STAMPS_PER_CAKE,
    redemptions: record.redemptions,
  };
}

export function awardStamp(privyDid: string) {
  const db = readDb();
  const record = getOrCreate(db, privyDid);
  record.stamps += 1;
  writeDb(db);
  return {
    stamps: record.stamps,
    stampsPerCake: STAMPS_PER_CAKE,
    redemptions: record.redemptions,
  };
}

export function redeemCake(privyDid: string) {
  const db = readDb();
  const record = getOrCreate(db, privyDid);
  if (record.stamps < STAMPS_PER_CAKE) {
    throw new Error("Not enough stamps to redeem yet");
  }
  record.stamps -= STAMPS_PER_CAKE;
  record.redemptions.push({ at: new Date().toISOString() });
  writeDb(db);
  return {
    stamps: record.stamps,
    stampsPerCake: STAMPS_PER_CAKE,
    redemptions: record.redemptions,
  };
}
