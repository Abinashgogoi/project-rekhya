"use client";

import {
  Activity, AlertTriangle, Bot, ChevronDown, CircleDollarSign, Database, Download, Eye,
  FileSpreadsheet, Gauge, HardDriveUpload, ListFilter, Menu, Pause, Play, RefreshCw,
  Search, ShieldCheck, Smartphone, Square, UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { downloadReconciliationWorkbook } from "../lib/excel-export";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase-client";
import type { Profile, ReconciliationRow } from "../types";

type AgentSummary = {
  total: number; completed: number; running: number; passwordPending: number; networkPending: number;
  currentUserId: string | null; currentStage: string | null;
  status: "idle" | "running" | "paused" | "disconnected";
};

const emptyAgent: AgentSummary = { total: 0, completed: 0, running: 0, passwordPending: 0, networkPending: 0, currentUserId: null, currentStage: null, status: "disconnected" };
const formatCount = new Intl.NumberFormat("en-IN");
const formatMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function DashboardApp({ allowDevelopmentShell }: { allowDevelopmentShell: boolean }) {
  const configured = isSupabaseConfigured();
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session) return;
    supabase.from("profiles").select("id,display_name,role,active").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [session, supabase]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true); setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthError(error.message);
    setLoading(false);
  }

  if (!authReady) return <div className="auth-page">Preparing secure workspace…</div>;
  if (configured && !session) {
    return <main className="auth-page"><section className="card auth-card"><div className="brand-mark">R</div><h1>Project Rekhya</h1><p>Authorized officer access for insurance verification, reconciliation and field settlement.</p><form className="auth-form" onSubmit={signIn}><div className="field"><label htmlFor="email">Officer email</label><input id="email" className="control" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="field"><label htmlFor="password">Password</label><input id="password" className="control" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>{authError && <p className="auth-error" role="alert">{authError}</p>}<button className="button primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in securely"}</button></form></section></main>;
  }
  if (!configured && !allowDevelopmentShell) return <main className="auth-page"><section className="card auth-card"><h1>Project Rekhya</h1><p className="auth-error">Secure data connection is not configured.</p></section></main>;
  return <OperationalDashboard session={session} profile={profile} developmentShell={!configured} />;
}

function OperationalDashboard({ session, profile, developmentShell }: { session: Session | null; profile: Profile | null; developmentShell: boolean }) {
  const supabase = getSupabaseBrowserClient();
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState("2026-07-31");
  const [endDate, setEndDate] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ start: "2026-07-31", end: today });
  const [search, setSearch] = useState("");
  const [block, setBlock] = useState("all");
  const [group, setGroup] = useState("all");
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [agent, setAgent] = useState<AgentSummary>(emptyAgent);
  const [error, setError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});

  const loadReport = useCallback(async () => {
    if (!supabase || !session) return;
    setReportLoading(true); setError(null);
    const { data, error: reportError } = await supabase.rpc("get_reconciliation_report", { p_start: appliedRange.start, p_end: appliedRange.end, p_block: block === "all" ? null : block, p_group: group === "all" ? null : group, p_search: search.trim() || null });
    if (reportError) setError(reportError.message); else setRows((data ?? []) as ReconciliationRow[]);
    const { data: agentData } = await supabase.from("agent_status").select("*").eq("singleton", true).maybeSingle();
    if (agentData) setAgent({ total: agentData.total_ids ?? 0, completed: agentData.completed_ids ?? 0, running: agentData.running_ids ?? 0, passwordPending: agentData.password_pending ?? 0, networkPending: agentData.network_pending ?? 0, currentUserId: agentData.current_user_id, currentStage: agentData.current_stage, status: agentData.status });
    setReportLoading(false);
  }, [appliedRange, block, group, search, session, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);
  useEffect(() => {
    if (!supabase || !session) return;
    const channel = supabase.channel("project-rekhya-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_records" }, () => void loadReport())
      .on("postgres_changes", { event: "*", schema: "public", table: "verification_jobs" }, () => void loadReport())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_status" }, () => void loadReport()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadReport, session, supabase]);

  const metrics = useMemo(() => ({ ids: rows.length, verified: rows.filter((row) => row.verification_status === "OK").length, portal: rows.reduce((sum, row) => sum + Number(row.portal_entry || 0), 0), app: rows.reduce((sum, row) => sum + Number(row.app_entry || 0), 0) }), [rows]);
  const blocks = useMemo(() => Array.from(new Set(rows.map((row) => row.block).filter(Boolean))).sort() as string[], [rows]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ ksReceived: sum.ksReceived + Number(row.krishi_sakhi_received || 0), ksPending: sum.ksPending + Number(row.krishi_sakhi_pending || 0), vendorReceived: sum.vendorReceived + Number(row.vendor_received || 0), vendorPending: sum.vendorPending + Number(row.vendor_pending || 0) }), { ksReceived: 0, ksPending: 0, vendorReceived: 0, vendorPending: 0 }), [rows]);

  async function revealCredential(workerId: string) {
    if (!session || revealed[workerId]) return;
    const response = await fetch(`/api/credentials/${workerId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const body = await response.json() as { password?: string; error?: string };
    if (!response.ok || !body.password) setError(body.error ?? "Credential could not be opened."); else setRevealed((current) => ({ ...current, [workerId]: body.password! }));
  }
  function draftKey(workerId: string, groupType: string, field: string) { return `${workerId}:${groupType}:${field}`; }
  async function savePayments(workerId: string) {
    if (!supabase || !session) return;
    for (const groupType of ["krishi_sakhi", "vendor"] as const) {
      const received = paymentDrafts[draftKey(workerId, groupType, "received")];
      const pending = paymentDrafts[draftKey(workerId, groupType, "pending")];
      if (received === undefined && pending === undefined) continue;
      const { error: saveError } = await supabase.from("payment_records").upsert({ worker_id: workerId, group_type: groupType, amount_received: received === "" || received === undefined ? null : Number(received), pending_amount: pending === "" || pending === undefined ? null : Number(pending), updated_by: session.user.id }, { onConflict: "worker_id,group_type" });
      if (saveError) { setError(saveError.message); return; }
    }
    setPaymentDrafts({}); await loadReport();
  }
  function applyFilters() {
    if (!startDate || !endDate || startDate > endDate) { setError("Start Date must be on or before End Date."); return; }
    setError(null); setAppliedRange({ start: startDate, end: endDate });
  }

  const displayName = profile?.display_name || session?.user.email || "Development review";
  const roleLabel = profile?.role?.replaceAll("_", " ") || (developmentShell ? "Empty-state review" : "Awaiting role assignment");
  const progress = agent.total ? Math.round((agent.completed / agent.total) * 100) : 0;

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">R</div><div><h1>Project Rekhya</h1><p>FIELD OPERATIONS</p></div></div><nav className="nav" aria-label="Primary navigation"><button className="nav-button active"><Gauge size={17} /> Operations</button><button className="nav-button"><FileSpreadsheet size={17} /> Portal Entry</button><button className="nav-button"><Smartphone size={17} /> App Entry</button><button className="nav-button"><ListFilter size={17} /> Reconciliation</button><button className="nav-button"><HardDriveUpload size={17} /> Evidence</button><button className="nav-button"><Activity size={17} /> Audit Log</button></nav><div className="sidebar-foot"><span className="live-dot" />Realtime synchronization</div></aside>
    <div className="workspace"><header className="topbar"><button className="mobile-menu" aria-label="Open menu"><Menu size={18} /></button><div className="topbar-copy"><h2>Verification Operations</h2><p>App, portal and field settlement in one verified view</p></div><div className="operator"><div className="operator-copy"><strong>{displayName}</strong><span>{roleLabel}</span></div><div className="operator-badge">{displayName.slice(0, 1).toUpperCase()}</div><ChevronDown size={15} color="#68766c" /></div></header>
      <main className="content">
        {developmentShell && <div className="notice warning"><strong>Development review:</strong> the interface is using the real empty state. No sample worker, portal, payment or verification data has been inserted.</div>}
        {profile?.role === "pending" && <div className="notice warning">Your account exists but an administrator must assign an operational role before records are available.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="status-strip" aria-label="System readiness"><strong>System readiness</strong><span className="status-item"><i className={`status-icon ${agent.status !== "disconnected" ? "ready" : "pending"}`} /> Android {agent.status === "disconnected" ? "not connected" : "connected"}</span><span className="status-item"><i className="status-icon pending" /> SIM check waits for phone</span><span className="status-item"><i className={`status-icon ${session ? "ready" : "pending"}`} /> Cloud sync {session ? "connected" : "development"}</span><span className="status-item"><i className="status-icon ready" /> Date range synchronized</span></div>
        <section className="summary-grid" aria-label="Selected-range summary"><Metric label="In-scope User IDs" value={metrics.ids} note={`${appliedRange.start} → ${appliedRange.end}`} icon={<UsersRound size={16} />} /><Metric label="Verified Accounts" value={metrics.verified} note="App identity status OK" icon={<ShieldCheck size={16} />} /><Metric label="Portal Entry" value={metrics.portal} note="Matched transaction rows" icon={<Database size={16} />} /><Metric label="App Entry" value={metrics.app} note="Normal ₹100 + High Entry" icon={<CircleDollarSign size={16} />} /></section>
        <section className="section-grid"><article className="card panel"><div className="panel-head"><div><h3>Android Verification Agent</h3><p>Controlled phone queue; technical machinery stays behind these controls.</p></div><span className={`pill ${agent.status === "running" ? "ok" : "pending"}`}>{agent.status === "disconnected" ? "Phone not connected" : agent.status}</span></div><div className="agent-state"><div className="agent-cell"><span>Total IDs</span><strong>{formatCount.format(agent.total)}</strong></div><div className="agent-cell"><span>Completed</span><strong>{formatCount.format(agent.completed)}</strong></div><div className="agent-cell"><span>Current User ID</span><strong>{agent.currentUserId ?? "—"}</strong></div><div className="agent-cell"><span>Current Stage</span><strong>{agent.currentStage ?? "Waiting for device"}</strong></div></div><div className="agent-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div><div className="agent-actions"><button className="button primary" disabled={agent.status === "disconnected"}><Play size={14} /> Start</button><button className="button" disabled={agent.status !== "running"}><Pause size={14} /> Pause</button><button className="button" disabled={agent.status !== "paused"}><Play size={14} /> Resume</button><button className="button" disabled={!agent.passwordPending && !agent.networkPending}><RefreshCw size={14} /> Retry pending</button><button className="button danger" disabled={agent.status === "disconnected" || agent.status === "idle"}><Square size={13} /> Stop safely</button></div></article>
          <article className="card panel"><div className="panel-head"><div><h3>Exception Queue</h3><p>One account never stops the full batch.</p></div><AlertTriangle size={19} color="#b77820" /></div><div className="queue-list"><div className="queue-row"><span>Password issue</span><strong className="amber">{agent.passwordPending}</strong></div><div className="queue-row"><span>Network/server pending</span><strong className="amber">{agent.networkPending}</strong></div><div className="queue-row"><span>Currently running</span><strong>{agent.running}</strong></div><div className="queue-row"><span>Manual review</span><strong className="red">0</strong></div></div></article></section>
        <section className="card report"><div className="report-header"><div><h3>Combined Reconciliation</h3><p>All in-scope User IDs for one inclusive Start Date–End Date range.</p></div><button className="button" onClick={() => void downloadReconciliationWorkbook(rows, appliedRange.start, appliedRange.end)} disabled={!rows.length}><Download size={15} /> Download Excel</button></div>
          <div className="filters"><div className="field search-field"><label htmlFor="search">Search User ID / Name</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", left: 11, top: 12, color: "#718078" }} /><input id="search" className="control" style={{ paddingLeft: 33 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type User ID or name" /></div></div><div className="field"><label htmlFor="block">Block</label><select id="block" className="control" value={block} onChange={(event) => setBlock(event.target.value)}><option value="all">All Blocks</option>{blocks.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><div className="field"><label htmlFor="group">Worker Type</label><select id="group" className="control" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">All Groups</option><option value="Krishi Sakhi">Krishi Sakhi</option><option value="Vendor">Vendor</option></select></div><div className="field"><label htmlFor="start">Start Date</label><input id="start" className="control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div className="field"><label htmlFor="end">End Date</label><input id="end" className="control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div><button className="button primary" style={{ alignSelf: "end" }} onClick={applyFilters}>Apply</button><button className="button" style={{ alignSelf: "end" }} onClick={() => void loadReport()} disabled={reportLoading}><RefreshCw size={14} /> {reportLoading ? "Loading" : "Refresh"}</button></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th rowSpan={2}>Sl No.</th><th rowSpan={2}>Name</th><th rowSpan={2}>User ID</th><th rowSpan={2}>Password</th><th rowSpan={2} className="num">Portal Entry</th><th rowSpan={2} className="num">App Entry</th><th rowSpan={2} className="num">High Entry</th><th colSpan={2}>Krishi Sakhi</th><th colSpan={2}>Vendor</th><th rowSpan={2}>Status</th><th rowSpan={2}>Evidence</th></tr><tr><th className="num">Amount Received</th><th className="num">Pending Amount</th><th className="num">Amount Received</th><th className="num">Pending Amount</th></tr></thead><tbody>
            {!rows.length && <tr><td className="empty" colSpan={13}><Bot size={26} /><strong>No in-scope records for this view</strong>Upload the master ID sheet and transaction files, or adjust the selected filters.</td></tr>}
            {rows.map((row, index) => <tr key={row.worker_id}><td>{index + 1}</td><td><strong>{row.name}</strong><br /><span style={{ color: "#708078", fontSize: 10 }}>{row.block ?? "Block not set"}</span></td><td className="id-code">{row.user_id}</td><td><button className="credential-button" onClick={() => void revealCredential(row.worker_id)}>{revealed[row.worker_id] ?? "View"}</button></td><td className="num">{row.portal_entry}</td><td className="num"><strong>{row.app_entry}</strong></td><td className="num">{row.high_entry}</td>{(["krishi_sakhi", "vendor"] as const).flatMap((groupType) => (["received", "pending"] as const).map((field) => { const key = draftKey(row.worker_id, groupType, field); const source = groupType === "krishi_sakhi" ? (field === "received" ? row.krishi_sakhi_received : row.krishi_sakhi_pending) : (field === "received" ? row.vendor_received : row.vendor_pending); return <td className="num" key={key}><input aria-label={`${row.user_id} ${groupType} ${field}`} className="payment-input" inputMode="decimal" value={paymentDrafts[key] ?? (source ?? "")} onChange={(event) => setPaymentDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void savePayments(row.worker_id)} /></td>; }))}<td><span className={`pill ${row.verification_status === "OK" ? "ok" : "pending"}`}>{row.verification_status ?? "Not verified"}</span></td><td><button className="button" disabled={!row.evidence_count}><Eye size={14} /> {row.evidence_count || "None"}</button></td></tr>)}
          </tbody><tfoot><tr><td /><td>Filtered totals</td><td colSpan={5} /><td className="num">{formatMoney.format(totals.ksReceived)}</td><td className="num">{formatMoney.format(totals.ksPending)}</td><td className="num">{formatMoney.format(totals.vendorReceived)}</td><td className="num">{formatMoney.format(totals.vendorPending)}</td><td colSpan={2} /></tr></tfoot></table></div>
        </section>
      </main>
    </div>
  </div>;
}

function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: React.ReactNode }) {
  return <article className="card metric-card"><div className="metric-head"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{formatCount.format(value)}</div><div className="metric-note">{note}</div></article>;
}
