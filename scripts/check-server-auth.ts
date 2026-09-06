import "dotenv/config";
import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const token = process.argv[2];

if (!appId || !appSecret) {
  console.error("PRIVY_APP_ID / PRIVY_APP_SECRET not set in the environment.");
  console.error("Copy RTD-P7/.env.example to RTD-P7/.env, fill it in, and retry.");
  process.exit(1);
}

console.log(`Privy app configured: ${appId}`);

if (!token) {
  console.log("No token supplied. Pass one as an argument to verify its signature.");
  console.log("  npm run check:auth -- <access-token>");
  process.exit(0);
}

try {
  const client = new PrivyClient(appId, appSecret);
  const claims = await client.verifyAuthToken(token);
  console.log(`Token verified. userId: ${claims.userId}`);
} catch (err) {
  console.error(`Token verification failed: ${(err as Error).message}`);
  process.exit(1);
}