# Ramesh's Bakery — Loyalty Card That Can't Be Copied

A digital loyalty punch card. Ten stamps, one free loaf — living somewhere a photocopier
cannot reach, and stamped only against an identity the server itself has verified.

## Login methods enabled

- **Email** (one-time code)
- **Google**

Both are whatever this Privy app's dashboard has enabled — `app/providers.tsx` doesn't
override `loginMethods`, so the login modal simply reflects the app's live configuration.
No browser extension and no external wallet are offered as sign-in paths — the only button
on the landing screen calls Privy's own `login()`.

`embeddedWallets.ethereum.createOnLogin` is set to `'users-without-wallets'`, so the moment
someone signs in with an identity they already own, Privy silently provisions a self-custodial
embedded wallet for them. Nothing on screen ever says "create wallet" — by the time the
signed-in card renders, the wallet already exists.

## How the server knows who is asking

A signed-in session in the browser proves nothing to the server by itself. So every write
route follows the same rule: verify first, trust nothing else.

1. The client calls `getAccessToken()` and attaches it as `Authorization: Bearer <token>` on
   every request (`lib/client.ts`).
2. The server (`lib/auth.ts`) verifies that token with `@privy-io/server-auth`'s
   `PrivyClient.verifyAuthToken()` **before** touching the database. If verification throws for
   any reason — missing token, expired, tampered, wrong signature — the request is rejected
   with 401 and nothing is written.
3. The identifier every stamp is written against is `claims.userId`, the verified token's Privy
   DID. It is never read from the request body, a query string, or a header the client set.

That's the whole trust model: the server can prove a stamp belongs to whoever's token it just
cryptographically verified, and to no one else.

### How a stamp gets awarded without staff ever naming a customer

Two paths exist, and both still resolve identity purely from verified claims:

- **Self-service** — the customer taps *Add stamp*. The award is written against their own
  `claims.userId`, straight from their own verified token.
- **Counter redemption** — the customer taps *Check in at the counter*, which mints a one-time
  6-digit code bound server-side to their own verified identity at the moment of minting
  (`lib/store.ts:createCounterCode`). A staff member — someone signed in with their own Privy
  session, checked against `STAFF_EMAILS` (`lib/staff.ts`) — redeems that code. Staff never
  supplies a customer id anywhere; the server looks up whichever identity the code was bound to
  when the *customer* minted it. A non-staff account that tries to redeem a code gets
  `403 STAFF_REQUIRED`, and a used, unknown, or expired code gets `409 INVALID_CODE`.

## The 10-stamp cap holds even under a race

Stamps are stored in SQLite (`better-sqlite3`), and every award runs inside a transaction that
does a **conditional** `UPDATE customers SET balance = balance + 1 WHERE user_id = ? AND balance
< 10`. If two award requests for the same card land at the same instant, only one can win the
conditional update — the other sees zero rows changed and the transaction throws
`CARD_COMPLETE` instead of silently over-stamping. The cap isn't just an `if` check in
application code; it's enforced by the same statement that writes the balance.

## Handling the dull states

- **App still initializing** — `usePrivy()`'s `ready` flag is checked before any
  authenticated/unauthenticated branch renders (`components/LoyaltyShell.tsx`), so a first-time
  visitor gets a loading placeholder instead of a flash of the wrong screen.
- **Login abandoned halfway** — if a customer closes the Privy login modal, `authenticated`
  simply never flips true and they land back on the sign-in screen; no partial state is created.
- **A stamp request that fails** — an expired token, a card already at 10/10, a wrong or reused
  counter code, or a non-staff redemption attempt each return a distinct HTTP status and error
  code (`401 INVALID_TOKEN`, `409 CARD_COMPLETE`, `409 INVALID_CODE`, `403 STAFF_REQUIRED`) and
  render as a visible message in `LoyaltyDashboard`/`StaffDashboard`, never a silent failure.

## Known limitation: self-service has no cooldown

*Add stamp* has no rate limit — a signed-in customer could tap it repeatedly and fill their own
card without a single visit to the bakery. This doesn't compromise the identity/verification
model (every stamp is still attributed to a real, server-verified identity, never a forged one),
but it does undercut the physical-presence trust the counter-code path was built for. Treated
here as a documented limitation rather than silently shipped as if it were harmless: the honest
fix would be a per-user cooldown or removing the self-service path entirely and requiring every
stamp to go through staff redemption.

## Running it

```bash
cp .env.example .env
# fill in PRIVY_APP_ID, PRIVY_APP_SECRET, NEXT_PUBLIC_PRIVY_APP_ID (from dashboard.privy.io)
# optionally STAFF_EMAILS=comma,separated,staff@emails
npm install
npm run dev
```

```bash
npm test          # unit + component + route + secret-scan tests
npm run typecheck # tsc --noEmit
npm run build     # production build
```

Card state persists to a local SQLite file at `data/loyalty.db` (gitignored — this is runtime
state, not source).

## Stack

- Next.js (App Router) + TypeScript
- `@privy-io/react-auth` — client-side login + embedded wallet
- `@privy-io/server-auth` — server-side access token verification
- `better-sqlite3` — transactional, race-safe stamp ledger
- Vitest + Testing Library — unit, component, route, and secret-scan tests

## Read-only / no on-chain writes

This deliverable tracks stamps in a SQLite store keyed by the customer's verified Privy DID. No
transaction is signed or sent — the "wallet" requirement here is about self-custodial identity,
not on-chain state.
