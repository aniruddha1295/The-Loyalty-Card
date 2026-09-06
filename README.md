# Loyalty Card

*"The Loyalty Card That Can't Be Copied" — Road to Devcon III, Build Battle Week 3, PS 1.*

A bakery loyalty card whose stamps can only ever be written against a server-verified Privy
identity — never against anything the browser claims about itself. Sign in with Google or email
through Privy, get an embedded wallet bound to that login at the same moment, then collect
stamps either self-service or through a one-time counter code redeemed by staff. Buy 9 loaves,
get the 10th free — and the card is hard-capped at 10 stamps by the database itself, not by a
check that a bug could skip.

## Award lifecycle

```
Sign-in (Privy)  ──▶  embedded wallet created (createOnLogin)  ──▶  GET /api/me
                                                                       (verified balance + staff flag)
                                                                              │
                          ┌───────────────────────────────────────────────────┤
                          ▼                                                   ▼
              POST /api/stamps/award {}                       POST /api/stamps/checkin
              (self-service, customer's own token)             (mints 6-digit code, bound to
                          │                                      claims.userId, TTL 5 min)
                          │                                                   │
                          │                                        staff signs in, checked
                          │                                        against STAFF_EMAILS
                          │                                                   │
                          │                              POST /api/stamps/award { counterCode }
                          │                                        (staff's own token; identity
                          │                                         resolved from the code's
                          │                                         binding, not the request)
                          ▼                                                   ▼
              store.awardStamp() — UPDATE customers SET balance = balance + 1
                                    WHERE user_id = ? AND balance < 10  (one transaction)
                          │
              0 rows changed  ──▶  StampLimitReachedError (409 CARD_COMPLETE)
              1 row changed   ──▶  new balance, stamp_events row inserted
```

- **`GET /api/me`** — verifies the token, then returns the caller's own balance, stamp count,
  and a `staff` boolean (`lib/staff.ts:isStaffMember`, checked against `STAFF_EMAILS`). This is
  what `LoyaltyDashboard` uses to decide whether to render the customer card or hand off to
  `StaffDashboard`.
- **`POST /api/stamps/checkin`** — verifies the token, refuses with `409 CARD_COMPLETE` if the
  caller's card is already at 10, otherwise mints a random 6-digit code
  (`lib/store.ts:createCounterCode`) bound to `claims.userId` with a TTL (default 5 minutes).
  The code is never bound to anything the client sends — only to the identity the token just
  proved.
- **`POST /api/stamps/award`** — the only write path. Verifies the token first
  (`lib/award.ts:awardStamp`); nothing else runs if verification throws. If the request carries
  a `counterCode`, the caller must be staff (`403 STAFF_REQUIRED` if not) and the code must be
  unused and unexpired (`409 INVALID_CODE` if not) — the stamp then goes to **the code's bound
  user**, never to whoever is calling. With no code, the stamp goes to the caller's own
  `claims.userId` (self-service). Either way, the identifier written against always traces back
  to a verified token — the caller's own, or the one that minted the code.
- **`GET /api/staff/customers`** — verifies the token and requires `isStaffMember`, otherwise
  `403 STAFF_REQUIRED`. Lists every customer's balance for the counter view.
- **The cap itself lives in the store, not the route.** `awardStamp`'s SQL is a single
  conditional `UPDATE ... WHERE balance < 10` inside a `better-sqlite3` transaction
  (`lib/store.ts`). If two awards for the same card land back to back, only one can flip a row;
  the other sees zero rows changed and the transaction throws before any `stamp_events` row is
  inserted — no orphaned event, no eleventh stamp, and the guarantee holds even if the
  application-level pre-check in `lib/award.ts` were ever wrong.

## Why this satisfies the scored checks

| # | Check | How it's satisfied |
|---|-------|---------------------|
| 1 | A sign-in entry point calls a Privy login method | `components/LoginScreen.tsx` calls `usePrivy().login()` from its sign-in `<button>` — the only path into the app. |
| 2 | Authenticated users get a wallet without clicking to create one | `app/providers.tsx`'s `PRIVY_CONFIG` sets `embeddedWallets.ethereum.createOnLogin: "users-without-wallets"`; no button anywhere says "create wallet". |
| 3 | Route gating reads Privy's authenticated state | `components/LoyaltyShell.tsx` renders `<LoginScreen/>` until `usePrivy().authenticated` is true — never a self-set flag. |
| 4 | The initializing state is handled before auth-dependent UI renders | `LoyaltyShell` returns `<InitializingScreen/>` while `ready === false`, checked before the `authenticated` branch. |
| 5 | The award endpoint verifies the Privy access token server-side | `lib/award.ts:awardStamp` calls `deps.verifyToken(input.token)` as its first line; every downstream step (staff check, code consumption, store write) is unreachable if that throws. |
| 6 | The stamped identity comes from the verified token claims | Self-service: `claims.userId` directly. Staff redemption: `deps.store.consumeCounterCode(code).userId` — itself set from `claims.userId` at the moment the *customer* minted the code. The request body's only field is `counterCode`; no user id ever comes from it. |
| 7 | The client sends the access token with the award request | `lib/client.ts:apiFetch` attaches `Authorization: Bearer <token>` from `getAccessToken()` on every call. |
| 8 | No credential appears in any tracked file | `PRIVY_APP_SECRET`/`PRIVY_APP_ID` are read from `process.env` only; `.env`/`.env.local` are gitignored; `.env.example` ships placeholders only; `tests/secret-scan.test.ts` scans every tracked source file for secret-shaped strings. |

## Adversarial audit findings

Before finalizing this repo it was reviewed against each of the 8 scored checks and the
problem's own narrative (a card a photocopier — or a screenshot — can't fake). One real gap was
found and, after discussion, deliberately left as a documented limitation rather than patched
under time pressure:

- **Self-service stamping has no cooldown.** `POST /api/stamps/award` with no `counterCode`
  stamps the caller's own verified identity — which passes check 6 correctly — but nothing
  stops a signed-in customer from calling it repeatedly and filling their own card without a
  single visit to the bakery. This doesn't break the identity/verification model (every stamp is
  still attributed to a real, server-verified account, never a forged one), but it does undercut
  the physical-presence trust the counter-code path exists for — Ramesh's whole complaint was
  unsupervised stamping, and an ungated self-service button reintroduces a version of it. The
  honest fix would be a per-user cooldown (e.g. one self-service stamp per rolling 24h) or
  removing the self-service path entirely and requiring every stamp to go through staff
  redemption; neither is implemented here.

## Beyond-brief feature: dual redemption paths + a real automated test suite

The brief asks for "a way for staff to award a stamp, and the customer a way to see their
balance." This repo does more than the minimum on both the mechanism and the verification:

1. **Two independent, fully server-verified redemption paths** instead of one — self-service for
   the common case, and a one-time counter-code binding for staff-mediated redemption that
   never requires staff to name or look up a customer. The code-binding pattern is also what
   makes check 6 satisfiable without a shared secret or a client-supplied user id: the identity
   is resolved from a value the *customer's own token* produced earlier, not from anything the
   redeeming request carries.
2. **37 automated tests** across 6 files — unit tests for the store's atomicity (including a
   same-tick "two awards racing on a card at 9" case), the award core's identity/staff/cap
   logic, route-level tests for every error code, component tests for the `ready`/`authenticated`
   gating, and a dedicated secret-scan test — rather than relying on a manual read-through to
   confirm the checks above. Actual captured output from `npm test`:

```
 RUN  v4.1.11 loyalty-card-that-cant-be-copied

 Test Files  6 passed (6)
      Tests  37 passed (37)
   Duration  1.81s
```

This was chosen because check 5 and check 6 (server-side verification, identity from verified
claims) are exactly the properties a manual demo can look right on the happy path while still
being wrong under a race or a malformed request — `tests/store.test.ts`'s racing-award case and
`tests/award-route.test.ts`'s per-error-code coverage exist specifically to catch that.

## Testing

```bash
npm test          # 37 tests / 6 files — unit + component + route + secret-scan
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Running it

```bash
cp .env.example .env
# fill in PRIVY_APP_ID, PRIVY_APP_SECRET, NEXT_PUBLIC_PRIVY_APP_ID (from dashboard.privy.io)
# optionally STAFF_EMAILS=comma,separated,staff@emails
npm install
npm run dev        # http://localhost:3000
```

Card state persists to a local SQLite file at `data/loyalty.db` (gitignored — this is runtime
state, not source). `npm run check:auth -- <access-token>` exercises `verifyAuthToken` directly
against the real Privy app for a quick server-config sanity check.

## Project layout

```
app/api/me/route.ts               verified identity + balance
app/api/stamps/checkin/route.ts   issue one-time counter code (refused at 10/10)
app/api/stamps/award/route.ts     stamp a card — self-service or staff redemption
app/api/staff/customers/route.ts  staff roster view
components/                       LoginScreen, InitializingScreen, LoyaltyShell, dashboards
lib/                              auth, store, award core (DI), staff, client, http, domain
scripts/                          check:auth (Privy env probe), normalize:stamps (data repair)
tests/                            unit + component + route + secret-scan tests (6 files, 37 tests)
data/                             SQLite (gitignored)
```
