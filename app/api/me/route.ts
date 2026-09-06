import type { NextRequest } from "next/server";
import { resolveIdentityFromToken, resolveUser, verifyAccessToken } from "@/lib/auth";
import { loadStore } from "@/lib/deps";
import { FREE_LOAF_THRESHOLD } from "@/lib/domain";
import type { MeResponse } from "@/lib/domain";
import { requireAuthedToken, sendError } from "@/lib/http";
import { isStaffMember } from "@/lib/staff";

export async function GET(req: NextRequest) {
  try {
    const token = await requireAuthedToken(req);
    const claims = await verifyAccessToken(token);
    const store = loadStore();
    const identity = await resolveIdentityFromToken(token, claims);
    const customer = store.getCustomer(claims.userId);
    const staff = await isStaffMember(await resolveUser(token, claims));

    const body: MeResponse = {
      ...identity,
      balance: customer?.balance ?? 0,
      stampCount: store.countStamps(claims.userId),
      staff,
      createdAt: customer?.createdAt ?? null,
      freeLoafThreshold: FREE_LOAF_THRESHOLD,
    };
    return Response.json(body);
  } catch (err) {
    return sendError(err);
  }
}