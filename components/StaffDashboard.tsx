"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { AwardResponse, StaffCustomersResponse } from "@/lib/domain";

interface StaffDashboardProps {
  getToken: () => Promise<string>;
  onAwarded: () => void;
  onLogout: () => void;
}

export function StaffDashboard({ getToken, onAwarded, onLogout }: StaffDashboardProps) {
  const [data, setData] = useState<StaffCustomersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [counterCode, setCounterCode] = useState("");
  const [awardResult, setAwardResult] = useState<AwardResponse | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const customers = await apiFetch<StaffCustomersResponse>("/api/staff/customers", {
        token: await getToken(),
      });
      setData(customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    setAwardResult(null);
    try {
      const result = await apiFetch<AwardResponse>("/api/stamps/award", {
        token: await getToken(),
        method: "POST",
        body: { counterCode },
      });
      setAwardResult(result);
      setCounterCode("");
      onAwarded();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>Staff — Bakery counter</h1>
            <span className="muted" style={{ fontSize: 13 }}>
              Redeem customer counter codes to award stamps
            </span>
          </div>
          <button type="button" className="btn" onClick={onLogout}>
            Sign out
          </button>
        </div>

        <div className="row">
          <input
            className="input fill"
            placeholder="Counter code (e.g. 123456)"
            value={counterCode}
            maxLength={6}
            onChange={(e) => setCounterCode(e.target.value.replace(/\D/g, ""))}
            aria-label="Counter code"
            data-testid="staff-code-input"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void redeem()}
            disabled={busy || counterCode.length < 6}
            data-testid="staff-redeem-button"
          >
            Redeem
          </button>
        </div>

        {awardResult ? (
          <div className="msg ok" data-testid="staff-award-result">
            Stamped <strong>{awardResult.customer.email ?? awardResult.customer.userId}</strong>
            {" — "}
            now at {awardResult.balance} stamps.
          </div>
        ) : null}
        {error ? <div className="msg error">{error}</div> : null}

        {data ? (
          <table className="customers">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Card / wallet</th>
                <th>Stamps</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.userId}>
                  <td>{c.email ?? c.displayName ?? c.userId}</td>
                  <td>
                    <code>{c.walletAddress ? `${c.walletAddress.slice(0, 6)}…${c.walletAddress.slice(-4)}` : c.userId.slice(0, 18)}</code>
                  </td>
                  <td data-testid={`stamp-balance-${c.userId}`}>{c.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Loading customers…</p>
        )}

        {data ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {data.totalCustomers} customers · {data.totalStamps} stamps awarded · free loaf at{" "}
            {data.freeLoafThreshold}
          </p>
        ) : null}
      </div>
    </main>
  );
}