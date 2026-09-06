import type { NextRequest } from "next/server";
import { resolveIdentityFromToken, verifyAccessToken } from "@/lib/auth";
import { loadStore } from "@/lib/deps";
import { MAX_STAMPS_PER_CARD } from "@/lib/domain";
import type { CheckinResponse } from "@/lib/domain";
import { requireAuthedToken, sendError } from "@/lib/http";
import { StampLimitReachedError } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const token = await requireAuthedToken(req);
    const claims = await verifyAccessToken(token);
    const store = loadStore();
    // A completed card has no free slot left — refuse to mint a code that could
    // never be redeemed, and tell the customer the card is complete instead.
    const customer = store.getCustomer(claims.userId);
    if ((customer?.balance ?? 0) >= MAX_STAMPS_PER_CARD) {
      throw new StampLimitReachedError();
    }
    const ttlMinutes = Math.max(
      1,
      Number.parseInt(process.env.COUNTER_CODE_TTL_MINUTES ?? "5", 10) || 5,
    );
    const binding = store.createCounterCode(claims.userId, ttlMinutes);
    const identity = await resolveIdentityFromToken(token, claims);
    store.upsertCustomer({
      userId: claims.userId,
      email: identity.email,
      displayName: identity.displayName,
      walletAddress: identity.walletAddress,
    });

    const body: CheckinResponse = {
      code: binding.code,
      expiresAt: binding.expiresAt,
      ttlMinutes,
    };
    return Response.json(body);
  } catch (err) {
    return sendError(err);
  }
}