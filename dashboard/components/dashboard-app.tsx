"use client";

import {
  Activity, AlertTriangle, Bot, ChevronDown, CircleDollarSign, Database, Download, Eye,
  FileSpreadsheet, Gauge, HardDriveUpload, ListFilter, Menu, Pause, Play, RefreshCw,
  Search, ShieldCheck, Smartphone, Square, UsersRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase-client";
import type { Profile, ReconciliationRow } from "../types";
import type { ExportColumn } from "../lib/excel-export";

type AgentSummary = {
  total: number; completed: number; running: number; passwordPending: number; networkPending: number;
  currentUserId: string | null; currentStage: string | null;
  status: "idle" | "running" | "paused" | "disconnected";
};

type DashboardView = "operations" | "portal" | "app" | "reconciliation" | "evidence" | "audit";
type EvidenceItem = { id: string; category: string; original_filename: string; mime_type: string; captured_at: string; storage_bucket: string; storage_path: string; signedUrl?: string };
type AuditItem = { id: number; action: string; entity_type: string; entity_id: string | null; actor_id: string | null; created_at: string };

const emptyAgent: AgentSummary = { total: 0, completed: 0, running: 0, passwordPending: 0, networkPending: 0, currentUserId: null, currentStage: null, status: "disconnected" };
const formatCount = new Intl.NumberFormat("en-IN");
const formatMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const exportOptions: { key: ExportColumn; label: string }[] = [
  ["serial_no", "Sl No."], ["name", "Name"], ["user_id", "User ID"], ["password", "Password"],
  ["block", "Block"], ["group_name", "Group"], ["portal_entry", "Portal Entry"],
  ["normal_total", "Normal Total"], ["app_entry", "App Entry"], ["high_entry", "High Entry"],
  ["krishi_sakhi_received", "Krishi Sakhi Received"], ["krishi_sakhi_pending", "Krishi Sakhi Pending"],
  ["vendor_received", "Vendor Received"], ["vendor_pending", "Vendor Pending"],
  ["verification_status", "Verification Status"], ["evidence_count", "Evidence Count"],
].map(([key, label]) => ({ key: key as ExportColumn, label }));

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
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [activeView, setActiveView] = useState<DashboardView>("operations");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState<ExportColumn[]>(["serial_no", "name", "user_id", "password", "portal_entry", "app_entry", "high_entry", "krishi_sakhi_received", "krishi_sakhi_pending", "vendor_received", "vendor_pending", "evidence_count"]);
  const [exportBusy, setExportBusy] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState<ReconciliationRow | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const masterInput = useRef<HTMLInputElement>(null);
  const portalInput = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    if (activeView !== "audit" || !supabase || !session) return;
    supabase.from("audit_logs").select("id,action,entity_type,entity_id,actor_id,created_at").order("created_at", { ascending: false }).limit(250)
      .then(({ data, error: auditError }) => { if (auditError) setError(auditError.message); else setAuditItems((data ?? []) as AuditItem[]); });
  }, [activeView, session, supabase]);

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
  async function downloadReport(selectedColumns = exportColumns) {
    if (!session || !selectedColumns.length) return;
    setExportBusy(true); setError(null);
    try {
      const { downloadReconciliationWorkbook } = await import("../lib/excel-export");
      const credentials: Record<string, string> = {};
      if (selectedColumns.includes("password")) {
        const results = await Promise.all(rows.map(async (row) => {
          if (revealed[row.worker_id]) return [row.worker_id, revealed[row.worker_id]] as const;
          const response = await fetch(`/api/credentials/${row.worker_id}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          const body = await response.json() as { password?: string };
          return [row.worker_id, response.ok && body.password ? body.password : ""] as const;
        }));
        Object.assign(credentials, Object.fromEntries(results));
      }
      await downloadReconciliationWorkbook(rows, appliedRange.start, appliedRange.end, selectedColumns, credentials);
      setExportOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Report export failed."); }
    finally { setExportBusy(false); }
  }
  async function openEvidence(row: ReconciliationRow) {
    if (!supabase || !session) return;
    setEvidenceOpen(row); setEvidenceItems([]); setEvidenceBusy(true); setError(null);
    const { data, error: evidenceError } = await supabase.from("evidence_files").select("id,category,original_filename,mime_type,captured_at,storage_bucket,storage_path").eq("worker_id", row.worker_id).order("captured_at", { ascending: true });
    if (evidenceError) { setError(evidenceError.message); setEvidenceBusy(false); return; }
    const signed = await Promise.all(((data ?? []) as EvidenceItem[]).map(async (item) => {
      const { data: signedData } = await supabase.storage.from(item.storage_bucket).createSignedUrl(item.storage_path, 300);
      return { ...item, signedUrl: signedData?.signedUrl };
    }));
    setEvidenceItems(signed); setEvidenceBusy(false);
  }
  async function issueAgentCommand(command: "start" | "pause" | "resume" | "retry_pending" | "stop_safely") {
    if (!supabase || !session) return;
    setError(null);
    const response = command === "start"
      ? await supabase.rpc("queue_verification_run", { p_start: appliedRange.start, p_end: appliedRange.end })
      : await supabase.rpc("enqueue_agent_command", { p_command: command, p_run_id: null });
    if (response.error) setError(response.error.message);
    else setImportStatus(command === "start" ? "Verification run queued for the connected Android agent." : `${command.replaceAll("_", " ")} command queued safely.`);
  }

  async function postImport(path: string, body: unknown) {
    if (!session) throw new Error("Officer sign-in is required.");
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string; result?: Record<string, unknown> };
    if (!response.ok) throw new Error(result.error ?? "Import failed.");
    return result.result ?? {};
  }

  async function importMaster(file: File) {
    setImportBusy(true); setImportStatus(`Reading ${file.name}…`); setError(null);
    try {
      const [{ readWorkbookRows }, { parseMasterRows }] = await Promise.all([import("../lib/excel-import"), import("../../portal-parser/src/master-parser")]);
      const workbook = await readWorkbookRows(file);
      const parsed = parseMasterRows(workbook.rows);
      if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 8).join(" "));
      const result = await postImport("/api/import/master", { sourceLabel: file.name, originalFilename: file.name, sha256: workbook.sha256, mimeType: workbook.mimeType, rowCount: workbook.rowCount, headerMap: parsed.headerMap, records: parsed.records });
      setImportStatus(`${file.name}: ${String(result.accepted_rows ?? parsed.records.length)} in-scope User IDs imported securely${parsed.warnings.length ? ` with ${parsed.warnings.length} warning(s)` : ""}.`);
      await loadReport();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Master import failed."); setImportStatus(null); }
    finally { setImportBusy(false); if (masterInput.current) masterInput.current.value = ""; }
  }

  async function importPortalFiles(files: File[]) {
    if (!supabase || !session || !files.length) return;
    setImportBusy(true); setImportStatus(`Preparing ${files.length} portal file(s)…`); setError(null);
    const { data: workerIds, error: scopeError } = await supabase.from("workers").select("user_id").eq("active", true);
    if (scopeError) { setError(scopeError.message); setImportBusy(false); return; }
    const scope = new Set((workerIds ?? []).map((row) => row.user_id));
    if (!scope.size) { setError("Upload the master ID sheet before portal files so the in-scope User IDs are known."); setImportBusy(false); return; }
    const summaries: string[] = [];
    const failures: string[] = [];
    const [{ readWorkbookRows }, { parsePortalRows }] = await Promise.all([import("../lib/excel-import"), import("../../portal-parser/src/parser")]);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setImportStatus(`Processing portal file ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const workbook = await readWorkbookRows(file);
        const parsed = parsePortalRows(workbook.rows, scope);
        if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 8).join(" "));
        if (!parsed.records.length) throw new Error("No in-scope transaction rows were found.");
        const result = await postImport("/api/import/portal", { sourceLabel: file.name, originalFilename: file.name, sha256: workbook.sha256, mimeType: workbook.mimeType, rowCount: workbook.rowCount, ignoredOutOfScope: parsed.ignoredOutOfScope, headerMap: parsed.headerMap, records: parsed.records });
        summaries.push(`${file.name}: ${String(result.accepted_rows ?? parsed.records.length)} accepted, ${String(result.ignored_out_of_scope ?? parsed.ignoredOutOfScope)} outside scope, ${String(result.overlap_warnings ?? 0)} overlap warning(s)`);
      } catch (reason) { failures.push(`${file.name}: ${reason instanceof Error ? reason.message : "failed"}`); }
    }
    if (failures.length) setError(failures.join(" "));
    setImportStatus(summaries.length ? summaries.join(" • ") : null);
    setImportBusy(false); if (portalInput.current) portalInput.current.value = ""; await loadReport();
  }

  const displayName = profile?.display_name || session?.user.email || "Development review";
  const roleLabel = profile?.role?.replaceAll("_", " ") || (developmentShell ? "Empty-state review" : "Awaiting role assignment");
  const progress = agent.total ? Math.round((agent.completed / agent.total) * 100) : 0;
  const canImport = profile?.role === "admin" || profile?.role === "technical_officer";
  const viewCopy: Record<DashboardView, { title: string; subtitle: string }> = {
    operations: { title: "Verification Operations", subtitle: "App, portal and field settlement in one verified view" },
    portal: { title: "Portal Entry", subtitle: "Transaction Report counts from traceable source files" },
    app: { title: "App Entry", subtitle: "Verified normal and high application counts" },
    reconciliation: { title: "Combined Reconciliation", subtitle: "User ID matched app, portal and field values" },
    evidence: { title: "Evidence", subtitle: "Protected proof organized by worker User ID" },
    audit: { title: "Audit Log", subtitle: "Accountable imports, verification and field changes" },
  };

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">R</div><div><h1>Project Rekhya</h1><p>FIELD OPERATIONS</p></div></div><nav className="nav" aria-label="Primary navigation"><button className={`nav-button ${activeView === "operations" ? "active" : ""}`} onClick={() => setActiveView("operations")}><Gauge size={17} /> Operations</button><button className={`nav-button ${activeView === "portal" ? "active" : ""}`} onClick={() => setActiveView("portal")}><FileSpreadsheet size={17} /> Portal Entry</button><button className={`nav-button ${activeView === "app" ? "active" : ""}`} onClick={() => setActiveView("app")}><Smartphone size={17} /> App Entry</button><button className={`nav-button ${activeView === "reconciliation" ? "active" : ""}`} onClick={() => setActiveView("reconciliation")}><ListFilter size={17} /> Reconciliation</button><button className={`nav-button ${activeView === "evidence" ? "active" : ""}`} onClick={() => setActiveView("evidence")}><HardDriveUpload size={17} /> Evidence</button><button className={`nav-button ${activeView === "audit" ? "active" : ""}`} onClick={() => setActiveView("audit")}><Activity size={17} /> Audit Log</button></nav><div className="sidebar-foot"><span className="live-dot" />Realtime synchronization</div></aside>
    <div className="workspace"><header className="topbar"><button className="mobile-menu" aria-label="Open menu"><Menu size={18} /></button><div className="topbar-copy"><h2>{viewCopy[activeView].title}</h2><p>{viewCopy[activeView].subtitle}</p></div><div className="operator"><div className="operator-copy"><strong>{displayName}</strong><span>{roleLabel}</span></div><div className="operator-badge">{displayName.slice(0, 1).toUpperCase()}</div><ChevronDown size={15} color="#68766c" /></div></header>
      <main className="content">
        {developmentShell && <div className="notice warning"><strong>Development review:</strong> the interface is using the real empty state. No sample worker, portal, payment or verification data has been inserted.</div>}
        {profile?.role === "pending" && <div className="notice warning">Your account exists but an administrator must assign an operational role before records are available.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {importStatus && <div className="notice success" role="status">{importStatus}</div>}
        <div className="status-strip" aria-label="System readiness"><strong>System readiness</strong><span className="status-item"><i className={`status-icon ${agent.status !== "disconnected" ? "ready" : "pending"}`} /> Android {agent.status === "disconnected" ? "not connected" : "connected"}</span><span className="status-item"><i className="status-icon pending" /> SIM check waits for phone</span><span className="status-item"><i className={`status-icon ${session ? "ready" : "pending"}`} /> Cloud sync {session ? "connected" : "development"}</span><span className="status-item"><i className="status-icon ready" /> Date range synchronized</span></div>
        <section className="summary-grid" aria-label="Selected-range summary"><Metric label="In-scope User IDs" value={metrics.ids} note={`${appliedRange.start} → ${appliedRange.end}`} icon={<UsersRound size={16} />} /><Metric label="Verified Accounts" value={metrics.verified} note="App identity status OK" icon={<ShieldCheck size={16} />} /><Metric label="Portal Entry" value={metrics.portal} note="Matched transaction rows" icon={<Database size={16} />} /><Metric label="App Entry" value={metrics.app} note="Normal ₹100 + High Entry" icon={<CircleDollarSign size={16} />} /></section>
        <section className="section-grid"><article className="card panel"><div className="panel-head"><div><h3>Android Verification Agent</h3><p>Controlled phone queue; technical machinery stays behind these controls.</p></div><span className={`pill ${agent.status === "running" ? "ok" : "pending"}`}>{agent.status === "disconnected" ? "Phone not connected" : agent.status}</span></div><div className="agent-state"><div className="agent-cell"><span>Total IDs</span><strong>{formatCount.format(agent.total)}</strong></div><div className="agent-cell"><span>Completed</span><strong>{formatCount.format(agent.completed)}</strong></div><div className="agent-cell"><span>Current User ID</span><strong>{agent.currentUserId ?? "—"}</strong></div><div className="agent-cell"><span>Current Stage</span><strong>{agent.currentStage ?? "Waiting for device"}</strong></div></div><div className="agent-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div><div className="agent-actions"><button className="button primary" onClick={() => void issueAgentCommand("start")} disabled={!canImport || agent.status === "disconnected"}><Play size={14} /> Start</button><button className="button" onClick={() => void issueAgentCommand("pause")} disabled={!canImport || agent.status !== "running"}><Pause size={14} /> Pause</button><button className="button" onClick={() => void issueAgentCommand("resume")} disabled={!canImport || agent.status !== "paused"}><Play size={14} /> Resume</button><button className="button" onClick={() => void issueAgentCommand("retry_pending")} disabled={!canImport || (!agent.passwordPending && !agent.networkPending)}><RefreshCw size={14} /> Retry pending</button><button className="button danger" onClick={() => void issueAgentCommand("stop_safely")} disabled={!canImport || agent.status === "disconnected" || agent.status === "idle"}><Square size={13} /> Stop safely</button></div></article>
          <article className="card panel"><div className="panel-head"><div><h3>Exception Queue</h3><p>One account never stops the full batch.</p></div><AlertTriangle size={19} color="#b77820" /></div><div className="queue-list"><div className="queue-row"><span>Password issue</span><strong className="amber">{agent.passwordPending}</strong></div><div className="queue-row"><span>Network/server pending</span><strong className="amber">{agent.networkPending}</strong></div><div className="queue-row"><span>Currently running</span><strong>{agent.running}</strong></div><div className="queue-row"><span>Manual review</span><strong className="red">0</strong></div></div></article></section>
        {activeView === "audit" && <section className="card report"><div className="report-header"><div><h3>Audit Log</h3><p>Latest 250 accountable operational events. Access follows officer role policy.</p></div></div><div className="table-wrap"><table className="data-table audit-table"><thead><tr><th>Time</th><th>Action</th><th>Record Type</th><th>Record ID</th><th>Officer ID</th></tr></thead><tbody>{!auditItems.length && <tr><td className="empty" colSpan={5}><Activity size={24} /><strong>No audit events are available to this role.</strong></td></tr>}{auditItems.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td><strong>{item.action.replaceAll("_", " ")}</strong></td><td>{item.entity_type.replaceAll("_", " ")}</td><td className="id-code">{item.entity_id ?? "—"}</td><td className="id-code">{item.actor_id ?? "System"}</td></tr>)}</tbody></table></div></section>}
        <section className={`card report ${activeView === "audit" ? "view-hidden" : ""}`}><div className="report-header"><div><h3>{activeView === "portal" ? "Portal Entry Report" : activeView === "app" ? "App Entry Report" : activeView === "evidence" ? "Evidence Index" : "Combined Reconciliation"}</h3><p>All in-scope User IDs for one inclusive Start Date–End Date range.</p></div><div className="report-actions">{canImport && <><input ref={masterInput} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMaster(file); }} /><input ref={portalInput} hidden multiple type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void importPortalFiles(Array.from(event.target.files ?? []))} /><button className="button" disabled={importBusy} onClick={() => masterInput.current?.click()}><HardDriveUpload size={15} /> Upload Master</button><button className="button" disabled={importBusy} onClick={() => portalInput.current?.click()}><FileSpreadsheet size={15} /> Upload Portal Files</button></>}<button className="button" onClick={() => setExportOpen(true)} disabled={!rows.length}><Download size={15} /> Export options</button></div></div>
          <div className="filters"><div className="field search-field"><label htmlFor="search">Search User ID / Name</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", left: 11, top: 12, color: "#718078" }} /><input id="search" className="control" style={{ paddingLeft: 33 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type User ID or name" /></div></div><div className="field"><label htmlFor="block">Block</label><select id="block" className="control" value={block} onChange={(event) => setBlock(event.target.value)}><option value="all">All Blocks</option>{blocks.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><div className="field"><label htmlFor="group">Worker Type</label><select id="group" className="control" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">All Groups</option><option value="Krishi Sakhi">Krishi Sakhi</option><option value="Vendor">Vendor</option></select></div><div className="field"><label htmlFor="start">Start Date</label><input id="start" className="control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div className="field"><label htmlFor="end">End Date</label><input id="end" className="control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div><button className="button primary" style={{ alignSelf: "end" }} onClick={applyFilters}>Apply</button><button className="button" style={{ alignSelf: "end" }} onClick={() => void loadReport()} disabled={reportLoading}><RefreshCw size={14} /> {reportLoading ? "Loading" : "Refresh"}</button></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th rowSpan={2}>Sl No.</th><th rowSpan={2}>Name</th><th rowSpan={2}>User ID</th><th rowSpan={2}>Password</th><th rowSpan={2} className="num">Portal Entry</th><th rowSpan={2} className="num">App Entry</th><th rowSpan={2} className="num">High Entry</th><th colSpan={2}>Krishi Sakhi</th><th colSpan={2}>Vendor</th><th rowSpan={2}>Status</th><th rowSpan={2}>Evidence</th></tr><tr><th className="num">Amount Received</th><th className="num">Pending Amount</th><th className="num">Amount Received</th><th className="num">Pending Amount</th></tr></thead><tbody>
            {!rows.length && <tr><td className="empty" colSpan={13}><Bot size={26} /><strong>No in-scope records for this view</strong>Upload the master ID sheet and transaction files, or adjust the selected filters.</td></tr>}
            {rows.map((row, index) => <tr key={row.worker_id}><td>{index + 1}</td><td><strong>{row.name}</strong><br /><span style={{ color: "#708078", fontSize: 10 }}>{row.block ?? "Block not set"}</span></td><td className="id-code">{row.user_id}</td><td><button className="credential-button" onClick={() => void revealCredential(row.worker_id)}>{revealed[row.worker_id] ?? "View"}</button></td><td className="num">{row.portal_entry}</td><td className="num"><strong>{row.app_entry}</strong></td><td className="num">{row.high_entry}</td>{(["krishi_sakhi", "vendor"] as const).flatMap((groupType) => (["received", "pending"] as const).map((field) => { const key = draftKey(row.worker_id, groupType, field); const source = groupType === "krishi_sakhi" ? (field === "received" ? row.krishi_sakhi_received : row.krishi_sakhi_pending) : (field === "received" ? row.vendor_received : row.vendor_pending); return <td className="num" key={key}><input aria-label={`${row.user_id} ${groupType} ${field}`} className="payment-input" inputMode="decimal" value={paymentDrafts[key] ?? (source ?? "")} onChange={(event) => setPaymentDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void savePayments(row.worker_id)} /></td>; }))}<td><span className={`pill ${row.verification_status === "OK" ? "ok" : "pending"}`}>{row.verification_status ?? "Not verified"}</span></td><td><button className="button" disabled={!row.evidence_count} onClick={() => void openEvidence(row)}><Eye size={14} /> {row.evidence_count || "None"}</button></td></tr>)}
          </tbody><tfoot><tr><td /><td>Filtered totals</td><td colSpan={5} /><td className="num">{formatMoney.format(totals.ksReceived)}</td><td className="num">{formatMoney.format(totals.ksPending)}</td><td className="num">{formatMoney.format(totals.vendorReceived)}</td><td className="num">{formatMoney.format(totals.vendorPending)}</td><td colSpan={2} /></tr></tfoot></table></div>
        </section>
      </main>
    </div>
    {exportOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setExportOpen(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="export-title">Excel export</h3><p>The export uses the current filters and inclusive date range.</p></div><button className="icon-button" aria-label="Close export options" onClick={() => setExportOpen(false)}><X size={18} /></button></div><div className="export-presets"><button className="button" onClick={() => setExportColumns(exportOptions.map((option) => option.key))}>Full &amp; Final</button><button className="button" onClick={() => setExportColumns(["serial_no", "name", "user_id", "password", "portal_entry", "app_entry", "high_entry"])}>Core combined</button><button className="button" onClick={() => setExportColumns([])}>Clear selection</button></div><div className="export-grid">{exportOptions.map((option) => <label className="check-row" key={option.key}><input type="checkbox" checked={exportColumns.includes(option.key)} onChange={(event) => setExportColumns((current) => event.target.checked ? [...current, option.key] : current.filter((column) => column !== option.key))} /><span>{option.label}</span></label>)}</div><div className="modal-actions"><span>{exportColumns.length} column(s) selected</span><button className="button primary" disabled={!exportColumns.length || exportBusy} onClick={() => void downloadReport()}><Download size={15} /> {exportBusy ? "Preparing securely…" : "Download Excel"}</button></div></section></div>}
    {evidenceOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEvidenceOpen(null)}><section className="modal-card evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="evidence-title">Evidence — {evidenceOpen.user_id}</h3><p>{evidenceOpen.name} · links expire automatically after five minutes.</p></div><button className="icon-button" aria-label="Close evidence" onClick={() => setEvidenceOpen(null)}><X size={18} /></button></div>{evidenceBusy ? <div className="empty"><RefreshCw className="spin" size={22} /><strong>Opening protected evidence…</strong></div> : !evidenceItems.length ? <div className="empty"><HardDriveUpload size={24} /><strong>No evidence files are available for this User ID.</strong></div> : <div className="evidence-grid">{evidenceItems.map((item) => <article className="evidence-card" key={item.id}>{item.mime_type.startsWith("image/") && item.signedUrl ? <Image unoptimized width={180} height={120} src={item.signedUrl} alt={`${item.category} evidence for ${evidenceOpen.user_id}`} /> : <div className="evidence-file"><FileSpreadsheet size={28} /></div>}<div><span className="pill ok">{item.category.replaceAll("_", " ")}</span><h4>{item.original_filename}</h4><p>{new Date(item.captured_at).toLocaleString()}</p>{item.signedUrl && <a className="button" href={item.signedUrl} target="_blank" rel="noreferrer"><Eye size={14} /> View / retrieve</a>}</div></article>)}</div>}</section></div>}
  </div>;
}

function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: React.ReactNode }) {
  return <article className="card metric-card"><div className="metric-head"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{formatCount.format(value)}</div><div className="metric-note">{note}</div></article>;
}
