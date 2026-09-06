"use client";

import { usePrivy } from "@privy-io/react-auth";

export const SUPPORTED_LOGIN_METHODS = ["google", "email"] as const;

export function LoginScreen() {
  // P7-1: the interactive sign-in element directly invokes a real Privy login
  // method (usePrivy().login) — no fake/hardcoded authenticated state anywhere.
  const { login } = usePrivy();

  return (
    <main className="screen">
      <div className="card">
        <h1>Ramesh&apos;s Bakery</h1>
        <p className="muted">
          Buy 9 loaves, get the 10th free. Your loyalty card is tied to your verified login — so
          it can&apos;t be copied.
        </p>
        <button
          data-testid="signin-button"
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => login({ loginMethods: [...SUPPORTED_LOGIN_METHODS] })}
        >
          Sign in to open your card
        </button>
        <p className="muted" style={{ fontSize: 13 }}>
          Secure sign-in by Privy. Your card and companion embedded wallet are created when you log
          in.
        </p>
      </div>
    </main>
  );
}