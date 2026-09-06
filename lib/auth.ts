import type { NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import type { AuthTokenClaims, User } from "@privy-io/server-auth";
import type { Identity } from "./domain";

export class AppConfigError extends Error {
  readonly status = 500;
  readonly code = "SERVER_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "AppConfigError";
  }
}

export class TokenVerificationError extends Error {
  readonly status = 401;
  readonly code = "INVALID_TOKEN";
  constructor(message = "Missing or invalid access token.") {
    super(message);
    this.name = "TokenVerificationError";
  }
}

let cachedClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new AppConfigError(
      "PRIVY_APP_ID and PRIVY_APP_SECRET must be set in the server environment.",
    );
  }
  if (!cachedClient) cachedClient = new PrivyClient(appId, appSecret);
  return cachedClient;
}

export function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function verifyAccessToken(token: string): Promise<AuthTokenClaims> {
  try {
    return await getPrivyClient().verifyAuthToken(token);
  } catch {
    throw new TokenVerificationError();
  }
}

type LooseLinkedAccount = {
  type?: string;
  address?: string | null;
  email?: string | null;
  name?: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractIdentity(user: User): Identity {
  const linked = (user.linkedAccounts ?? []) as LooseLinkedAccount[];
  const linkedEmail = linked.find(
    (a) => a.type === "email" && typeof a.address === "string",
  )?.address;
  const linkedName = linked.find((a) => a.type === "email" && typeof a.name === "string")?.name;

  const email = readString(user.email?.address ?? user.google?.email ?? linkedEmail);
  const displayName = readString(user.google?.name ?? linkedName);
  const walletAddress = readString(
    user.wallet?.address ?? linked.find((a) => a.type === "wallet")?.address,
  );

  return {
    userId: user.id,
    email: email ? email.toLowerCase() : null,
    displayName,
    walletAddress: walletAddress ? walletAddress.toLowerCase() : null,
  };
}

export async function resolveUser(token: string, claims: AuthTokenClaims): Promise<User | null> {
  const privy = getPrivyClient();
  try {
    return await privy.getUser({ idToken: token });
  } catch {
    try {
      return await privy.getUser(claims.userId);
    } catch {
      return null;
    }
  }
}

export async function resolveIdentityFromToken(
  token: string,
  claims: AuthTokenClaims,
): Promise<Identity> {
  const fallback: Identity = {
    userId: claims.userId,
    email: null,
    displayName: null,
    walletAddress: null,
  };
  const user = await resolveUser(token, claims);
  if (!user) return fallback;
  try {
    return extractIdentity(user);
  } catch {
    return fallback;
  }
}