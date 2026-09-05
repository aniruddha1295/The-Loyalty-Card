"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LoginScreen } from "@/components/LoginScreen";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export default function Home() {
  const { ready, authenticated } = usePrivy();

  // The app is still figuring out whether anyone is signed in — commit to
  // nothing yet. This must run before any authenticated/unauthenticated
  // branch, otherwise a first-time visitor flashes the wrong screen.
  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="animate-pulse text-stone-500">Warming up the oven…</div>
      </main>
    );
  }

  if (!authenticated) {
    return <LoginScreen />;
  }

  return <CustomerDashboard />;
}
