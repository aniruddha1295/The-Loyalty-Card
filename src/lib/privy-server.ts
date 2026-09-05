import { PrivyClient } from "@privy-io/server-auth";
import { NextRequest } from "next/server";

let cachedClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (cachedClient) return cachedClient;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("PRIVY_APP_SECRET / NEXT_PUBLIC_PRIVY_APP_ID missing on the server");
  }

  cachedClient = new PrivyClient(appId, appSecret);
  return cachedClient;
}

function extractAccessToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  const cookieToken = req.cookies.get("privy-token")?.value;
  return cookieToken ?? null;
}

export type VerifiedIdentity = {
  privyDid: string;
};

/**
 * Verifies the Privy access token attached to the request and returns the
 * caller's identity derived from the verified claims. Throws if the token is
 * missing, malformed, expired, or fails signature verification — callers
 * must treat any throw as "reject the request", never proceed past it.
 */
export async function requireVerifiedIdentity(req: NextRequest): Promise<VerifiedIdentity> {
  const token = extractAccessToken(req);
  if (!token) {
    throw new Error("No Privy access token on request");
  }

  const client = getPrivyClient();
  const claims = await client.verifyAuthToken(token);

  return { privyDid: claims.userId };
}
