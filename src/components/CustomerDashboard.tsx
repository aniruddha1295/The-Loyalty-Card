"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

type Balance = {
  stamps: number;
  stampsPerCake: number;
  redemptions: { at: string }[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; balance: Balance };

type AwardState =
  | { kind: "idle" }
  | { kind: "entering-pin" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function CustomerDashboard() {
  const { user, logout, getAccessToken } = usePrivy();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [award, setAward] = useState<AwardState>({ kind: "idle" });
  const [pin, setPin] = useState("");

  const walletAddress = user?.wallet?.address;

  const fetchBalance = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/stamps", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setState({ kind: "error", message: "Could not load your stamps. Try again." });
        return;
      }
      const balance = (await res.json()) as Balance;
      setState({ kind: "ready", balance });
    } catch {
      setState({ kind: "error", message: "Could not reach the bakery's server." });
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  async function submitAward(e: React.FormEvent) {
    e.preventDefault();
    setAward({ kind: "submitting" });
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/stamps/award", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAward({ kind: "error", message: body.error ?? "Could not award a stamp." });
        return;
      }
      const balance = (await res.json()) as Balance;
      setState({ kind: "ready", balance });
      setAward({ kind: "idle" });
      setPin("");
    } catch {
      setAward({ kind: "error", message: "Request failed. Check your connection and try again." });
    }
  }

  async function submitRedeem() {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/stamps/redeem", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAward({ kind: "error", message: body.error ?? "Could not redeem." });
        return;
      }
      const balance = (await res.json()) as Balance;
      setState({ kind: "ready", balance });
    } catch {
      setAward({ kind: "error", message: "Redemption request failed." });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-amber-900">My loyalty card</h1>
        <button onClick={logout} className="text-sm text-stone-500 underline">
          Sign out
        </button>
      </header>

      {walletAddress && (
        <p className="truncate text-xs text-stone-400">
          Wallet: {walletAddress}
        </p>
      )}

      {state.kind === "loading" && (
        <div className="animate-pulse rounded-xl bg-white p-6 text-stone-400 shadow">
          Loading your stamps…
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-xl bg-red-50 p-6 text-red-700 shadow">
          {state.message}
          <button onClick={fetchBalance} className="mt-3 block underline">
            Try again
          </button>
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <StampGrid stamps={state.balance.stamps} total={state.balance.stampsPerCake} />

          {state.balance.stamps >= state.balance.stampsPerCake && (
            <button
              onClick={submitRedeem}
              className="rounded-xl bg-emerald-700 px-4 py-3 font-medium text-white shadow hover:bg-emerald-800"
            >
              Redeem free cake 🎂
            </button>
          )}

          {state.balance.redemptions.length > 0 && (
            <p className="text-xs text-stone-400">
              {state.balance.redemptions.length} cake{state.balance.redemptions.length > 1 ? "s" : ""} redeemed so far.
            </p>
          )}

          <section className="rounded-xl bg-white p-4 shadow">
            <h2 className="mb-2 text-sm font-medium text-stone-500">
              Staff: award a stamp
            </h2>
            {award.kind !== "entering-pin" && (
              <button
                onClick={() => setAward({ kind: "entering-pin" })}
                className="w-full rounded-lg bg-amber-100 py-2 text-amber-900 hover:bg-amber-200"
              >
                Enter staff PIN
              </button>
            )}
            {(award.kind === "entering-pin" || award.kind === "submitting" || award.kind === "error") && (
              <form onSubmit={submitAward} className="flex flex-col gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Staff PIN"
                  className="rounded-lg border border-stone-300 px-3 py-2"
                />
                <button
                  type="submit"
                  disabled={award.kind === "submitting" || pin.length === 0}
                  className="rounded-lg bg-amber-800 py-2 text-white disabled:opacity-50"
                >
                  {award.kind === "submitting" ? "Stamping…" : "Stamp it"}
                </button>
                {award.kind === "error" && (
                  <p className="text-sm text-red-600">{award.message}</p>
                )}
              </form>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function StampGrid({ stamps, total }: { stamps: number; total: number }) {
  return (
    <div className="rounded-xl bg-white p-6 shadow">
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`aspect-square rounded-full border-2 ${
              i < stamps
                ? "border-amber-700 bg-amber-700"
                : "border-dashed border-stone-300"
            }`}
          />
        ))}
      </div>
      <p className="mt-4 text-center text-stone-600">
        {stamps} / {total} stamps
      </p>
    </div>
  );
}
