"use client";

import { usePrivy } from "@privy-io/react-auth";
import { InitializingScreen } from "./InitializingScreen";
import { LoginScreen } from "./LoginScreen";
import { LoyaltyDashboard } from "./LoyaltyDashboard";

export { SUPPORTED_LOGIN_METHODS } from "./LoginScreen";

export function LoyaltyShell() {
  const { ready, authenticated } = usePrivy();

  // P7-4: handle ready === false before any auth-dependent UI renders.
  if (!ready) {
    return <InitializingScreen />;
  }

  // P7-3: the signed-in view only renders from Privy's authenticated state.
  if (!authenticated) {
    return <LoginScreen />;
  }

  return <LoyaltyDashboard />;
}