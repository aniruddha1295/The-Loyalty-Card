import type { NextRequest } from "next/server";
import { AppConfigError, TokenVerificationError, readBearerToken } from "./auth";
import { AwardRejectedError } from "./award";
import { StampLimitReachedError } from "./store";

export async function requireAuthedToken(req: NextRequest): Promise<string> {
  const token = readBearerToken(req);
  if (!token) throw new TokenVerificationError();
  return token;
}

export function sendError(err: unknown): Response {
  if (err instanceof TokenVerificationError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof AwardRejectedError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof StampLimitReachedError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof AppConfigError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[rtd-p7]", err);
  return Response.json({ error: "Internal server error." }, { status: 500 });
}