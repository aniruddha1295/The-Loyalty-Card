"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { AwardResponse, CheckinResponse, MeResponse } from "@/lib/domain";
import { StaffDashboard } from "./StaffDashboard";

export function LoyaltyDashboard() {
  const { user, logout, getAccessToken } = usePrivy();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<CheckinResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const getToken = useCallback(async (): Promise<string> => (await getAccessToken()) ?? "", [
    getAccessToken,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const data = await apiFetch<MeResponse>("/api/me", { token: await getToken() });
        if (!cancelled) setMe(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, reload]);

  const checkIn = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCode(null);
    try {
      const data = await apiFetch<CheckinResponse>("/api/stamps/checkin", {
        token: await getToken(),
        method: "POST",
      });
      setCode(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stampSelf = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetch<AwardResponse>("/api/stamps/award", {
        token: await getToken(),
        method: "POST",
        body: {},
      });
      setMe((prev) => (prev ? { ...prev, balance: data.balance, stampCount: data.balance } : prev));
      setNotice(`Stamp added — your card now has ${data.balance} stamp${data.balance === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const offerFreeLoaf = (balance: number) => balance > 0 && balance % 10 === 0;

  if (!me) {
    if (error) {
      return (
        <main className="screen">
          <div className="card error-card">
            <h1>Couldn&apos;t load your card</h1>
            <div className="msg error">{error}</div>
          </div>
        </main>
      );
    }
    return (
      <main className="screen">
        <div className="card" aria-busy="true">
          <p className="muted">Loading your card…</p>
        </div>
      </main>
    );
  }

  if (me.staff) {
    return (
      <StaffDashboard
        getToken={getToken}
        onAwarded={() => setReload((n) => n + 1)}
        onLogout={() => void logout()}
      />
    );
  }

  const stampsFilled = Array.from({ length: Math.min(me.balance, me.freeLoafThreshold) }, (_, i) => i);
  const stampsEmpty = Array.from(
    { length: Math.max(0, me.freeLoafThreshold - Math.min(me.balance, me.freeLoafThreshold)) },
    (_, i) => i,
  );
  const cardComplete = me.balance >= me.freeLoafThreshold;

  return (
    <main className="screen">
      <div className="card">
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>Ramesh&apos;s Bakery</h1>
            <span className="muted" style={{ fontSize: 13 }}>
              Loyalty card
            </span>
          </div>
          <button type="button" className="btn" onClick={() => void logout()}>
            Sign out
          </button>
        </div>

        <p data-testid="customer-email" className="muted">
          {me.email ?? me.userId}
          {offerFreeLoaf(me.balance) ? <span className="tag"> 🎉 Free loaf ready</span> : null}
        </p>
        {me.walletAddress ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Card wallet: <code>{`${me.walletAddress.slice(0, 6)}…${me.walletAddress.slice(-4)}`}</code>
          </p>
        ) : null}

        <div className="stamps" aria-label={`${me.balance} stamps collected`}>
          {stampsFilled.map((i) => (
            <span key={`f${i}`} className="stamp-dot filled" />
          ))}
          {stampsEmpty.map((i) => (
            <span key={`e${i}`} className="stamp-dot" />
          ))}
        </div>
        <p className="progress-label" data-testid="stamp-count">
          {me.balance} of {me.freeLoafThreshold} stamps
        </p>

        {notice ? <div className="msg ok">{notice}</div> : null}
        {error ? <div className="msg error">{error}</div> : null}

        <div className="row" style={{ marginTop: 16 }}>
          {cardComplete ? (
            <div className="msg ok" data-testid="card-complete" style={{ width: "100%" }}>
              <strong>Card complete</strong> — all {me.freeLoafThreshold} stamps collected.
              <br />
              <span className="muted">
                Show this card at the counter to claim your free loaf. No more stamps can be added.
              </span>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary fill"
                onClick={() => void checkIn()}
                disabled={busy}
              >
                Check in at the counter
              </button>
              <button type="button" className="btn" onClick={() => void stampSelf()} disabled={busy}>
                Add stamp
              </button>
            </>
          )}
        </div>

        {code ? (
          <div>
            <div className="code-badge" data-testid="counter-code">
              {code.code}
            </div>
            <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>
              One-time code, valid {code.ttlMinutes} min. Show it to bakery staff — they&apos;ll
              stamp your card.
            </p>
          </div>
        ) : null}

        <p className="muted" style={{ fontSize: 12, marginTop: 20 }}>
          Signed in as {user?.id ?? me.userId}. Every stamp is recorded against your verified
          session; identity comes from server-verified claims, never from what your browser sends.
        </p>
      </div>
    </main>
  );
}