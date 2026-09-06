import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import { MAX_STAMPS_PER_CARD } from "../lib/domain";

const dbPath = process.env.DB_PATH ?? "data/loyalty.db";
const abs = path.resolve(dbPath);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
const backupPath = `${abs}.bak-${stamp}`;

interface CustomerRow {
  user_id: string;
  email: string | null;
  balance: number;
  events: number;
}

async function main(): Promise<void> {
  const db = new Database(abs);
  try {
    const integrity = db.pragma("integrity_check") as unknown as Array<{ integrity_check: string }>;
    if (integrity[0]?.integrity_check !== "ok") {
      console.error(`integrity_check failed: ${JSON.stringify(integrity)}`);
      process.exitCode = 1;
      return;
    }

    console.log(`backing up database to: ${backupPath}`);
    await db.backup(backupPath);

    const trimEvents = db.prepare(`
      DELETE FROM stamp_events
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM stamp_events WHERE user_id = ? ORDER BY id ASC LIMIT ?
      )
    `);
    const countEvents = db.prepare(
      "SELECT COUNT(*) AS n FROM stamp_events WHERE user_id = ?",
    ) as unknown as {
      get(userId: string): { n: number };
    };
    const setBalance = db.prepare("UPDATE customers SET balance = ? WHERE user_id = ?");

    const run = db.transaction(() => {
      const rows = db
        .prepare(
          `
            SELECT c.user_id AS user_id,
                   c.email AS email,
                   c.balance AS balance,
                   (SELECT COUNT(*) FROM stamp_events e WHERE e.user_id = c.user_id) AS events
            FROM customers c
            ORDER BY c.created_at ASC
          `,
        )
        .all() as unknown as CustomerRow[];

      let usersTrimmed = 0;
      let eventsRemoved = 0;

      for (const row of rows) {
        if (row.balance <= MAX_STAMPS_PER_CARD && row.events <= MAX_STAMPS_PER_CARD) continue;
        const removed = trimEvents.run(row.user_id, row.user_id, MAX_STAMPS_PER_CARD).changes;
        const remaining = countEvents.get(row.user_id).n;
        setBalance.run(remaining, row.user_id);
        usersTrimmed += 1;
        eventsRemoved += removed;
      }

      return { usersTrimmed, eventsRemoved };
    });

    const { usersTrimmed, eventsRemoved } = run();

    const after = db
      .prepare(
        `
          SELECT c.user_id AS user_id,
                 c.email AS email,
                 c.balance AS balance,
                 (SELECT COUNT(*) FROM stamp_events e WHERE e.user_id = c.user_id) AS events
          FROM customers c
          ORDER BY c.created_at ASC
        `,
      )
      .all() as unknown as CustomerRow[];

    console.log(`cards trimmed to cap (${MAX_STAMPS_PER_CARD}): ${usersTrimmed}`);
    console.log(`stamp events removed: ${eventsRemoved}`);
    console.log("customers after normalization:");
    for (const row of after) {
      console.log(
        `  ${row.email ?? row.user_id}  balance=${row.balance}  events=${row.events}`,
      );
    }
    console.log(`integrity after: ${JSON.stringify(db.pragma("integrity_check"))}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});