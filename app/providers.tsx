"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { PrivyProviderProps } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export const PRIVY_CONFIG = {
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets" as const,
    },
  },
} satisfies PrivyProviderProps["config"];

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return (
      <main className="screen">
        <div className="card error-card">
          <h1>Server not configured</h1>
          <p>
            Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in <code>.env</code> (see{" "}
            <code>.env.example</code>).
          </p>
        </div>
      </main>
    );
  }
  return (
    <PrivyProvider appId={appId} config={PRIVY_CONFIG}>
      {children}
    </PrivyProvider>
  );
}