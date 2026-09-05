import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedIdentity } from "@/lib/privy-server";
import { redeemCake } from "@/lib/store";

export async function POST(req: NextRequest) {
  let identity;
  try {
    identity = await requireVerifiedIdentity(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const balance = redeemCake(identity.privyDid);
    return NextResponse.json(balance);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Redemption failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
