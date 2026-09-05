# Ramesh's Bakery — Loyalty Card That Can't Be Copied

A digital loyalty punch card. Ten stamps, one free cake — living somewhere a photocopier
cannot reach.

## Login methods enabled

- **Email** (one-time code)
- **Google**

Both are configured in `src/app/providers.tsx` via `PrivyProvider`'s `loginMethods`. No
browser extension and no external wallet are offered as sign-in paths — the only button on the
landing screen calls Privy's own `login()`.

`embeddedWallets.createOnLogin` is set to `'users-without-wallets'`, so the moment someone signs
in with an identity they already own, Privy silently provisions a self-custodial embedded wallet
for them. Nothing on screen ever says "create wallet" — by the time the signed-in screen renders,
the wallet already exists.

## How the server knows who is asking

A signed-in session in the browser proves nothing to the server by itself — a customer's phone
could claim to be anyone. So the award endpoint never trusts anything the client says about its
own identity:

1. The client calls `getAccessToken()` (from `usePrivy()`) and attaches it as
   `Authorization: Bearer <token>` on every request to `/api/stamps` and
   `/api/stamps/award`.
2. The server (`src/lib/privy-server.ts`) verifies that token with
   `@privy-io/server-auth`'s `PrivyClient.verifyAuthToken()` **before** touching any data. If
   verification throws for any reason — missing token, expired, tampered, wrong signature — the
   request is rejected with 401 and nothing is written.
3. The identifier the server stamps against is `claims.userId`, the verified token's Privy DID.
   It is never read from the request body, a query string, or a header the client set — it only
   ever comes out of a signature Privy itself validated.

That's the whole trust model: the server can prove a stamp belongs to whoever's token it just
cryptographically verified, and to no one else.

### Why staff still need a PIN

The award endpoint always stamps the **caller's own verified identity** — never an id staff type
in — so a customer can only ever be stamped through their *own* device and *own* access token.
To stop that turning into unlimited self-service stamping, staff enter a shared `STAFF_PIN`
(env var) on the customer's already-signed-in phone at checkout. The PIN is a business-rule gate
staff control; it is never used as an identity source. Identity always comes from the verified
token, per above.

## Handling the dull states

- **App still initializing** — `usePrivy()`'s `ready` flag is checked before any
  authenticated/unauthenticated branch renders (`src/app/page.tsx`), so a first-time visitor
  gets a loading placeholder instead of a flash of the wrong screen.
- **Login abandoned halfway** — if a customer closes the Privy login modal, `authenticated`
  simply never flips true and they land back on the sign-in screen; no partial state is created.
- **A stamp request that fails** — a wrong PIN, an expired token, or a network error each render
  a distinct, visible error message with a way to retry, instead of leaving the UI stuck on
  "stamping…" (`src/components/CustomerDashboard.tsx`).

## Beyond the brief

**Redemption flow.** Once a customer reaches 10 stamps, a "Redeem free cake" button appears.
Redeeming is itself a verified, server-side action (`/api/stamps/redeem`) that atomically
deducts 10 stamps and records a redemption event with a timestamp — the balance can't just climb
past 10 forever, and there's now a real history of cakes actually given out, not just a counter
that keeps going up.

This was chosen because the brief stops at "give staff a way to award a stamp, and the customer
a way to see their balance" — it never closes the loop on what happens once ten stamps are
reached. Without redemption, the "app" only ever counts; it never actually gives out the cake
the whole card exists for.

## Running it

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_SECRET (from the Privy Dashboard)
# and pick any STAFF_PIN
npm install
npm run dev
```

Stamp balances persist to a local JSON file at `data/loyalty.json` (gitignored — this is
runtime state, not source).

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- `@privy-io/react-auth` — client-side login + embedded wallet
- `@privy-io/server-auth` — server-side access token verification

## Read-only / no on-chain writes

This deliverable tracks stamps in a simple server-side store keyed by the customer's verified
Privy DID. No transaction is signed or sent — the "wallet" requirement here is about
self-custodial identity, not on-chain state.
