"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CheckCircle2, Play, Search, Smartphone, TestTube2 } from "lucide-react";
import { getSupabaseBrowserClient } from "../lib/supabase-client";

const knownTestAccounts = [
  { userId: "6000704413", label: "Known account A" },
  { userId: "8011221964", label: "Known account B" },
  { userId: "7086855163", label: "Known account C" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function VerificationTestPanel() {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [userId, setUserId] = useState("");
  const [startDate, setStartDate] = useState("2026-07-31");
  const [endDate, setEndDate] = useState(todayIso());
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const normalized = useMemo(() => userId.replace(/\D/g, ""), [userId]);
  const valid = normalized.length === 10 && startDate <= endDate;

  async function resolveWorker(value: string) {
    if (!supabase || value.length !== 10) { setWorkerName(null); return; }
    const { data } = await supabase
      .from("workers")
      .select("name,user_id")
      .eq("user_id", value)
      .maybeSingle();
    setWorkerName(data?.name ?? null);
  }

  async function queueCustomRun() {
    if (!supabase || !session || !valid) return;
    setBusy(true); setStatus(null); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("queue_single_verification_run", {
        p_user_id: normalized,
        p_start: startDate,
        p_end: endDate,
      });
      if (rpcError) throw rpcError;
      setStatus(`Custom UID verification queued successfully. Run ID: ${String(data)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!authReady) return <main className="auth-page"><section className="card auth-card">Checking officer sessionÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦</section></main>;
  if (!session) return <main className="auth-page"><section className="card auth-card"><h1>Custom UID Test</h1><p>Sign in on the main Project Rekhya dashboard first, then open this page again.</p><Link className="button primary" href="/">Back to Dashboard</Link></section></main>;

  return (
    <main className="app-shell">
      <section className="card report" style={{ maxWidth: 920, margin: "32px auto" }}>
        <div className="report-header">
          <div>
            <h2><TestTube2 size={20} /> Custom UID Verification Test</h2>
            <p>Queue exactly one User ID for real PMFBY verification. This is for controlled physical regression, especially Unpaid-list scrolling and evidence capture.</p>
          </div>
          <Link className="button" href="/"><ArrowLeft size={14} /> Dashboard</Link>
        </div>

        <div className="notice warning">
          <strong>Physical test control:</strong> this does not simulate records. When the local automation agent is running and the Android phone is connected, it queues the selected real User ID through the same production verification pipeline.
        </div>

        <div className="filter-grid">
          <div className="field">
            <label htmlFor="custom-user-id">User ID</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="custom-user-id" className="control" inputMode="numeric" maxLength={10} value={userId}
                onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 10); setUserId(value); void resolveWorker(value); }}
                placeholder="Enter 10-digit User ID" />
              <button className="button" type="button" disabled={normalized.length !== 10} onClick={() => void resolveWorker(normalized)}><Search size={14} /> Check</button>
            </div>
            <span className="table-note">{workerName ? `Matched: ${workerName}` : normalized.length === 10 ? "No active Master match shown yet" : "Enter a Master User ID"}</span>
          </div>
          <div className="field"><label htmlFor="test-start">Start Date</label><input id="test-start" className="control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="field"><label htmlFor="test-end">End Date</label><input id="test-end" className="control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        </div>

        <div style={{ marginTop: 16 }}>
          <strong>Known physical-test accounts</strong>
          <p className="table-note">Quick-fill only. The app still uses the current live Master credential and current PMFBY Unpaid list.</p>
          <div className="report-actions">
            {knownTestAccounts.map((item) => <button key={item.userId} className="button" type="button" onClick={() => { setUserId(item.userId); void resolveWorker(item.userId); }}>{item.label}: {item.userId}</button>)}
          </div>
        </div>

        <div className="report-actions" style={{ marginTop: 20 }}>
          <button className="button primary" type="button" disabled={!valid || busy || !workerName} onClick={() => void queueCustomRun()}>
            {busy ? <Smartphone size={14} /> : <Play size={14} />} {busy ? "QueueingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "Verify This UID in PMFBY"}
          </button>
        </div>

        {status && <div className="notice success" style={{ marginTop: 16 }}><CheckCircle2 size={16} /> {status}</div>}
        {error && <div className="notice warning" style={{ marginTop: 16 }}><strong>Could not queue:</strong> {error}</div>}
      </section>
    </main>
  );
}
