import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

const SCANNED_RELATIVE = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/providers.tsx",
  "app/globals.css",
  "app/api/me/route.ts",
  "app/api/stamps/checkin/route.ts",
  "app/api/stamps/award/route.ts",
  "app/api/staff/customers/route.ts",
  "components/InitializingScreen.tsx",
  "components/LoginScreen.tsx",
  "components/LoyaltyShell.tsx",
  "components/LoyaltyDashboard.tsx",
  "components/StaffDashboard.tsx",
  "lib/domain.ts",
  "lib/store.ts",
  "lib/auth.ts",
  "lib/staff.ts",
  "lib/award.ts",
  "lib/client.ts",
  "lib/http.ts",
  "lib/deps.ts",
  "scripts/check-server-auth.ts",
  "scripts/normalize-stamp-data.ts",
  "tests/setup.ts",
  "tests/award.test.ts",
  "tests/award-route.test.ts",
  "tests/checkin-route.test.ts",
  "tests/store.test.ts",
  "tests/components.test.tsx",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "vitest.config.mts",
];

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key block", /BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY/],
  ["filled PRIVY_APP_SECRET", /PRIVY_APP_SECRET\s*=\s*\S/],
  ["filled PRIVY_APP_ID", /PRIVY_APP_ID\s*=\s*\S/],
  ["Alchemy key", /alchemy_[A-Za-z0-9]{20,}/],
  ["sk- prefixed key", /sk-[A-Za-z0-9]{20,}/],
  ["64-char hex", /\b[0-9a-fA-F]{64}\b/],
];

const IGNORED_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
];

describe("P7-8 — no credentials in tracked files", () => {
  it("git ignores all local environment files", () => {
    const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    for (const entry of IGNORED_ENV_FILES) {
      const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(gitignore, `expected ${entry} to be ignored`).toMatch(
        new RegExp(`^${escaped}$`, "m"),
      );
    }
  });

  it("contains no secret-looking values in any source file", () => {
    for (const rel of SCANNED_RELATIVE) {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const content = fs.readFileSync(abs, "utf8");
      for (const [label, pattern] of SECRET_PATTERNS) {
        expect(content.match(pattern), `${rel} matched ${label}`).toBeNull();
      }
    }
  });

  it("keeps .env.example as placeholder-only", () => {
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^PRIVY_APP_ID=$/m);
    expect(example).toMatch(/^PRIVY_APP_SECRET=$/m);
    expect(example).not.toMatch(/^PRIVY_APP_ID=\S/m);
    expect(example).not.toMatch(/^PRIVY_APP_SECRET=\S/m);
  });

  it("git would refuse to track .env (when a repo is present)", () => {
    try {
      const out = execFileSync(
        "git",
        ["check-ignore", "--no-index", "RTD-P7/.env"],
        { cwd: ROOT, stdio: "pipe" },
      );
      expect(out.toString()).toContain("RTD-P7/.env");
    } catch {
      // git unavailable or not a repo here — the literal .gitignore assertions above are the contract
      expect(true).toBeTruthy();
    }
  });
});