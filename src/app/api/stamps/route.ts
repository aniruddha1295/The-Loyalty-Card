import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedIdentity } from "@/lib/privy-server";
import { getBalance } from "@/lib/store";

export async function GET(req: NextRequest) {
  let identity;
  try {
    identity = await requireVerifiedIdentity(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const balance = getBalance(identity.privyDid);
  return NextResponse.json(balance);
}
