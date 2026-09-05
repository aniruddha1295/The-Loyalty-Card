"use client";

import { usePrivy } from "@privy-io/react-auth";

export function LoginScreen() {
  const { login } = usePrivy();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h1 className="text-3xl font-semibold text-amber-900">Ramesh&apos;s Bakery</h1>
        <p className="mt-2 max-w-sm text-stone-600">
          Ten stamps, one free cake. Sign in with your email or Google — no card, no
          app to install, no photocopier can touch it.
        </p>
      </div>
      <button
        onClick={login}
        className="rounded-full bg-amber-800 px-8 py-3 text-lg font-medium text-white shadow hover:bg-amber-900 transition-colors"
      >
        Sign in to see my stamps
      </button>
    </main>
  );
}
