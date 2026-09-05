import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedIdentity } from "@/lib/privy-server";
import { awardStamp } from "@/lib/store";

// The award is always issued against whoever's access token this request
// carries — never against an id/address the caller supplies. Staff never
// hold their own award-granting session; they authorize on the *customer's*
// already-signed-in device by entering the PIN below. This is what makes the
// write trustworthy: the server never takes the browser's word for identity,
// only the verified token's claims.
export async function POST(req: NextRequest) {
  let identity;
  try {
    identity = await requireVerifiedIdentity(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized: invalid or missing access token" }, { status: 401 });
  }

  const staffPin = process.env.STAFF_PIN;
  if (!staffPin) {
    return NextResponse.json({ error: "Server misconfigured: STAFF_PIN not set" }, { status: 500 });
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  if (body.pin !== staffPin) {
    return NextResponse.json({ error: "Incorrect staff PIN" }, { status: 403 });
  }

  const balance = awardStamp(identity.privyDid);
  return NextResponse.json(balance);
}
