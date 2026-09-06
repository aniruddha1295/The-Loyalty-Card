import type { AuthTokenClaims } from "@privy-io/server-auth";
import { TokenVerificationError } from "./auth";
import { MAX_STAMPS_PER_CARD } from "./domain";
import type { StampAward } from "./domain";
import { StampLimitReachedError } from "./store";
import type { LoyaltyStore } from "./store";

export { TokenVerificationError } from "./auth";

export class AwardRejectedError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AwardRejectedError";
    this.code = code;
    this.status = status;
  }
}

export type TokenVerifier = (token: string) => Promise<AuthTokenClaims>;
export type StaffCheck = (claims: AuthTokenClaims) => boolean | Promise<boolean>;

export interface AwardDeps {
  verifyToken: TokenVerifier;
  store: LoyaltyStore;
  isStaff: StaffCheck;
}

export interface AwardInput {
  token: string;
  counterCode?: string | null;
}

/**
 * Stamp a loyalty card.
 *
 * Identity is derived exclusively from the server-verified access token:
 * `claims.userId` for a customer stamping their own card, or the verified
 * customer binding behind a one-time counter code for staff redemptions.
 * Request-body identity fields (userId/email/wallet) are intentionally not
 * part of the input contract and are never read.
 */
export async function awardStamp(deps: AwardDeps, input: AwardInput): Promise<StampAward> {
  let claims: AuthTokenClaims;
  try {
    // 1) VERIFY server-side. Nothing below (staff check, code consume, store write)
    //    runs until the access token has been verified with real Privy key material.
    claims = await deps.verifyToken(input.token);
  } catch (err) {
    if (err instanceof TokenVerificationError) throw err;
    throw new TokenVerificationError();
  }

  const code = (input.counterCode ?? "").trim();
  let customerUserId = claims.userId;
  let mode: StampAward["mode"] = "customer-self";

  if (code) {
    mode = "staff-customer";
    if (!(await deps.isStaff(claims))) {
      throw new AwardRejectedError(
        "STAFF_REQUIRED",
        "Only bakery staff may redeem a counter code.",
        403,
      );
    }
    const binding = deps.store.consumeCounterCode(code);
    if (!binding) {
      throw new AwardRejectedError(
        "INVALID_CODE",
        "Invalid, expired, or already-used counter code.",
        409,
      );
    }
    customerUserId = binding.userId;
  }

  // Pre-check the cap so a complete card fails fast with a defined outcome and
  // no useless writes. The store's conditional UPDATE remains the authoritative
  // guard for concurrent in-flight awards.
  const current = deps.store.getCustomer(customerUserId);
  if ((current?.balance ?? 0) >= MAX_STAMPS_PER_CARD) {
    throw new StampLimitReachedError();
  }

  const { customer, newBalance } = deps.store.awardStamp({
    userId: customerUserId,
    awardedBy: claims.userId,
    viaCode: code || null,
  });

  return { mode, awarderUserId: claims.userId, customer, newBalance };
}