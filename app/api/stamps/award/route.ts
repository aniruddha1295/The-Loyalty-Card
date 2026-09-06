import type { NextRequest } from "next/server";
import { awardStamp as runAwardCore } from "@/lib/award";
import { buildAwardDeps } from "@/lib/deps";
import type { AwardResponse } from "@/lib/domain";
import { requireAuthedToken, sendError } from "@/lib/http";

export async function POST(req: NextRequest) {
  try {
    // Missing bearer token is rejected here (401) before any award logic runs.
    const token = await requireAuthedToken(req);
    // The request body may carry only a counter code. userId/email/walletAddress
    // from the client are never read — identity comes from the verified token.
    const body = (await req.json().catch(() => ({}))) as { counterCode?: string };
    // Verification (Privy verifyAuthToken) happens first inside awardStamp;
    // the customer is resolved only afterwards, and the store is written last.
    const award = await runAwardCore(buildAwardDeps(token), {
      token,
      counterCode: body.counterCode,
    });

    const response: AwardResponse = {
      mode: award.mode,
      balance: award.newBalance,
      customer: award.customer,
    };
    return Response.json(response);
  } catch (err) {
    return sendError(err);
  }
}