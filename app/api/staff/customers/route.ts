import type { NextRequest } from "next/server";
import { resolveUser, verifyAccessToken } from "@/lib/auth";
import { AwardRejectedError } from "@/lib/award";
import { loadStore } from "@/lib/deps";
import { FREE_LOAF_THRESHOLD } from "@/lib/domain";
import type { StaffCustomersResponse } from "@/lib/domain";
import { requireAuthedToken, sendError } from "@/lib/http";
import { isStaffMember } from "@/lib/staff";

export async function GET(req: NextRequest) {
  try {
    const token = await requireAuthedToken(req);
    const claims = await verifyAccessToken(token);
    if (!(await isStaffMember(await resolveUser(token, claims)))) {
      throw new AwardRejectedError("STAFF_REQUIRED", "Staff access required.", 403);
    }

    const store = loadStore();
    const customers = store.listCustomers();
    const body: StaffCustomersResponse = {
      customers,
      freeLoafThreshold: FREE_LOAF_THRESHOLD,
      totalStamps: customers.reduce((sum, c) => sum + c.balance, 0),
      totalCustomers: customers.length,
    };
    return Response.json(body);
  } catch (err) {
    return sendError(err);
  }
}