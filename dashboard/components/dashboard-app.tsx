"use client";

import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronDown, CircleDollarSign, Database, Download, Eye,
  FileSpreadsheet, FolderOpen, Gauge, HardDriveUpload, KeyRound, ListFilter, Menu, Pause, Play, RefreshCw,
  RotateCcw, Search, ShieldCheck, Smartphone, Square, Trash2, UsersRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../lib/supabase-client";
import type { ImportHistoryItem, PendingCredential, Profile, ReconciliationRow, SourceFileTrashItem, TrashWorker } from "../types";
import type { ExportColumn } from "../lib/excel-export";

type AgentSummary = {
  total: number; completed: number; running: number; passwordPending: number; networkPending: number;
  currentUserId: string | null; currentStage: string | null;
  deviceConnected: boolean; adbAuthorized: boolean; simDetected: boolean; officialAppReady: boolean; cloudSyncConnected: boolean;
  status: "idle" | "running" | "paused" | "disconnected";
  heartbeatAt: string | null;
  heartbeatFresh: boolean;
};

type DashboardView = "operations" | "portal" | "app" | "reconciliation" | "evidence" | "passport" | "imports" | "credentials" | "access" | "audit" | "trash";
type EvidenceItem = {
  id: string; category: string; original_filename: string; mime_type: string; captured_at: string;
  storage_bucket: string; storage_path: string; storage_provider: string; run_scope: "current" | "previous" | "testing";
  run_id: string | null; previewUrl?: string;
};
type OfficerAccessItem = { user_id: string; email: string | null; display_name: string | null; role: string; active: boolean; created_at: string };
type PassportWorkflowItem = {
  worker_id: string; user_id: string; name: string; block: string | null; group_name: string | null;
  passport_reference: string | null; passport_status: string | null; note: string | null;
  verification_required: boolean; updated_at: string | null; request_id: string | null; request_status: string | null;
};
type AuditItem = { id: number; action: string; entity_type: string; entity_id: string | null; actor_id: string | null; created_at: string };
type PreparedImport = {
  key: string;
  sourceType: "master" | "portal";
  fileName: string;
  fileSize: number;
  worksheetName: string;
  headerRowNumber: number;
  rowCount: number;
  acceptedRows: number;
  ignoredOutOfScope: number;
  warningCount: number;
  detectedStartDate: string | null;
  detectedEndDate: string | null;
  headerMap: Record<string, string>;
  sampleUserIds: string[];
  payload: Record<string, unknown>;
};

const emptyAgent: AgentSummary = {
  total: 0, completed: 0, running: 0, passwordPending: 0, networkPending: 0,
  currentUserId: null, currentStage: null, deviceConnected: false, adbAuthorized: false,
  simDetected: false, officialAppReady: false, cloudSyncConnected: false, status: "disconnected",
  heartbeatAt: null, heartbeatFresh: false,
};
const formatCount = new Intl.NumberFormat("en-IN");
const formatMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const exportOptions: { key: ExportColumn; label: string }[] = [
  ["serial_no", "Sl No."], ["name", "Name"], ["user_id", "User ID"], ["password", "Password"],
  ["block", "Block"], ["group_name", "Group"], ["portal_entry", "Portal Entry"],
  ["normal_total", "Normal Total"], ["app_entry", "App Entry"], ["high_entry", "High Entry"],
  ["krishi_sakhi_received", "Krishi Sakhi Received"], ["krishi_sakhi_pending", "Krishi Sakhi Pending"],
  ["vendor_received", "Vendor Received"], ["vendor_pending", "Vendor Pending"],
  ["sesta_received", "SeSTA Received"], ["sesta_pending", "SeSTA Pending"],
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
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);

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

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true); setAuthError(null); setAuthNotice(null);
    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayNameInput.trim() || email.trim().split("@")[0] } },
      });
      if (error) setAuthError(error.message);
      else setAuthNotice("Account request created. Confirm your email if requested, then an administrator must approve your officer role before operational access is enabled.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setAuthError(error.message);
    }
    setLoading(false);
  }

  if (!authReady) return <div className="auth-page">Preparing secure workspaceâ€¦</div>;
  if (configured && !session) {
    return <main className="auth-page"><section className="card auth-card"><div className="brand-mark">R</div><h1>Project Rekhya</h1><p>{authMode === "signin" ? "Authorized officer access for insurance verification, reconciliation and field settlement." : "Create an officer access request. Operational access stays locked until an administrator assigns your role."}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === "signup" && <div className="field"><label htmlFor="display-name">Officer name</label><input id="display-name" className="control" autoComplete="name" value={displayNameInput} onChange={(event) => setDisplayNameInput(event.target.value)} /></div>}<div className="field"><label htmlFor="email">Officer email</label><input id="email" className="control" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div><div className="field"><label htmlFor="password">Password</label><input id="password" className="control" type="password" minLength={8} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>{authError && <p className="auth-error" role="alert">{authError}</p>}{authNotice && <div className="notice success" role="status">{authNotice}</div>}<button className="button primary" type="submit" disabled={loading}>{loading ? "Please waitâ€¦" : authMode === "signin" ? "Sign in securely" : "Request officer access"}</button><button className="button" type="button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(null); setAuthNotice(null); }}>{authMode === "signin" ? "Create access request" : "Back to sign in"}</button></form></section></main>;
  }
  if (!configured && !allowDevelopmentShell) return <main className="auth-page"><section className="card auth-card"><h1>Project Rekhya</h1><p className="auth-error">Secure data connection is not configured.</p></section></main>;
  if (configured && session && !profile) return <main className="auth-page"><section className="card auth-card"><h1>Project Rekhya</h1><p>Preparing your officer profileâ€¦</p></section></main>;
  if (configured && session && profile?.role === "pending") return <main className="auth-page"><section className="card auth-card"><div className="brand-mark">R</div><h1>Access request pending</h1><p>Your account exists, but an administrator has not assigned an operational role yet.</p><button className="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></section></main>;
  if (configured && session && profile && !profile.active) return <main className="auth-page"><section className="card auth-card"><h1>Officer access inactive</h1><p>An administrator has disabled this account.</p><button className="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></section></main>;
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
  const [exportColumns, setExportColumns] = useState<ExportColumn[]>(["serial_no", "name", "user_id", "password", "portal_entry", "app_entry", "high_entry", "krishi_sakhi_received", "krishi_sakhi_pending", "vendor_received", "vendor_pending", "sesta_received", "sesta_pending", "evidence_count"]);
  const [exportBusy, setExportBusy] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState<ReconciliationRow | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [importItems, setImportItems] = useState<ImportHistoryItem[]>([]);
  const [importHistoryBusy, setImportHistoryBusy] = useState(false);
  const [preparedImports, setPreparedImports] = useState<PreparedImport[]>([]);
  const [pendingCredentials, setPendingCredentials] = useState<PendingCredential[]>([]);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialSaveId, setCredentialSaveId] = useState<string | null>(null);
  const [selectedImportFileIds, setSelectedImportFileIds] = useState<string[]>([]);
  const [sourceTrashItems, setSourceTrashItems] = useState<SourceFileTrashItem[]>([]);
  const [selectedSourceTrashIds, setSelectedSourceTrashIds] = useState<string[]>([]);
  const [sourceTrashBusy, setSourceTrashBusy] = useState(false);
  const [sourceDeleteConfirmOpen, setSourceDeleteConfirmOpen] = useState(false);
  const [sourceDeleteConfirmText, setSourceDeleteConfirmText] = useState("");
  const [sourceDeleteReason, setSourceDeleteReason] = useState("Incorrect or test upload");
  const [sourcePurgeConfirmOpen, setSourcePurgeConfirmOpen] = useState(false);
  const [sourcePurgeConfirmText, setSourcePurgeConfirmText] = useState("");
  const [trashItems, setTrashItems] = useState<TrashWorker[]>([]);
  const [trashBusy, setTrashBusy] = useState(false);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteReason, setDeleteReason] = useState("Testing data cleanup");
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [liveStatusEnabled, setLiveStatusEnabled] = useState(false);
  const [singleUserId, setSingleUserId] = useState("");
  const [evidenceScope, setEvidenceScope] = useState<"current" | "previous" | "all">("current");
  const [evidencePreviewBusy, setEvidencePreviewBusy] = useState<string | null>(null);
  const [evidenceFullscreen, setEvidenceFullscreen] = useState<EvidenceItem | null>(null);
  const [accessItems, setAccessItems] = useState<OfficerAccessItem[]>([]);
  const [accessRoleDrafts, setAccessRoleDrafts] = useState<Record<string, string>>({});
  const [accessBusy, setAccessBusy] = useState(false);
  const [passportItems, setPassportItems] = useState<PassportWorkflowItem[]>([]);
  const [passportReferenceDrafts, setPassportReferenceDrafts] = useState<Record<string, string>>({});
  const [passportNoteDrafts, setPassportNoteDrafts] = useState<Record<string, string>>({});
  const [passportBusy, setPassportBusy] = useState(false);
  const masterInput = useRef<HTMLInputElement>(null);
  const portalInput = useRef<HTMLInputElement>(null);
  const portalFolderInput = useRef<HTMLInputElement>(null);
  const canUseTechnical = profile?.role === "admin" || profile?.role === "technical_officer";
  const canManageAccess = profile?.role === "admin";
  const canUpdatePassport = profile?.role === "admin" || profile?.role === "technical_officer" || profile?.role === "field_officer";
  const canVerifyPassport = profile?.role === "admin" || profile?.role === "technical_officer";
  const agentHeartbeatFresh = agent.heartbeatFresh;
  const phoneReady = liveStatusEnabled && agentHeartbeatFresh && agent.deviceConnected && agent.adbAuthorized && agent.simDetected && agent.officialAppReady && agent.cloudSyncConnected;

  const loadReport = useCallback(async () => {
    if (!supabase || !session) return;
    setReportLoading(true); setError(null);
    const { data, error: reportError } = await supabase.rpc("get_reconciliation_report", { p_start: appliedRange.start, p_end: appliedRange.end, p_block: block === "all" ? null : block, p_group: group === "all" ? null : group, p_search: search.trim() || null });
    if (reportError) setError(reportError.message); else {
      const nextRows = (data ?? []) as ReconciliationRow[];
      setRows(nextRows);
      setSelectedWorkerIds((current) => current.filter((id) => nextRows.some((row) => row.worker_id === id)));
    }
    setReportLoading(false);
  }, [appliedRange, block, group, search, session, supabase]);

  const loadAgentStatus = useCallback(async () => {
    if (!supabase || !session || !canUseTechnical || !liveStatusEnabled) return;
    const { data: agentData, error: agentError } = await supabase.from("agent_status").select("*").eq("singleton", true).maybeSingle();
    if (agentError) { setError(agentError.message); return; }
    if (agentData) setAgent({
      total: agentData.total_ids ?? 0, completed: agentData.completed_ids ?? 0,
      running: agentData.running_ids ?? 0, passwordPending: agentData.password_pending ?? 0,
      networkPending: agentData.network_pending ?? 0, currentUserId: agentData.current_user_id,
      currentStage: agentData.current_stage, deviceConnected: Boolean(agentData.device_connected),
      adbAuthorized: Boolean(agentData.adb_authorized), simDetected: Boolean(agentData.sim_detected),
      officialAppReady: Boolean(agentData.official_app_ready), cloudSyncConnected: Boolean(agentData.cloud_sync_connected),
      status: agentData.status,
      heartbeatAt: agentData.heartbeat_at ?? null,
      heartbeatFresh: Boolean(
        agentData.heartbeat_at &&
        Date.now() - new Date(agentData.heartbeat_at).getTime() < 15000
      ),
    });
  }, [canUseTechnical, liveStatusEnabled, session, supabase]);

  const loadAccessRequests = useCallback(async () => {
    if (!supabase || !session || !canManageAccess) return;
    setAccessBusy(true);
    const { data, error: accessError } = await supabase.rpc("list_officer_access_requests");
    if (accessError) setError(accessError.message); else setAccessItems((data ?? []) as OfficerAccessItem[]);
    setAccessBusy(false);
  }, [canManageAccess, session, supabase]);

  const loadPassportWorkflow = useCallback(async () => {
    if (!supabase || !session) return;
    setPassportBusy(true);
    const { data, error: passportError } = await supabase.rpc("list_passport_workflow");
    if (passportError) setError(passportError.message); else setPassportItems((data ?? []) as PassportWorkflowItem[]);
    setPassportBusy(false);
  }, [session, supabase]);

  const loadTrash = useCallback(async () => {
    if (!supabase || !session) return;
    setTrashBusy(true); setError(null);
    const { data, error: trashError } = await supabase.rpc("get_worker_trash");
    if (trashError) setError(trashError.message); else {
      const nextItems = (data ?? []) as TrashWorker[];
      setTrashItems(nextItems);
      setSelectedTrashIds((current) => current.filter((id) => nextItems.some((row) => row.worker_id === id)));
    }
    setTrashBusy(false);
  }, [session, supabase]);

  const loadImportHistory = useCallback(async () => {
    if (!supabase || !session) return;
    setImportHistoryBusy(true);
    const { data, error: historyError } = await supabase.rpc("get_import_history", { p_limit: 250 });
    if (historyError) setError(historyError.message);
    else {
      const nextItems = (data ?? []) as ImportHistoryItem[];
      setImportItems(nextItems);
      setSelectedImportFileIds((current) => current.filter((id) => nextItems.some((item) => item.file_id === id && !item.is_trashed)));
    }
    setImportHistoryBusy(false);
  }, [session, supabase]);

  const loadSourceTrash = useCallback(async () => {
    if (!supabase || !session) return;
    setSourceTrashBusy(true);
    const { data, error: sourceTrashError } = await supabase.rpc("get_source_file_trash");
    if (sourceTrashError) setError(sourceTrashError.message);
    else {
      const nextItems = (data ?? []) as SourceFileTrashItem[];
      setSourceTrashItems(nextItems);
      setSelectedSourceTrashIds((current) => current.filter((id) => nextItems.some((item) => item.file_id === id)));
    }
    setSourceTrashBusy(false);
  }, [session, supabase]);

  const loadPendingCredentials = useCallback(async () => {
    if (!session) return;
    setCredentialBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/credentials/pending", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json() as { items?: PendingCredential[]; error?: string }
        : { error: `Pending Passwords API returned ${response.status} ${response.statusText}.` };

      if (!response.ok) {
        setPendingCredentials([]);
        setError(body.error ?? "Pending passwords could not be loaded.");
      } else {
        setPendingCredentials(Array.isArray(body.items) ? body.items : []);
      }
    } catch (reason) {
      setPendingCredentials([]);
      setError(reason instanceof Error ? `Pending passwords could not be loaded: ${reason.message}` : "Pending passwords could not be loaded.");
    } finally {
      setCredentialBusy(false);
    }
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);
  useEffect(() => {
    if (!supabase || !session) return;
    const channel = supabase.channel("project-rekhya-operations")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_records" }, () => void loadReport())
      .on("postgres_changes", { event: "*", schema: "public", table: "verification_jobs" }, () => void loadReport())
      .on("postgres_changes", { event: "*", schema: "public", table: "app_summaries" }, () => void loadReport())
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, () => { void loadReport(); void loadTrash(); void loadPassportWorkflow(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "source_files" }, () => { void loadReport(); void loadImportHistory(); void loadSourceTrash(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "passport_updates" }, () => void loadPassportWorkflow())
      .on("postgres_changes", { event: "*", schema: "public", table: "verification_requests" }, () => void loadPassportWorkflow())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadImportHistory, loadPassportWorkflow, loadReport, loadSourceTrash, loadTrash, session, supabase]);

  useEffect(() => {
    if (!supabase || !session || !canUseTechnical) return;
    supabase.from("technical_live_status_preferences").select("enabled").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => setLiveStatusEnabled(Boolean(data?.enabled)));
  }, [canUseTechnical, session, supabase]);

  useEffect(() => {
    if (!supabase || !session || !canUseTechnical || !liveStatusEnabled) return;

    const initialLoad = window.setTimeout(() => {
      void loadAgentStatus();
    }, 0);

    const channel = supabase.channel(`project-rekhya-agent-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_status" }, () => void loadAgentStatus())
      .subscribe();
    const poll = window.setInterval(() => { void loadAgentStatus(); }, 5000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [canUseTechnical, liveStatusEnabled, loadAgentStatus, session, supabase]);
  useEffect(() => {
    if (activeView !== "audit" || !supabase || !session) return;
    supabase.from("audit_logs").select("id,action,entity_type,entity_id,actor_id,created_at").order("created_at", { ascending: false }).limit(250)
      .then(({ data, error: auditError }) => { if (auditError) setError(auditError.message); else setAuditItems((data ?? []) as AuditItem[]); });
  }, [activeView, session, supabase]);
  useEffect(() => {
    if (activeView !== "trash") return;
    const timer = window.setTimeout(() => { void loadTrash(); void loadSourceTrash(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadSourceTrash, loadTrash]);
  useEffect(() => {
    if (activeView !== "imports") return;
    const timer = window.setTimeout(() => void loadImportHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadImportHistory]);
  useEffect(() => {
    if (activeView !== "credentials") return;
    const timer = window.setTimeout(() => void loadPendingCredentials(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadPendingCredentials]);
  useEffect(() => {
    if (activeView !== "access") return;
    const timer = window.setTimeout(() => void loadAccessRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadAccessRequests]);
  useEffect(() => {
    if (activeView !== "passport") return;
    const timer = window.setTimeout(() => void loadPassportWorkflow(), 0);
    return () => window.clearTimeout(timer);
  }, [activeView, loadPassportWorkflow]);
  const metrics = useMemo(() => ({ ids: rows.length, verified: rows.filter((row) => (row.verification_status ?? "").toLowerCase() === "ok").length, portal: rows.reduce((sum, row) => sum + Number(row.portal_entry || 0), 0), app: rows.reduce((sum, row) => sum + Number(row.app_entry || 0), 0) }), [rows]);
  function normalizedStatus(row: ReconciliationRow) {
    return (row.verification_status ?? "").toLowerCase();
  }

  function statusLabel(row: ReconciliationRow) {
    const status = normalizedStatus(row);

    if (status === "ok") return "Verified";
    if (status === "running") return "Verification running";
    if (status === "queued") return "Waiting for verification";
    if (status === "pending") return "Pending";
    if (status === "manual_review") return "Manual review required";
    if (status === "count_mismatch") return "Count mismatch";
    if (!status) return "Not verified";

    return status.replaceAll("_", " ");
  }

  function issueLabel(row: ReconciliationRow) {
    const issue = (row.issue_type ?? "").toLowerCase();

    if (issue === "wrong_id") {
      return "Wrong User ID detected during PMFBY login.";
    }

    if (issue === "password") {
      return "Password / credential verification required.";
    }

    if (issue === "network_server") {
      return "PMFBY network or server problem prevented verification.";
    }

    if (issue === "uncertain_read") {
      return "App screen could not be read reliably. Review the captured evidence.";
    }

    if (issue === "count_mismatch") {
      return "Dashboard, Unpaid header, or captured record count did not match.";
    }

    if (normalizedStatus(row) === "manual_review") {
      return "Manual verification is required. Open the review details.";
    }

    return issue ? issue.replaceAll("_", " ") : null;
  }

  const selectedVisibleWorkerIds = useMemo(() => selectedWorkerIds.filter((id) => rows.some((row) => row.worker_id === id)), [rows, selectedWorkerIds]);
  const selectedVisibleTrashIds = useMemo(() => selectedTrashIds.filter((id) => trashItems.some((row) => row.worker_id === id)), [selectedTrashIds, trashItems]);
  const blocks = useMemo(() => Array.from(new Set(rows.map((row) => row.block).filter(Boolean))).sort() as string[], [rows]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ ksReceived: sum.ksReceived + Number(row.krishi_sakhi_received || 0), ksPending: sum.ksPending + Number(row.krishi_sakhi_pending || 0), vendorReceived: sum.vendorReceived + Number(row.vendor_received || 0), vendorPending: sum.vendorPending + Number(row.vendor_pending || 0), sestaReceived: sum.sestaReceived + Number(row.sesta_received || 0), sestaPending: sum.sestaPending + Number(row.sesta_pending || 0) }), { ksReceived: 0, ksPending: 0, vendorReceived: 0, vendorPending: 0, sestaReceived: 0, sestaPending: 0 }), [rows]);

  async function revealCredential(workerId: string) {
    if (!session || revealed[workerId]) return;
    const response = await fetch(`/api/credentials/${workerId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const body = await response.json() as { password?: string; status?: string; error?: string };
    if (body.status === "missing") setError("Password is pending. Add its confirmed value from Pending Passwords.");
    else if (!response.ok || !body.password) setError(body.error ?? "Credential could not be opened.");
    else setRevealed((current) => ({ ...current, [workerId]: body.password! }));
  }

  async function saveConfirmedCredential(workerId: string) {
    if (!session) return;
    const password = credentialDrafts[workerId] ?? "";
    if (!password.trim()) { setError("Enter the confirmed password before saving."); return; }
    setCredentialSaveId(workerId); setError(null);
    const response = await fetch(`/api/credentials/${workerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ password }),
    });
    const body = await response.json() as { updated?: boolean; error?: string };
    if (!response.ok || !body.updated) setError(body.error ?? "Confirmed password could not be saved.");
    else {
      setCredentialDrafts((current) => { const next = { ...current }; delete next[workerId]; return next; });
      setImportStatus("Confirmed password saved to the encrypted Master credential record. Use Retry pending when the authorized Android device is connected.");
      await Promise.all([loadPendingCredentials(), loadReport()]);
    }
    setCredentialSaveId(null);
  }
  function draftKey(workerId: string, groupType: string, field: string) { return `${workerId}:${groupType}:${field}`; }
  function paymentSource(row: ReconciliationRow, groupType: "krishi_sakhi" | "vendor" | "sesta", field: "received" | "pending") {
    if (groupType === "krishi_sakhi") return field === "received" ? row.krishi_sakhi_received : row.krishi_sakhi_pending;
    if (groupType === "vendor") return field === "received" ? row.vendor_received : row.vendor_pending;
    return field === "received" ? row.sesta_received : row.sesta_pending;
  }
  async function savePayments(workerId: string) {
    if (!supabase || !session) return;
    for (const groupType of ["krishi_sakhi", "vendor", "sesta"] as const) {
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
  async function loadEvidence(row: ReconciliationRow, scope: "current" | "previous" | "all" = evidenceScope) {
    if (!supabase || !session) return;
    setEvidenceItems((current) => {
      for (const item of current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
    setEvidenceBusy(true); setError(null);
    let query = supabase.from("evidence_files")
      .select("id,category,original_filename,mime_type,captured_at,storage_bucket,storage_path,storage_provider,run_scope,run_id")
      .eq("worker_id", row.worker_id)
      .order("captured_at", { ascending: true });
    if (scope !== "all") query = query.eq("run_scope", scope);
    const { data, error: evidenceError } = await query;
    if (evidenceError) setError(evidenceError.message); else setEvidenceItems((data ?? []) as EvidenceItem[]);
    setEvidenceBusy(false);
  }

  async function openEvidence(row: ReconciliationRow) {
    setEvidenceOpen(row);
    setEvidenceScope("current");
    await loadEvidence(row, "current");
  }

  function closeEvidence() {
    setEvidenceFullscreen(null);
    for (const item of evidenceItems) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setEvidenceItems([]);
    setEvidenceOpen(null);
  }

  async function loadEvidencePreview(item: EvidenceItem) {
    if (!session) return;

    if (item.previewUrl) {
      setEvidenceFullscreen(item);
      return;
    }

    setEvidencePreviewBusy(item.id);
    setError(null);

    try {
      const response = await fetch(`/api/evidence/${item.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Evidence could not be opened.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const opened = { ...item, previewUrl: url };

      setEvidenceItems((current) =>
        current.map((entry) => entry.id === item.id ? opened : entry)
      );
      setEvidenceFullscreen(opened);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Evidence could not be opened.");
    } finally {
      setEvidencePreviewBusy(null);
    }
  }

  async function toggleLiveStatus() {
    if (!supabase || !session || !canUseTechnical) return;
    const enabled = !liveStatusEnabled;
    const { error: preferenceError } = await supabase.from("technical_live_status_preferences")
      .upsert({ user_id: session.user.id, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (preferenceError) setError(preferenceError.message);
    else {
      setLiveStatusEnabled(enabled);
      if (!enabled) setAgent(emptyAgent);
    }
  }

  async function prepareAndroid() {
    if (!supabase || !session || !canUseTechnical) return;
    setError(null);
    if (!liveStatusEnabled) {
      setError("Turn Technical Live Status ON before preparing Android.");
      return;
    }

    window.location.href = "rekhya://prepare";

    setImportStatus(
      "Starting the local Android controller and checking device readiness. If the phone asks for USB debugging authorization, tap Allow on the phone."
    );

    const { error: prepareError } = await supabase.rpc("enqueue_prepare_agent");
    if (prepareError) {
      setError(prepareError.message);
      return;
    }

    window.setTimeout(() => void loadAgentStatus(), 1200);
    window.setTimeout(() => void loadAgentStatus(), 3500);
    window.setTimeout(() => void loadAgentStatus(), 7000);
    window.setTimeout(() => void loadAgentStatus(), 12000);
  }
  async function issueAgentCommand(command: "start" | "pause" | "resume" | "retry_pending" | "stop_safely" | "restart" | "single") {
    if (!supabase || !session || !canUseTechnical) return;
    setError(null);
    if (!liveStatusEnabled) { setError("Turn Technical Live Status ON before issuing Android-agent controls."); return; }
    if (command === "start" && !window.confirm("Start a new full verification run for every active in-scope User ID?")) return;
    if (command === "restart" && !window.confirm("Restart from the beginning creates a new full run and ignores previous checkpoints. Continue?")) return;
    let response: { error: { message: string } | null };
    if (command === "start") response = await supabase.rpc("queue_verification_run", { p_start: appliedRange.start, p_end: appliedRange.end });
    else if (command === "restart") response = await supabase.rpc("restart_verification_from_beginning", { p_start: appliedRange.start, p_end: appliedRange.end });
    else if (command === "single") {
      const userId = singleUserId.replace(/\D/g, "");
      if (!/^\d{10}$/.test(userId)) { setError("Enter the exact 10-digit User ID for the single-ID run."); return; }
      response = await supabase.rpc("queue_single_verification_run", { p_user_id: userId, p_start: appliedRange.start, p_end: appliedRange.end });
    } else if (command === "resume") response = await supabase.rpc("enqueue_resume_latest");
    else if (command === "retry_pending") response = await supabase.rpc("enqueue_retry_pending_latest");
    else response = await supabase.rpc("enqueue_control_latest", { p_command: command });
    if (response.error) setError(response.error.message);
    else {
      setImportStatus(command === "single" ? `Single User ID ${singleUserId.replace(/\D/g, "")} queued.` : `${command.replaceAll("_", " ")} command queued safely.`);
      if (command === "single") setSingleUserId("");
      await loadAgentStatus();
    }
  }

  async function approveOfficer(item: OfficerAccessItem) {
    if (!supabase || !canManageAccess) return;
    const role = accessRoleDrafts[item.user_id] ?? (item.role === "pending" ? "field_officer" : item.role);
    setAccessBusy(true); setError(null);
    const { error: approveError } = await supabase.rpc("approve_officer_access", { p_user_id: item.user_id, p_role: role, p_display_name: item.display_name });
    if (approveError) setError(approveError.message); else await loadAccessRequests();
    setAccessBusy(false);
  }

  async function setOfficerActive(item: OfficerAccessItem, active: boolean) {
    if (!supabase || !canManageAccess) return;
    setAccessBusy(true); setError(null);
    const { error: stateError } = await supabase.rpc("set_officer_access_state", { p_user_id: item.user_id, p_active: active, p_role: item.role });
    if (stateError) setError(stateError.message); else await loadAccessRequests();
    setAccessBusy(false);
  }

  async function savePassport(item: PassportWorkflowItem) {
    if (!supabase || !canUpdatePassport) return;
    const reference = (passportReferenceDrafts[item.worker_id] ?? item.passport_reference ?? "").trim();
    const note = (passportNoteDrafts[item.worker_id] ?? item.note ?? "").trim();
    if (!reference) { setError("Passport reference is required before requesting verification."); return; }
    setPassportBusy(true); setError(null);
    const { error: passportError } = await supabase.rpc("update_passport_for_verification", { p_worker_id: item.worker_id, p_passport_reference: reference, p_note: note || null });
    if (passportError) setError(passportError.message);
    else {
      setImportStatus(`Passport updated for ${item.user_id}. Technical verification is now required.`);
      await loadPassportWorkflow();
    }
    setPassportBusy(false);
  }

  async function verifyPassport(item: PassportWorkflowItem) {
    if (!supabase || !canVerifyPassport) return;
    setPassportBusy(true); setError(null);
    const { error: verifyError } = await supabase.rpc("mark_passport_verified", { p_worker_id: item.worker_id });
    if (verifyError) setError(verifyError.message); else await loadPassportWorkflow();
    setPassportBusy(false);
  }

  function toggleSelection(id: string, trash = false) {
    const setter = trash ? setSelectedTrashIds : setSelectedWorkerIds;
    setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function moveSelectedToTrash() {
    if (!supabase || !selectedVisibleWorkerIds.length || deleteConfirmText !== "DELETE") return;
    setTrashBusy(true); setError(null);
    const { data, error: deleteError } = await supabase.rpc("trash_worker_datasets", { p_worker_ids: selectedVisibleWorkerIds, p_reason: deleteReason.trim() || null });
    if (deleteError) setError(deleteError.message);
    else {
      setImportStatus(`${Number(data ?? 0)} selected User ID dataset(s) moved to recoverable Trash. Later-dated and linked records are now excluded from live reports.`);
      setSelectedWorkerIds([]); setDeleteConfirmOpen(false); setDeleteConfirmText(""); setActiveView("trash");
      await Promise.all([loadReport(), loadTrash()]);
    }
    setTrashBusy(false);
  }

  async function restoreSelectedTrash() {
    if (!supabase || !selectedVisibleTrashIds.length) return;
    setTrashBusy(true); setError(null);
    const { data, error: restoreError } = await supabase.rpc("restore_worker_datasets", { p_worker_ids: selectedVisibleTrashIds });
    if (restoreError) setError(restoreError.message);
    else {
      setImportStatus(`${Number(data ?? 0)} User ID dataset(s) restored with linked portal, app, payment, evidence and verification records.`);
      setSelectedTrashIds([]); await Promise.all([loadReport(), loadTrash()]);
    }
    setTrashBusy(false);
  }

  async function permanentlyDeleteSelectedTrash() {
    if (!supabase || !selectedVisibleTrashIds.length || purgeConfirmText !== "PERMANENT DELETE") return;
    setTrashBusy(true); setError(null);
    const { data, error: purgeError } = await supabase.rpc("purge_worker_datasets", { p_worker_ids: selectedVisibleTrashIds });
    if (purgeError) { setError(purgeError.message); setTrashBusy(false); return; }
    const result = (data ?? {}) as { purged_count?: number; storage_objects?: Array<{ provider?: string; bucket: string; path: string }> };
    let cleanupError: string | null = null;
    if (result.storage_objects?.length && session) {
      const cleanupResponse = await fetch("/api/evidence/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ objects: result.storage_objects }),
      });
      if (!cleanupResponse.ok) {
        const cleanupBody = await cleanupResponse.json().catch(() => ({})) as { error?: string };
        cleanupError = cleanupBody.error ?? "Evidence object cleanup needs administrator review.";
      }
    }
    setImportStatus(`${Number(result.purged_count ?? 0)} User ID dataset(s) permanently deleted. Audit history was preserved.${cleanupError ? " Evidence object cleanup needs administrator review." : ""}`);
    if (cleanupError) setError(cleanupError);
    setSelectedTrashIds([]); setPurgeConfirmOpen(false); setPurgeConfirmText("");
    await Promise.all([loadReport(), loadTrash()]);
    setTrashBusy(false);
  }

  async function moveSelectedSourcesToTrash() {
    if (!supabase || !selectedImportFileIds.length || sourceDeleteConfirmText !== "REMOVE") return;
    setSourceTrashBusy(true); setError(null);
    const { data, error: sourceError } = await supabase.rpc("trash_source_files", {
      p_file_ids: selectedImportFileIds,
      p_reason: sourceDeleteReason.trim() || null,
    });
    if (sourceError) setError(sourceError.message);
    else {
      setImportStatus(`${Number(data ?? 0)} uploaded source file(s) moved to Trash and excluded from analysis. Master scope or Portal TXN totals were recalculated safely.`);
      setSelectedImportFileIds([]); setSourceDeleteConfirmOpen(false); setSourceDeleteConfirmText(""); setActiveView("trash");
      await Promise.all([loadReport(), loadImportHistory(), loadSourceTrash()]);
    }
    setSourceTrashBusy(false);
  }

  async function restoreSelectedSources() {
    if (!supabase || !selectedSourceTrashIds.length) return;
    setSourceTrashBusy(true); setError(null);
    const { data, error: sourceError } = await supabase.rpc("restore_source_files", { p_file_ids: selectedSourceTrashIds });
    if (sourceError) setError(sourceError.message);
    else {
      setImportStatus(`${Number(data ?? 0)} uploaded source file(s) restored to their original Master or Portal destination. Analysis totals were recalculated.`);
      setSelectedSourceTrashIds([]);
      await Promise.all([loadReport(), loadImportHistory(), loadSourceTrash()]);
    }
    setSourceTrashBusy(false);
  }

  async function permanentlyDeleteSelectedSources() {
    if (!supabase || !selectedSourceTrashIds.length || sourcePurgeConfirmText !== "PERMANENT DELETE") return;
    setSourceTrashBusy(true); setError(null);
    const { data, error: sourceError } = await supabase.rpc("purge_source_files", { p_file_ids: selectedSourceTrashIds });
    if (sourceError) setError(sourceError.message);
    else {
      const result = (data ?? {}) as { purged_count?: number };
      setImportStatus(`${Number(result.purged_count ?? 0)} uploaded source file(s) permanently deleted. Audit history was preserved.`);
      setSelectedSourceTrashIds([]); setSourcePurgeConfirmOpen(false); setSourcePurgeConfirmText("");
      await Promise.all([loadReport(), loadImportHistory(), loadSourceTrash()]);
    }
    setSourceTrashBusy(false);
  }

  async function postImport(path: string, body: unknown) {
    if (!session) throw new Error("Officer sign-in is required.");
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string; result?: Record<string, unknown> };
    if (!response.ok) throw new Error(result.error ?? "Import failed.");
    return result.result ?? {};
  }

  async function recordImportFailure(sourceType: "master" | "portal", sourceLabel: string, message: string) {
    if (!supabase || !session) return;
    await supabase.rpc("record_import_failure", {
      p_source_type: sourceType,
      p_source_label: sourceLabel,
      p_error_message: message,
    });
  }

  async function importMaster(file: File) {
    setActiveView("imports"); setImportBusy(true); setImportStatus(`Reading and validating ${file.name} before importâ€¦`); setError(null);
    try {
      const [{ readWorkbookRows }, { inferMasterSheetContext, mergeMasterRecordsByUserId, parseMasterRows }] = await Promise.all([import("../lib/excel-import"), import("../../portal-parser/src/master-parser")]);
      const workbook = await readWorkbookRows(file, "master");
      const parsedSheets = workbook.sheets.map((sheet) => ({ sheet, parsed: parseMasterRows(sheet.rows, inferMasterSheetContext(sheet.worksheetName)) }));
      const validationMessages = parsedSheets.flatMap(({ parsed }) => [...parsed.errors, ...parsed.warnings]);
      const merged = mergeMasterRecordsByUserId(parsedSheets.flatMap(({ parsed }) => parsed.records));
      const records = merged.records;
      const duplicateUserIds = merged.duplicates.reduce((sum, duplicate) => sum + duplicate.sources.length - 1, 0);
      if (!records.length) throw new Error(validationMessages.slice(0, 8).join(" ") || "No valid Master User ID rows were found.");
      const missingPasswords = records.filter((record) => !record.password).length;
      const headerMap = Object.fromEntries(parsedSheets.map(({ sheet, parsed }) => [
        sheet.worksheetName,
        `row ${sheet.headerRowNumber}: ${Object.entries(parsed.headerMap).map(([field, header]) => `${field}â†${header}`).join(", ")}`,
      ]).concat(merged.duplicates.map((duplicate) => [
        `Duplicate User ID ${duplicate.userId}`,
        `${duplicate.sources.map((source) => `${source.name} â€” ${source.sheet} row ${source.row}`).join("; ")}. Reporting identity: ${records.find((record) => record.userId === duplicate.userId)?.block ?? "not set"} / ${records.find((record) => record.userId === duplicate.userId)?.group ?? "not set"}; credential source: ${duplicate.credentialSourceSheet ?? "password missing"}.`,
      ])));
      setPreparedImports([{
        key: `master:${workbook.sha256}`,
        sourceType: "master",
        fileName: file.name,
        fileSize: file.size,
        worksheetName: workbook.sheets.length === 1 ? workbook.sheets[0].worksheetName : `${workbook.sheets.length} data sheets`,
        headerRowNumber: workbook.headerRowNumber,
        rowCount: workbook.rowCount,
        acceptedRows: records.length,
        ignoredOutOfScope: 0,
        warningCount: validationMessages.length + duplicateUserIds,
        detectedStartDate: null,
        detectedEndDate: null,
        headerMap,
        sampleUserIds: records.slice(0, 5).map((record) => record.userId),
        payload: { sourceLabel: file.name, originalFilename: file.name, sha256: workbook.sha256, mimeType: workbook.mimeType, rowCount: workbook.rowCount, headerMap, records },
      }]);
      setImportStatus(`${file.name} passed multi-sheet Master validation: ${records.length} unique User IDs ready; ${missingPasswords} missing passwords will remain in scope but pending; ${duplicateUserIds} duplicate User ID row(s) skipped. Nothing has been imported yet.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Master import failed.";
      await recordImportFailure("master", file.name, message);
      setError(`${file.name}: validation failed. Nothing from this file was added to the Master Registry. ${message}`);
      setImportStatus(null);
      await loadImportHistory();
    }
    finally { setImportBusy(false); if (masterInput.current) masterInput.current.value = ""; }
  }

  async function importPortalFiles(files: File[]) {
    if (!supabase || !session || !files.length) return;
    setActiveView("imports"); setImportBusy(true); setImportStatus(`Validating ${files.length} portal file(s) before importâ€¦`); setError(null);
    const { data: workerIds, error: scopeError } = await supabase.from("workers").select("user_id").eq("active", true).is("deleted_at", null).is("source_deleted_by_file_id", null);
    if (scopeError) {
      await Promise.all(files.map((file) => recordImportFailure("portal", file.name, scopeError.message)));
      setError(`Portal files could not be checked against the Master Registry. Nothing was imported. ${scopeError.message}`);
      setImportBusy(false); await loadImportHistory(); return;
    }
    const scope = new Set((workerIds ?? []).map((row) => row.user_id));
    if (!scope.size) {
      const message = "Upload the master ID sheet before portal files so the in-scope User IDs are known.";
      await Promise.all(files.map((file) => recordImportFailure("portal", file.name, message)));
      setError(`${message} Nothing was imported.`); setImportBusy(false); await loadImportHistory(); return;
    }
    const failures: string[] = [];
    const prepared: PreparedImport[] = [];
    const [{ readWorkbookRows }, { parsePortalRows }] = await Promise.all([import("../lib/excel-import"), import("../../portal-parser/src/parser")]);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setImportStatus(`Validating portal file ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const workbook = await readWorkbookRows(file, "portal");
        const parsedSheets = workbook.sheets.map((sheet) => ({ sheet, parsed: parsePortalRows(sheet.rows, scope, workbook.reportDate) }));
        const errors = parsedSheets.flatMap(({ parsed }) => parsed.errors);
        const warnings = parsedSheets.flatMap(({ parsed }) => parsed.warnings);
        const records = parsedSheets.flatMap(({ parsed }) => parsed.records).map((record, recordIndex) => ({ ...record, sourceRowNumber: recordIndex + 1 }));
        if (!records.length) throw new Error(errors.slice(0, 8).join(" ") || "No in-scope transaction rows were found.");
        const ignoredOutOfScope = parsedSheets.reduce((total, { parsed }) => total + parsed.ignoredOutOfScope, 0);
        const dates = records.map((record) => record.transactionDate).sort();
        const headerMap = Object.fromEntries(parsedSheets.map(({ sheet, parsed }) => [
          sheet.worksheetName,
          `row ${sheet.headerRowNumber}: ${Object.entries(parsed.headerMap).map(([field, header]) => `${field}â†${header}`).join(", ")}${!parsed.headerMap.transactionDate && workbook.reportDate ? `, transactionDateâ†filename (${workbook.reportDate})` : ""}`,
        ]));
        prepared.push({
          key: `portal:${workbook.sha256}`,
          sourceType: "portal",
          fileName: file.name,
          fileSize: file.size,
          worksheetName: workbook.sheets.length === 1 ? workbook.sheets[0].worksheetName : `${workbook.sheets.length} data sheets`,
          headerRowNumber: workbook.headerRowNumber,
          rowCount: workbook.rowCount,
          acceptedRows: records.length,
          ignoredOutOfScope,
          warningCount: warnings.length + errors.length + records.filter((record) => record.possibleDuplicateWithinFile).length,
          detectedStartDate: dates[0] ?? null,
          detectedEndDate: dates.at(-1) ?? null,
          headerMap,
          sampleUserIds: Array.from(new Set(records.slice(0, 20).map((record) => record.userId))).slice(0, 5),
          payload: { sourceLabel: file.name, originalFilename: file.name, sha256: workbook.sha256, mimeType: workbook.mimeType, rowCount: workbook.rowCount, ignoredOutOfScope, headerMap, records },
        });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "failed";
        failures.push(`${file.name}: ${message}`);
        await recordImportFailure("portal", file.name, message);
      }
    }
    if (failures.length) setError(`${failures.length} file(s) failed validation and were not added. ${failures.join(" ")}`);
    setPreparedImports(prepared);
    setImportStatus(prepared.length ? `${prepared.length} portal file(s) passed validation but are not imported yet. Review filename, mapped columns, in-scope rows and date range, then confirm.` : null);
    setImportBusy(false);
    if (portalInput.current) portalInput.current.value = "";
    if (portalFolderInput.current) portalFolderInput.current.value = "";
    await loadImportHistory();
  }

  async function confirmPreparedImports() {
    if (!preparedImports.length) return;
    setImportBusy(true); setError(null); setImportStatus(`Importing ${preparedImports.length} confirmed file(s)â€¦`);
    const summaries: string[] = [];
    const failures: string[] = [];
    for (const item of preparedImports) {
      try {
        const path = item.sourceType === "master" ? "/api/import/master" : "/api/import/portal";
        const result = await postImport(path, item.payload);
        summaries.push(`${item.fileName}: ${String(result.accepted_rows ?? item.acceptedRows)} accepted; batch ${String(result.batch_id ?? "recorded")}`);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Import failed.";
        failures.push(`${item.fileName}: ${message}`);
        await recordImportFailure(item.sourceType, item.fileName, message);
      }
    }
    setPreparedImports([]);
    if (failures.length) setError(`${failures.length} confirmed file(s) failed and added no data. ${failures.join(" ")}`);
    setImportStatus(summaries.length ? `Upload successful. ${summaries.join(" â€¢ ")}. The Upload Center now shows the stored destination and final counts.` : null);
    setImportBusy(false);
    await Promise.all([loadReport(), loadImportHistory(), loadPendingCredentials()]);
  }

  const displayName = profile?.display_name || session?.user.email || "Development review";
  const roleLabel = profile?.role?.replaceAll("_", " ") || (developmentShell ? "Empty-state review" : "Awaiting role assignment");
  const progress = agent.total ? Math.round((agent.completed / agent.total) * 100) : 0;
  const canImport = profile?.role === "admin" || profile?.role === "technical_officer";
  const canManageTrash = profile?.role === "admin" || profile?.role === "technical_officer";
  const canPurgeTrash = profile?.role === "admin";
  const viewCopy: Record<DashboardView, { title: string; subtitle: string }> = {
    operations: { title: "Verification Operations", subtitle: "App, portal and field settlement in one verified view" },
    portal: { title: "Portal Entry", subtitle: "Transaction Report counts from traceable source files" },
    app: { title: "App Entry", subtitle: "Verified normal and high application counts" },
    reconciliation: { title: "Combined Reconciliation", subtitle: "User ID matched app, portal and field values" },
    evidence: { title: "Evidence", subtitle: "Protected proof organized by worker User ID" },
    imports: { title: "Upload Center", subtitle: "Persistent file status, accepted rows, errors and system destination" },
    credentials: { title: "Pending Passwords", subtitle: "Add confirmed credentials from an authorized source and retry safely" },
    passport: { title: "Passport", subtitle: "Field reference updates and technical verification status" },
    access: { title: "Officer Access", subtitle: "Approve officer requests, assign roles and control account access" },
    audit: { title: "Audit Log", subtitle: "Accountable imports, verification and field changes" },
    trash: { title: "Recoverable Trash", subtitle: "Restore safely or permanently delete with administrator confirmation" },
  };

  const currentViewCopy = viewCopy[activeView] ?? {
    title: "Project Rekhya",
    subtitle: "Operational dashboard",
  };

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">R</div><div><h1>Project Rekhya</h1><p>FIELD OPERATIONS</p></div></div><nav className="nav" aria-label="Primary navigation"><button className={`nav-button ${activeView === "operations" ? "active" : ""}`} onClick={() => setActiveView("operations")}><Gauge size={17} /> Operations</button><button className={`nav-button ${activeView === "portal" ? "active" : ""}`} onClick={() => setActiveView("portal")}><FileSpreadsheet size={17} /> Portal Entry</button><button className={`nav-button ${activeView === "app" ? "active" : ""}`} onClick={() => setActiveView("app")}><Smartphone size={17} /> App Entry</button><button className={`nav-button ${activeView === "reconciliation" ? "active" : ""}`} onClick={() => setActiveView("reconciliation")}><ListFilter size={17} /> Reconciliation</button><button className={`nav-button ${activeView === "evidence" ? "active" : ""}`} onClick={() => setActiveView("evidence")}><HardDriveUpload size={17} /> Evidence</button><button className={`nav-button ${activeView === "passport" ? "active" : ""}`} onClick={() => setActiveView("passport")}><ShieldCheck size={17} /> Passport</button><button className={`nav-button ${activeView === "imports" ? "active" : ""}`} onClick={() => setActiveView("imports")}><FolderOpen size={17} /> Upload Center</button>{canImport && <button className={`nav-button ${activeView === "credentials" ? "active" : ""}`} onClick={() => setActiveView("credentials")}><KeyRound size={17} /> Pending Passwords</button>}{canManageAccess && <button className={`nav-button ${activeView === "access" ? "active" : ""}`} onClick={() => setActiveView("access")}><UsersRound size={17} /> Officer Access</button>}<button className={`nav-button ${activeView === "trash" ? "active" : ""}`} onClick={() => setActiveView("trash")}><Trash2 size={17} /> Trash</button><button className={`nav-button ${activeView === "audit" ? "active" : ""}`} onClick={() => setActiveView("audit")}><Activity size={17} /> Audit Log</button></nav><div className="sidebar-foot"><span className="live-dot" />Operational realtime synchronization</div></aside>
    <div className="workspace"><header className="topbar"><button className="mobile-menu" aria-label="Open menu"><Menu size={18} /></button><div className="topbar-copy"><h2>{currentViewCopy.title}</h2><p>{currentViewCopy.subtitle}</p></div><div className="operator"><div className="operator-copy"><strong>{displayName}</strong><span>{roleLabel}</span></div><div className="operator-badge">{displayName.slice(0, 1).toUpperCase()}</div><ChevronDown size={15} color="#68766c" /></div></header>
      <main className="content">
        {developmentShell && <div className="notice warning"><strong>Development review:</strong> the interface is using the real empty state. No sample worker, portal, payment or verification data has been inserted.</div>}
        {profile?.role === "pending" && <div className="notice warning">Your account exists but an administrator must assign an operational role before records are available.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {importStatus && <div className="notice success" role="status">{importStatus}</div>}
        <div className="status-strip" aria-label="System readiness"><strong>System readiness</strong>{canUseTechnical && liveStatusEnabled && <><span className="status-item"><i className={`status-icon ${agentHeartbeatFresh && agent.deviceConnected && agent.adbAuthorized ? "ready" : "pending"}`} /> Android {agentHeartbeatFresh && agent.deviceConnected && agent.adbAuthorized ? "connected" : agent.deviceConnected && !agent.adbAuthorized ? "authorization required" : "not connected"}</span><span className="status-item"><i className={`status-icon ${agent.simDetected ? "ready" : "pending"}`} /> SIM {agent.simDetected ? "detected" : "not detected"}</span><span className="status-item"><i className={`status-icon ${agent.officialAppReady ? "ready" : "pending"}`} /> Official app {agent.officialAppReady ? "ready" : "not ready"}</span></>}<span className="status-item"><i className="status-icon ready" /> Cloud sync {session ? "connected" : "not connected"}</span><span className="status-item"><i className="status-icon ready" /> Date range synchronized</span>{canUseTechnical && <button className={`button ${liveStatusEnabled ? "primary" : ""}`} onClick={() => void toggleLiveStatus()}>Technical Live Status {liveStatusEnabled ? "ON" : "OFF"}</button>}</div>
        <section className="summary-grid" aria-label="Selected-range summary"><Metric label="In-scope User IDs" value={metrics.ids} note={`${appliedRange.start} â†’ ${appliedRange.end}`} icon={<UsersRound size={16} />} /><Metric label="Verified Accounts" value={metrics.verified} note="App identity status OK" icon={<ShieldCheck size={16} />} /><Metric label="Portal Entry" value={metrics.portal} note="Matched transaction rows" icon={<Database size={16} />} /><Metric label="App Entry" value={metrics.app} note="Normal â‚¹100 + High Entry" icon={<CircleDollarSign size={16} />} /></section>
        {canUseTechnical && <section className="section-grid"><article className="card panel"><div className="panel-head"><div><h3>Android Verification Agent</h3><p>Technical controls are isolated from field accounts. Turn Live Status ON before issuing commands.</p></div><span className={`pill ${liveStatusEnabled && (agent.status === "running" || phoneReady) ? "ok" : "pending"}`}>{!liveStatusEnabled ? "Live status off" : agent.status === "disconnected" ? "Phone not connected" : agent.status}</span></div><div className="agent-state"><div className="agent-cell"><span>Total IDs</span><strong>{liveStatusEnabled ? formatCount.format(agent.total) : "\u2014"}</strong></div><div className="agent-cell"><span>Completed</span><strong>{liveStatusEnabled ? formatCount.format(agent.completed) : "\u2014"}</strong></div><div className="agent-cell"><span>Current User ID</span><strong>{agent.currentUserId ?? "â€”"}</strong></div><div className="agent-cell"><span>Current Stage</span><strong>{agent.currentStage ?? (liveStatusEnabled ? "Waiting for device" : "Live status disabled")}</strong></div></div><div className="agent-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div><div className="single-run-control"><input className="control" inputMode="numeric" value={singleUserId} onChange={(event) => setSingleUserId(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Exact 10-digit User ID for Custom Test" /><button className="button primary" onClick={() => void issueAgentCommand("single")} disabled={!liveStatusEnabled || !phoneReady || !/^\d{10}$/.test(singleUserId)}>Run This User ID Only</button><span className="table-note">Uses applied range {appliedRange.start} \u2192 {appliedRange.end}</span></div><div className="agent-actions"><button className="button" onClick={() => void prepareAndroid()} disabled={!liveStatusEnabled || agent.status === "running"}><Smartphone size={14} /> {phoneReady ? "Re-check Android" : "Prepare Android"}</button><button className="button primary" onClick={() => void issueAgentCommand("start")} disabled={!liveStatusEnabled || !phoneReady || agent.status === "running"}><Play size={14} /> Start Full Run</button><button className="button" onClick={() => void issueAgentCommand("pause")} disabled={!liveStatusEnabled || agent.status !== "running"}><Pause size={14} /> Pause after current ID</button><button className="button" onClick={() => void issueAgentCommand("resume")} disabled={!liveStatusEnabled || !phoneReady}><Play size={14} /> Resume latest</button><button className="button" onClick={() => void issueAgentCommand("retry_pending")} disabled={!liveStatusEnabled || !phoneReady}><RefreshCw size={14} /> Retry pending</button><button className="button" onClick={() => void issueAgentCommand("restart")} disabled={!liveStatusEnabled || !phoneReady || agent.status === "running"}><RotateCcw size={14} /> Restart From Beginning</button><button className="button danger" onClick={() => void issueAgentCommand("stop_safely")} disabled={!liveStatusEnabled || agent.status !== "running"}><Square size={13} /> Stop safely</button></div></article>
          <article className="card panel"><div className="panel-head"><div><h3>Exception Queue</h3><p>Detector/manual-review failures do not masquerade as network retries.</p></div><AlertTriangle size={19} color="#b77820" /></div><div className="queue-list"><div className="queue-row"><span>Password issue</span><strong className="amber">{agent.passwordPending}</strong></div><div className="queue-row"><span>Network/server pending</span><strong className="amber">{agent.networkPending}</strong></div><div className="queue-row"><span>Currently running</span><strong>{agent.running}</strong></div><div className="queue-row"><span>Live Status</span><strong>{liveStatusEnabled ? "ON" : "OFF"}</strong></div></div></article></section>}
        {activeView === "passport" && <PassportPanel items={passportItems} busy={passportBusy} canUpdate={canUpdatePassport} canVerify={canVerifyPassport} referenceDrafts={passportReferenceDrafts} noteDrafts={passportNoteDrafts} onReference={(id, value) => setPassportReferenceDrafts((current) => ({ ...current, [id]: value }))} onNote={(id, value) => setPassportNoteDrafts((current) => ({ ...current, [id]: value }))} onSave={(item) => void savePassport(item)} onVerify={(item) => void verifyPassport(item)} onRefresh={() => void loadPassportWorkflow()} />}
        {activeView === "access" && canManageAccess && <AccessPanel items={accessItems} drafts={accessRoleDrafts} busy={accessBusy} onRole={(id, role) => setAccessRoleDrafts((current) => ({ ...current, [id]: role }))} onApprove={(item) => void approveOfficer(item)} onActive={(item, active) => void setOfficerActive(item, active)} onRefresh={() => void loadAccessRequests()} />}
        {activeView === "audit" && <section className="card report"><div className="report-header"><div><h3>Audit Log</h3><p>Latest 250 accountable operational events. Access follows officer role policy.</p></div></div><div className="table-wrap"><table className="data-table audit-table"><thead><tr><th>Time</th><th>Action</th><th>Record Type</th><th>Record ID</th><th>Officer ID</th></tr></thead><tbody>{!auditItems.length && <tr><td className="empty" colSpan={5}><Activity size={24} /><strong>No audit events are available to this role.</strong></td></tr>}{auditItems.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td><strong>{item.action.replaceAll("_", " ")}</strong></td><td>{item.entity_type.replaceAll("_", " ")}</td><td className="id-code">{item.entity_id ?? "â€”"}</td><td className="id-code">{item.actor_id ?? "System"}</td></tr>)}</tbody></table></div></section>}
        {activeView === "imports" && <ImportHistoryPanel items={importItems} selectedFileIds={selectedImportFileIds} busy={importHistoryBusy || importBusy || sourceTrashBusy} canImport={canImport} canManage={canManageTrash} onRefresh={() => void loadImportHistory()} onUploadMaster={() => masterInput.current?.click()} onUploadPortal={() => portalInput.current?.click()} onUploadFolder={() => portalFolderInput.current?.click()} onToggle={(id) => setSelectedImportFileIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSelectAll={() => { const eligible = importItems.filter((item) => item.file_id && !item.is_trashed && (item.batch_status === "processed" || item.batch_status === "processed_with_warnings")).map((item) => item.file_id!); setSelectedImportFileIds(selectedImportFileIds.length === eligible.length ? [] : eligible); }} onTrash={() => setSourceDeleteConfirmOpen(true)} />}
        {activeView === "credentials" && <PendingCredentialsPanel items={pendingCredentials} drafts={credentialDrafts} busy={credentialBusy} saveId={credentialSaveId} onRefresh={() => void loadPendingCredentials()} onChange={(workerId, value) => setCredentialDrafts((current) => ({ ...current, [workerId]: value }))} onSave={(workerId) => void saveConfirmedCredential(workerId)} />}
        {activeView === "trash" && <><TrashPanel items={trashItems} selectedIds={selectedTrashIds} busy={trashBusy} canRestore={canManageTrash} canPurge={canPurgeTrash} onToggle={(id) => toggleSelection(id, true)} onSelectAll={() => setSelectedTrashIds(selectedTrashIds.length === trashItems.length ? [] : trashItems.map((item) => item.worker_id))} onRestore={() => void restoreSelectedTrash()} onPurge={() => setPurgeConfirmOpen(true)} onRefresh={() => void loadTrash()} /><SourceFileTrashPanel items={sourceTrashItems} selectedIds={selectedSourceTrashIds} busy={sourceTrashBusy} canRestore={canManageTrash} canPurge={canPurgeTrash} onToggle={(id) => setSelectedSourceTrashIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSelectAll={() => setSelectedSourceTrashIds(selectedSourceTrashIds.length === sourceTrashItems.length ? [] : sourceTrashItems.map((item) => item.file_id))} onRestore={() => void restoreSelectedSources()} onPurge={() => setSourcePurgeConfirmOpen(true)} onRefresh={() => void loadSourceTrash()} /></>}
        <section className={`card report ${activeView === "audit" || activeView === "trash" || activeView === "imports" || activeView === "credentials" || activeView === "passport" || activeView === "access" ? "view-hidden" : ""}`}><div className="report-header"><div><h3>{activeView === "portal" ? "Portal Entry Report" : activeView === "app" ? "App Entry Report" : activeView === "evidence" ? "Evidence Index" : "Combined Reconciliation"}</h3><p>Only records dated {appliedRange.start} through {appliedRange.end} are included. Later dates are excluded until you change and apply the End Date.</p></div><div className="report-actions">{canManageTrash && <button className="button danger" disabled={!selectedVisibleWorkerIds.length} onClick={() => setDeleteConfirmOpen(true)}><Trash2 size={15} /> {selectedVisibleWorkerIds.length ? `Move ${selectedVisibleWorkerIds.length} selected to Trash` : "Select User IDs to delete"}</button>}{canImport && <><input ref={masterInput} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMaster(file); }} /><input ref={portalInput} hidden multiple type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void importPortalFiles(Array.from(event.target.files ?? []))} /><input ref={(node) => { portalFolderInput.current = node; if (node) node.setAttribute("webkitdirectory", ""); }} hidden multiple type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void importPortalFiles(Array.from(event.target.files ?? []).filter((file) => file.name.toLowerCase().endsWith(".xlsx")))} /><button className="button" disabled={importBusy} onClick={() => masterInput.current?.click()}><HardDriveUpload size={15} /> Upload Master</button><button className="button" disabled={importBusy} onClick={() => portalInput.current?.click()}><FileSpreadsheet size={15} /> Upload Portal Files</button><button className="button" disabled={importBusy} onClick={() => portalFolderInput.current?.click()}><FolderOpen size={15} /> Upload Portal Folder</button></>}<button className="button" onClick={() => setExportOpen(true)} disabled={!rows.length}><Download size={15} /> Export options</button></div></div>
          <div className="filters"><div className="field search-field"><label htmlFor="search">Search User ID / Name</label><div style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", left: 11, top: 12, color: "#718078" }} /><input id="search" className="control" style={{ paddingLeft: 33 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type User ID or name" /></div></div><div className="field"><label htmlFor="block">Block</label><select id="block" className="control" value={block} onChange={(event) => setBlock(event.target.value)}><option value="all">All Blocks</option>{blocks.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><div className="field"><label htmlFor="group">Worker Type</label><select id="group" className="control" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">All Groups</option><option value="Krishi Sakhi">Krishi Sakhi</option><option value="Vendor">Vendor</option><option value="SeSTA">SeSTA</option></select></div><div className="field"><label htmlFor="start">Start Date</label><input id="start" className="control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div className="field"><label htmlFor="end">End Date</label><input id="end" className="control" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div><button className="button primary" style={{ alignSelf: "end" }} onClick={applyFilters}>Apply</button><button className="button" style={{ alignSelf: "end" }} onClick={() => void loadReport()} disabled={reportLoading}><RefreshCw size={14} /> {reportLoading ? "Loading" : "Refresh"}</button></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th rowSpan={2} className="select-cell"><input type="checkbox" aria-label="Select all visible User IDs" disabled={!canManageTrash || !rows.length} checked={!!rows.length && selectedWorkerIds.length === rows.length} onChange={() => setSelectedWorkerIds(selectedWorkerIds.length === rows.length ? [] : rows.map((row) => row.worker_id))} /></th><th rowSpan={2}>Sl No.</th><th rowSpan={2}>Name</th><th rowSpan={2}>User ID</th><th rowSpan={2}>Password</th><th rowSpan={2} className="num">Portal Entry</th><th rowSpan={2} className="num">App Entry</th><th rowSpan={2} className="num">High Entry</th><th colSpan={2}>Krishi Sakhi</th><th colSpan={2}>Vendor</th><th colSpan={2}>SeSTA</th><th rowSpan={2}>Status</th><th rowSpan={2}>Evidence</th></tr><tr><th className="num">Amount Received</th><th className="num">Pending Amount</th><th className="num">Amount Received</th><th className="num">Pending Amount</th><th className="num">Amount Received</th><th className="num">Pending Amount</th></tr></thead><tbody>
            {!rows.length && <tr><td className="empty" colSpan={16}><Bot size={26} /><strong>No in-scope records for this view</strong>Upload the master ID sheet and transaction files, or adjust the selected filters.</td></tr>}
            {rows.map((row, index) => <tr key={row.worker_id} className={selectedWorkerIds.includes(row.worker_id) ? "selected-row" : ""}><td className="select-cell"><input type="checkbox" aria-label={`Select ${row.user_id}`} disabled={!canManageTrash} checked={selectedWorkerIds.includes(row.worker_id)} onChange={() => toggleSelection(row.worker_id)} /></td><td>{index + 1}</td><td><strong>{row.name}</strong><br /><span style={{ color: "#708078", fontSize: 10 }}>{row.block ?? "Block not set"}</span></td><td className="id-code">{row.user_id}</td><td><button className="credential-button" onClick={() => void revealCredential(row.worker_id)}>{revealed[row.worker_id] ?? "View"}</button></td><td className="num">{row.portal_entry}</td><td className="num"><strong>{row.app_entry}</strong></td><td className="num">{row.high_entry}</td>{(["krishi_sakhi", "vendor", "sesta"] as const).flatMap((groupType) => (["received", "pending"] as const).map((field) => { const key = draftKey(row.worker_id, groupType, field); const source = paymentSource(row, groupType, field); return <td className="num" key={key}><input aria-label={`${row.user_id} ${groupType} ${field}`} className="payment-input" inputMode="decimal" value={paymentDrafts[key] ?? (source ?? "")} onChange={(event) => setPaymentDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void savePayments(row.worker_id)} /></td>; }))}<td><span className={`pill ${normalizedStatus(row) === "ok" ? "ok" : "pending"}`}>{statusLabel(row)}</span>{issueLabel(row) && <><br /><span className="table-note">{issueLabel(row)}</span></>}</td><td><button className="button" onClick={() => void openEvidence(row)} title={row.evidence_count ? `${row.evidence_count} evidence file(s)` : "Open verification details"}><Eye size={14} /> {row.evidence_count ? `${row.evidence_count} file${Number(row.evidence_count) === 1 ? "" : "s"}` : "Review"}</button></td></tr>)}
          </tbody><tfoot><tr><td /><td /><td>Filtered totals</td><td colSpan={5} /><td className="num">{formatMoney.format(totals.ksReceived)}</td><td className="num">{formatMoney.format(totals.ksPending)}</td><td className="num">{formatMoney.format(totals.vendorReceived)}</td><td className="num">{formatMoney.format(totals.vendorPending)}</td><td className="num">{formatMoney.format(totals.sestaReceived)}</td><td className="num">{formatMoney.format(totals.sestaPending)}</td><td colSpan={2} /></tr></tfoot></table></div>
        </section>
      </main>
    </div>
    {!!preparedImports.length && <div className="modal-backdrop" role="presentation"><section className="modal-card import-review-modal" role="dialog" aria-modal="true" aria-labelledby="import-review-title"><div className="modal-head"><div><h3 id="import-review-title">Review and confirm files</h3><p>Validation passed, but nothing has been imported yet. Confirm only after checking the filename, sheet, columns and sample User IDs.</p></div><button className="icon-button" aria-label="Cancel import review" onClick={() => { setPreparedImports([]); setImportStatus("Import cancelled. No data was added."); }}><X size={18} /></button></div><div className="notice warning"><strong>Final check before upload:</strong> Master files control the User ID/password scope used by the Android bot. Portal files add transaction counts only for active Master User IDs.</div><div className="import-review-list">{preparedImports.map((item) => <article className="import-review-card" key={item.key}><div className="import-review-title"><div><span className="pill pending">{item.sourceType === "master" ? "Master ID / Password" : "Portal TXN"}</span><h4>{item.fileName}</h4><p>{(item.fileSize / 1024).toFixed(1)} KB Â· Sheet: {item.worksheetName}</p></div><CheckCircle2 size={22} color="#267346" /></div><div className="import-review-stats"><span><small>Rows read</small><strong>{formatCount.format(item.rowCount)}</strong></span><span><small>Accepted</small><strong>{formatCount.format(item.acceptedRows)}</strong></span><span><small>Outside scope</small><strong>{formatCount.format(item.ignoredOutOfScope)}</strong></span><span><small>Warnings</small><strong>{formatCount.format(item.warningCount)}</strong></span></div><p><strong>Detected dates:</strong> {item.detectedStartDate && item.detectedEndDate ? `${item.detectedStartDate} â†’ ${item.detectedEndDate}` : "Not applicable for Master identity data"}</p><p><strong>Sample User IDs:</strong> {item.sampleUserIds.join(", ") || "None detected"}</p><div className="header-map"><strong>Detected Excel columns</strong>{Object.entries(item.headerMap).map(([field, header]) => <span key={field}><code>{field}</code><i>â†</i>{header}</span>)}</div></article>)}</div><div className="modal-actions"><span>{preparedImports.length} validated file(s) Â· not imported yet</span><div className="report-actions"><button className="button" disabled={importBusy} onClick={() => { setPreparedImports([]); setImportStatus("Import cancelled. No data was added."); }}>Cancel</button><button className="button primary" disabled={importBusy} onClick={() => void confirmPreparedImports()}><HardDriveUpload size={15} /> {importBusy ? "Importingâ€¦" : "Confirm and import"}</button></div></div></section></div>}
    {exportOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setExportOpen(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="export-title">Excel export</h3><p>The export uses the current filters and inclusive date range.</p></div><button className="icon-button" aria-label="Close export options" onClick={() => setExportOpen(false)}><X size={18} /></button></div><div className="export-presets"><button className="button" onClick={() => setExportColumns(exportOptions.map((option) => option.key))}>Full &amp; Final</button><button className="button" onClick={() => setExportColumns(["serial_no", "name", "user_id", "password", "portal_entry", "app_entry", "high_entry"])}>Core combined</button><button className="button" onClick={() => setExportColumns([])}>Clear selection</button></div><div className="export-grid">{exportOptions.map((option) => <label className="check-row" key={option.key}><input type="checkbox" checked={exportColumns.includes(option.key)} onChange={(event) => setExportColumns((current) => event.target.checked ? [...current, option.key] : current.filter((column) => column !== option.key))} /><span>{option.label}</span></label>)}</div><div className="modal-actions"><span>{exportColumns.length} column(s) selected</span><button className="button primary" disabled={!exportColumns.length || exportBusy} onClick={() => void downloadReport()}><Download size={15} /> {exportBusy ? "Preparing securelyâ€¦" : "Download Excel"}</button></div></section></div>}
    {evidenceOpen && <div className="modal-backdrop" role="presentation" onMouseDown={closeEvidence}><section className="modal-card evidence-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="evidence-title">Evidence â€” {evidenceOpen.user_id}</h3><p>{evidenceOpen.name} Â· protected evidence is fetched only after an authorized officer opens an item.</p></div><button className="icon-button" aria-label="Close evidence" onClick={closeEvidence}><X size={18} /></button></div><div className="evidence-scope"><button className={`button ${evidenceScope === "current" ? "primary" : ""}`} onClick={() => { setEvidenceScope("current"); void loadEvidence(evidenceOpen, "current"); }}>Current run</button><button className={`button ${evidenceScope === "previous" ? "primary" : ""}`} onClick={() => { setEvidenceScope("previous"); void loadEvidence(evidenceOpen, "previous"); }}>Previous runs</button><button className={`button ${evidenceScope === "all" ? "primary" : ""}`} onClick={() => { setEvidenceScope("all"); void loadEvidence(evidenceOpen, "all"); }}>All</button></div>{evidenceBusy ? <div className="empty"><RefreshCw className="spin" size={22} /><strong>Loading evidence indexâ€¦</strong></div> : !evidenceItems.length ? <div className="empty"><HardDriveUpload size={24} /><strong>No screenshot evidence is stored for this selection.</strong><span>{issueLabel(evidenceOpen) ?? "No captured app evidence is available for this verification state."}</span></div> : <div className="evidence-grid">{evidenceItems.map((item) => <article className="evidence-card" key={item.id}>{item.mime_type.startsWith("image/") && item.previewUrl ? <button type="button" className="evidence-thumb-button" aria-label={`View ${item.original_filename} full size`} onClick={() => void loadEvidencePreview(item)}><Image unoptimized width={320} height={200} src={item.previewUrl} alt={`${item.category} evidence for ${evidenceOpen.user_id}`} /></button> : <div className="evidence-file"><FileSpreadsheet size={28} /></div>}<div><div className="evidence-badges"><span className="pill ok">{item.category.replaceAll("_", " ")}</span><span className="pill pending">{item.run_scope}</span></div><h4>{item.original_filename}</h4><p>{new Date(item.captured_at).toLocaleString()} Â· {item.storage_provider.replaceAll("_", " ")}</p><button className="button" disabled={evidencePreviewBusy === item.id} onClick={() => void loadEvidencePreview(item)}><Eye size={14} /> {item.previewUrl ? "View full size" : evidencePreviewBusy === item.id ? "OpeningÃ¢â‚¬Â¦" : "Open & view full size"}</button></div></article>)}</div>}</section></div>}    {evidenceFullscreen?.previewUrl && <div className="evidence-lightbox" role="presentation" onMouseDown={() => setEvidenceFullscreen(null)}>
      <section className="evidence-lightbox-card" role="dialog" aria-modal="true" aria-label={`Full size evidence ${evidenceFullscreen.original_filename}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="evidence-lightbox-head">
          <div>
            <strong>{evidenceFullscreen.original_filename}</strong>
            <span>{evidenceFullscreen.category.replaceAll("_", " ")} Ã‚Â· {new Date(evidenceFullscreen.captured_at).toLocaleString()}</span>
          </div>
          <button className="icon-button" aria-label="Close full size evidence" onClick={() => setEvidenceFullscreen(null)}><X size={18} /></button>
        </div>
        <div className="evidence-full-stage">
          <Image unoptimized width={1080} height={1920} className="evidence-full-image" src={evidenceFullscreen.previewUrl} alt={`Full size ${evidenceFullscreen.category} evidence`} />
        </div>
        <div className="evidence-lightbox-foot">Full-resolution protected evidence Ã‚Â· click outside or close to return</div>
      </section>
    </div>}

    {sourceDeleteConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSourceDeleteConfirmOpen(false)}><section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="source-delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="source-delete-title">Move {selectedImportFileIds.length} uploaded file(s) to Trash?</h3><p>The files and their accepted data will be removed from live analysis, but remain restorable.</p></div><button className="icon-button" aria-label="Close" onClick={() => setSourceDeleteConfirmOpen(false)}><X size={18} /></button></div><div className="notice warning"><strong>Original destination is preserved:</strong> restoring a Master file returns its identities to the Master Registry; restoring a Portal file returns its TXN records to Portal Transaction Records. Totals and scope are recalculated after either action.</div><div className="field"><label htmlFor="source-delete-reason">Reason</label><input id="source-delete-reason" className="control" value={sourceDeleteReason} onChange={(event) => setSourceDeleteReason(event.target.value)} /></div><div className="field confirm-field"><label htmlFor="source-delete-confirm">Type REMOVE to confirm</label><input id="source-delete-confirm" className="control" autoComplete="off" value={sourceDeleteConfirmText} onChange={(event) => setSourceDeleteConfirmText(event.target.value)} /></div><div className="modal-actions"><button className="button" onClick={() => setSourceDeleteConfirmOpen(false)}>Cancel</button><button className="button danger solid-danger" disabled={sourceDeleteConfirmText !== "REMOVE" || sourceTrashBusy} onClick={() => void moveSelectedSourcesToTrash()}><Trash2 size={15} /> Move uploads to Trash</button></div></section></div>}
    {sourcePurgeConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSourcePurgeConfirmOpen(false)}><section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="source-purge-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="source-purge-title">Permanently delete {selectedSourceTrashIds.length} uploaded file(s)?</h3><p>This permanently removes the selected source and its data. It cannot be restored.</p></div><button className="icon-button" aria-label="Close" onClick={() => setSourcePurgeConfirmOpen(false)}><X size={18} /></button></div><div className="notice error"><strong>Permanent action:</strong> affected Master identities or Portal transactions will be removed while protected Audit Log entries remain. Project Rekhya recalculates the remaining active source data.</div><div className="field confirm-field"><label htmlFor="source-purge-confirm">Type PERMANENT DELETE to confirm</label><input id="source-purge-confirm" className="control" autoComplete="off" value={sourcePurgeConfirmText} onChange={(event) => setSourcePurgeConfirmText(event.target.value)} /></div><div className="modal-actions"><button className="button" onClick={() => setSourcePurgeConfirmOpen(false)}>Cancel</button><button className="button danger solid-danger" disabled={sourcePurgeConfirmText !== "PERMANENT DELETE" || sourceTrashBusy} onClick={() => void permanentlyDeleteSelectedSources()}><Trash2 size={15} /> Permanently delete uploads</button></div></section></div>}
    {deleteConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteConfirmOpen(false)}><section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="delete-title">Move {selectedWorkerIds.length} User ID dataset(s) to Trash?</h3><p>This removes the selected Master identities and all linked operational data from live reports. Nothing is permanently deleted at this stage.</p></div><button className="icon-button" aria-label="Close" onClick={() => setDeleteConfirmOpen(false)}><X size={18} /></button></div><div className="notice warning"><strong>Recoverable safety stage:</strong> Portal/App records, payments, evidence references, credentials and verification history remain recoverable. Trash keeps a 30-day protection date and remains available until an Admin permanently deletes it.</div><div className="field"><label htmlFor="delete-reason">Reason</label><input id="delete-reason" className="control" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></div><div className="field confirm-field"><label htmlFor="delete-confirm">Type DELETE to confirm</label><input id="delete-confirm" className="control" autoComplete="off" value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} /></div><div className="modal-actions"><button className="button" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button><button className="button danger solid-danger" disabled={deleteConfirmText !== "DELETE" || trashBusy} onClick={() => void moveSelectedToTrash()}><Trash2 size={15} /> Move to Trash</button></div></section></div>}
    {purgeConfirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPurgeConfirmOpen(false)}><section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="purge-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h3 id="purge-title">Permanently delete {selectedTrashIds.length} dataset(s)?</h3><p>This is the final deletion stage and cannot be recovered.</p></div><button className="icon-button" aria-label="Close" onClick={() => setPurgeConfirmOpen(false)}><X size={18} /></button></div><div className="notice error"><strong>Permanent action:</strong> Master identity, encrypted credential, portal/app records, payments, evidence files and verification history for the selected User IDs will be removed. Audit history remains protected.</div><div className="field confirm-field"><label htmlFor="purge-confirm">Type PERMANENT DELETE to confirm</label><input id="purge-confirm" className="control" autoComplete="off" value={purgeConfirmText} onChange={(event) => setPurgeConfirmText(event.target.value)} /></div><div className="modal-actions"><button className="button" onClick={() => setPurgeConfirmOpen(false)}>Cancel</button><button className="button danger solid-danger" disabled={purgeConfirmText !== "PERMANENT DELETE" || trashBusy} onClick={() => void permanentlyDeleteSelectedTrash()}><Trash2 size={15} /> Permanently delete</button></div></section></div>}
  </div>;
}

function PendingCredentialsPanel({ items, drafts, busy, saveId, onRefresh, onChange, onSave }: {
  items: PendingCredential[];
  drafts: Record<string, string>;
  busy: boolean;
  saveId: string | null;
  onRefresh: () => void;
  onChange: (workerId: string, value: string) => void;
  onSave: (workerId: string) => void;
}) {
  return <section className="card report credential-panel">
    <div className="report-header"><div><h3>Pending passwords</h3><p>Only credentials confirmed by the account owner, an authorized source, or an official reset should be entered.</p></div><div className="report-actions"><span className="pill pending">{formatCount.format(items.length)} pending</span><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button></div></div>
    <div className="notice warning credential-note"><strong>Safe verification rule:</strong> Project Rekhya does not try another worker&apos;s password or cycle password lists across accounts. Save one confirmed password against its matching User ID. It is encrypted immediately, synchronized to the Master record, and removed from this page.</div>
    <div className="table-wrap"><table className="data-table credential-table"><thead><tr><th>Sl No.</th><th>Name</th><th>User ID</th><th>Confirmed password</th><th>Action</th></tr></thead><tbody>
      {!items.length && <tr><td className="empty" colSpan={5}><KeyRound size={25} /><strong>{busy ? "Loading pending passwordsâ€¦" : "No password is pending"}</strong>Missing-password records will appear here after a Master workbook is confirmed and imported.</td></tr>}
      {items.map((item, index) => <tr key={item.worker_id}><td>{index + 1}</td><td><strong>{item.name}</strong></td><td className="id-code">{item.user_id}</td><td><input className="control credential-input" type="password" autoComplete="new-password" aria-label={`Confirmed password for ${item.user_id}`} value={drafts[item.worker_id] ?? ""} onChange={(event) => onChange(item.worker_id, event.target.value)} placeholder="Enter confirmed password" /></td><td><button className="button primary" disabled={saveId === item.worker_id || !(drafts[item.worker_id] ?? "").trim()} onClick={() => onSave(item.worker_id)}><ShieldCheck size={14} /> {saveId === item.worker_id ? "Savingâ€¦" : "Save confirmed"}</button></td></tr>)}
    </tbody></table></div>
  </section>;
}

function ImportHistoryPanel({ items, selectedFileIds, busy, canImport, canManage, onRefresh, onUploadMaster, onUploadPortal, onUploadFolder, onToggle, onSelectAll, onTrash }: {
  items: ImportHistoryItem[];
  selectedFileIds: string[];
  busy: boolean;
  canImport: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onUploadMaster: () => void;
  onUploadPortal: () => void;
  onUploadFolder: () => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onTrash: () => void;
}) {
  const eligibleIds = items.filter((item) => item.file_id && !item.is_trashed && (item.batch_status === "processed" || item.batch_status === "processed_with_warnings")).map((item) => item.file_id!);
  return <section className="card report upload-panel">
    <div className="report-header"><div><h3>Upload and processing history</h3><p>Every accepted or failed attempt is listed here with its exact filename, outcome and system destination.</p></div><div className="report-actions"><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button><button className="button danger" onClick={onTrash} disabled={!canManage || !selectedFileIds.length || busy}><Trash2 size={14} /> {selectedFileIds.length ? `Move ${selectedFileIds.length} selected upload(s) to Trash` : "Select uploads to remove"}</button><button className="button" onClick={onUploadMaster} disabled={!canImport || busy}><HardDriveUpload size={14} /> Upload Master</button><button className="button" onClick={onUploadPortal} disabled={!canImport || busy}><FileSpreadsheet size={14} /> Upload Portal Files</button><button className="button" onClick={onUploadFolder} disabled={!canImport || busy}><FolderOpen size={14} /> Upload Portal Folder</button></div></div>
    <div className="notice upload-note"><strong>How upload confirmation works:</strong> first, a review screen shows the exact filename, sheet, detected columns, accepted rows, sample User IDs and Portal date range. Nothing is imported until you press Ã¢â‚¬Å“Confirm and importÃ¢â‚¬Â. After import, this history keeps the success/error, batch, counts and destination. The original Excel workbook itself is not archived as a downloadable file.</div>
    <div className="table-wrap"><table className="data-table upload-table"><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Select all removable uploads" disabled={!canManage || !eligibleIds.length} checked={!!eligibleIds.length && selectedFileIds.length === eligibleIds.length} onChange={onSelectAll} /></th><th>Time</th><th>Type</th><th>Filename</th><th>Status</th><th className="num">Accepted / Read</th><th className="num">Outside Scope</th><th className="num">Warnings</th><th>Detected Date Range</th><th>System Destination</th><th>Result / Error</th></tr></thead><tbody>
      {!items.length && <tr><td className="empty" colSpan={11}><FolderOpen size={25} /><strong>{busy ? "Checking upload historyâ€¦" : "No uploads recorded"}</strong>Choose Master, Portal Files or a Portal Folder. Success and failure details will remain visible here.</td></tr>}
      {items.map((item) => {
        const successful = item.batch_status === "processed" || item.batch_status === "processed_with_warnings";
        const removable = !!item.file_id && successful && !item.is_trashed;
        const statusClass = item.batch_status === "failed" ? "error" : item.is_trashed ? "pending" : successful ? "ok" : "pending";
        const dateRange = item.detected_start_date && item.detected_end_date ? `${item.detected_start_date} â†’ ${item.detected_end_date}` : "â€”";
        return <tr key={item.batch_id} className={item.file_id && selectedFileIds.includes(item.file_id) ? "selected-row" : ""}><td className="select-cell"><input type="checkbox" aria-label={`Select uploaded ${item.original_filename ?? item.source_label}`} disabled={!canManage || !removable} checked={!!item.file_id && selectedFileIds.includes(item.file_id)} onChange={() => item.file_id && onToggle(item.file_id)} /></td><td>{new Date(item.created_at).toLocaleString()}</td><td><span className="pill pending">{item.source_type === "master" ? "Master ID / Password" : "Portal TXN"}</span></td><td><strong>{item.original_filename ?? item.source_label}</strong><br /><span className="table-note">Batch {item.batch_id.slice(0, 8)}</span></td><td><span className={`pill ${statusClass}`}>{item.is_trashed ? "in trash" : item.batch_status.replaceAll("_", " ")}</span></td><td className="num"><strong>{formatCount.format(item.accepted_row_count)}</strong> / {formatCount.format(item.row_count)}</td><td className="num">{formatCount.format(item.ignored_out_of_scope_count)}</td><td className="num">{formatCount.format(Math.max(item.warning_count, item.duplicate_row_count))}</td><td>{dateRange}</td><td><strong>{item.data_destination}</strong><br /><span className="table-note">{item.is_trashed ? "Excluded from live analysis; available in Trash." : successful ? "Accepted data is active in this original destination." : "No data was accepted from this failed attempt."}</span></td><td>{item.error_message ? <span className="upload-error">{item.error_message}</span> : item.is_trashed ? <span className="table-note">Removed from analysis on {item.file_deleted_at ? new Date(item.file_deleted_at).toLocaleString() : "recorded date"}</span> : <span className="upload-success"><CheckCircle2 size={13} /> Completed and audited</span>}</td></tr>;
      })}
    </tbody></table></div>
  </section>;
}

function TrashPanel({ items, selectedIds, busy, canRestore, canPurge, onToggle, onSelectAll, onRestore, onPurge, onRefresh }: {
  items: TrashWorker[];
  selectedIds: string[];
  busy: boolean;
  canRestore: boolean;
  canPurge: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onRefresh: () => void;
}) {
  return <section className="card report trash-panel">
    <div className="report-header"><div><h3>User ID datasets</h3><p>Deleted Master identities and all their linked operational records remain restorable. The 30-day date is a protection marker; nothing is auto-purged.</p></div><div className="report-actions"><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button><button className="button" onClick={onRestore} disabled={!canRestore || !selectedIds.length || busy}><RotateCcw size={14} /> Restore selected</button><button className="button danger" onClick={onPurge} disabled={!canPurge || !selectedIds.length || busy}><Trash2 size={14} /> Permanent delete</button></div></div>
    <div className="notice warning trash-note"><strong>Two-stage protection:</strong> live report deletion first moves data here. Linked records are not moved to another table or directory. Restore reactivates the same User ID, original Block/Group and the same portal, app, payment, evidence and verification references. Permanent delete is Admin-only and requires a second typed confirmation.</div>
    <div className="table-wrap"><table className="data-table trash-table"><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Select all Trash items" disabled={!items.length || !canRestore} checked={!!items.length && selectedIds.length === items.length} onChange={onSelectAll} /></th><th>Name</th><th>User ID</th><th>Block / Group</th><th>Deleted</th><th>Protected through</th><th>Deleted by</th><th className="num">Portal</th><th className="num">App</th><th className="num">Evidence</th><th className="num">Payments</th><th className="num">Runs</th></tr></thead><tbody>
      {!items.length && <tr><td className="empty" colSpan={12}><Trash2 size={25} /><strong>{busy ? "Loading Trashâ€¦" : "Trash is empty"}</strong>No operational datasets are waiting for recovery or permanent deletion.</td></tr>}
      {items.map((item) => <tr key={item.worker_id} className={selectedIds.includes(item.worker_id) ? "selected-row" : ""}><td className="select-cell"><input type="checkbox" aria-label={`Select deleted ${item.user_id}`} disabled={!canRestore} checked={selectedIds.includes(item.worker_id)} onChange={() => onToggle(item.worker_id)} /></td><td><strong>{item.name}</strong>{item.deletion_reason && <><br /><span className="table-note">{item.deletion_reason}</span></>}</td><td className="id-code">{item.user_id}</td><td>{item.block ?? "â€”"}<br /><span className="table-note">{item.group_name ?? "Group not set"}</span></td><td>{new Date(item.deleted_at).toLocaleString()}</td><td>{new Date(item.retention_until).toLocaleDateString()}</td><td>{item.deleted_by_name ?? "â€”"}</td><td className="num">{formatCount.format(item.portal_count)}</td><td className="num">{formatCount.format(item.app_count)}</td><td className="num">{formatCount.format(item.evidence_count)}</td><td className="num">{formatCount.format(item.payment_count)}</td><td className="num">{formatCount.format(item.verification_count)}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function SourceFileTrashPanel({ items, selectedIds, busy, canRestore, canPurge, onToggle, onSelectAll, onRestore, onPurge, onRefresh }: {
  items: SourceFileTrashItem[];
  selectedIds: string[];
  busy: boolean;
  canRestore: boolean;
  canPurge: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onRefresh: () => void;
}) {
  return <section className="card report source-trash-panel">
    <div className="report-header"><div><h3>Uploaded source files</h3><p>Wrong Master ID/Password and Portal TXN uploads removed from the Upload Center appear here.</p></div><div className="report-actions"><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button><button className="button" onClick={onRestore} disabled={!canRestore || !selectedIds.length || busy}><RotateCcw size={14} /> Restore selected uploads</button><button className="button danger" onClick={onPurge} disabled={!canPurge || !selectedIds.length || busy}><Trash2 size={14} /> Permanent delete uploads</button></div></div>
    <div className="notice warning trash-note"><strong>Exact-location restore:</strong> a restored Master file returns to the Master Registry and a restored Portal file returns to Portal Transaction Records. It never changes directory. The report and Android-bot scope are recalculated from all active source files.</div>
    <div className="table-wrap"><table className="data-table source-trash-table"><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Select all uploaded source Trash items" disabled={!items.length || !canRestore} checked={!!items.length && selectedIds.length === items.length} onChange={onSelectAll} /></th><th>Type</th><th>Filename</th><th>Original destination</th><th>Deleted</th><th>Protected through</th><th>Deleted by</th><th>Reason</th><th className="num">Accepted / Read</th><th className="num">Affected records</th><th>Date Range</th></tr></thead><tbody>
      {!items.length && <tr><td className="empty" colSpan={11}><FolderOpen size={25} /><strong>{busy ? "Loading uploaded-file Trashâ€¦" : "No uploaded files are in Trash"}</strong>Use the Upload Center checkboxes to move an incorrect successful upload here.</td></tr>}
      {items.map((item) => <tr key={item.file_id} className={selectedIds.includes(item.file_id) ? "selected-row" : ""}><td className="select-cell"><input type="checkbox" aria-label={`Select deleted upload ${item.filename}`} disabled={!canRestore} checked={selectedIds.includes(item.file_id)} onChange={() => onToggle(item.file_id)} /></td><td><span className="pill pending">{item.source_type === "master" ? "Master ID / Password" : "Portal TXN"}</span></td><td><strong>{item.filename}</strong><br /><span className="table-note">Batch {item.batch_id.slice(0, 8)}</span></td><td><strong>{item.data_destination}</strong></td><td>{new Date(item.deleted_at).toLocaleString()}</td><td>{new Date(item.retention_until).toLocaleDateString()}</td><td>{item.deleted_by_name ?? "â€”"}</td><td>{item.deletion_reason ?? "â€”"}</td><td className="num"><strong>{formatCount.format(item.accepted_row_count)}</strong> / {formatCount.format(item.row_count)}</td><td className="num">{formatCount.format(item.affected_record_count)}</td><td>{item.detected_start_date && item.detected_end_date ? `${item.detected_start_date} â†’ ${item.detected_end_date}` : "â€”"}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function PassportPanel({ items, busy, canUpdate, canVerify, referenceDrafts, noteDrafts, onReference, onNote, onSave, onVerify, onRefresh }: {
  items: PassportWorkflowItem[]; busy: boolean; canUpdate: boolean; canVerify: boolean;
  referenceDrafts: Record<string, string>; noteDrafts: Record<string, string>;
  onReference: (id: string, value: string) => void; onNote: (id: string, value: string) => void;
  onSave: (item: PassportWorkflowItem) => void; onVerify: (item: PassportWorkflowItem) => void; onRefresh: () => void;
}) {
  return <section className="card report workflow-panel"><div className="report-header"><div><h3>Passport workflow</h3><p>Field updates immediately create a technical verification requirement. Verification is a separate technical/admin action.</p></div><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button></div><div className="table-wrap"><table className="data-table workflow-table"><thead><tr><th>Name</th><th>User ID</th><th>Block / Group</th><th>Passport reference</th><th>Field note</th><th>Status</th><th>Action</th></tr></thead><tbody>{!items.length && <tr><td className="empty" colSpan={7}><ShieldCheck size={24} /><strong>{busy ? "Loading passport workflowâ€¦" : "No active User IDs are available."}</strong></td></tr>}{items.map((item) => <tr key={item.worker_id}><td><strong>{item.name}</strong></td><td className="id-code">{item.user_id}</td><td>{item.block ?? "â€”"}<br /><span className="table-note">{item.group_name ?? "Group not set"}</span></td><td><input className="control" disabled={!canUpdate} value={referenceDrafts[item.worker_id] ?? item.passport_reference ?? ""} onChange={(event) => onReference(item.worker_id, event.target.value)} placeholder="Passport / reference" /></td><td><input className="control" disabled={!canUpdate} value={noteDrafts[item.worker_id] ?? item.note ?? ""} onChange={(event) => onNote(item.worker_id, event.target.value)} placeholder="Field note" /></td><td><span className={`pill ${item.verification_required ? "pending" : item.passport_status === "verified" ? "ok" : "pending"}`}>{item.verification_required ? "Verification required" : item.passport_status ?? "missing"}</span>{item.request_status && <><br /><span className="table-note">Request: {item.request_status}</span></>}</td><td><div className="workflow-actions">{canUpdate && <button className="button" disabled={busy} onClick={() => onSave(item)}>Save & request verification</button>}{canVerify && item.verification_required && <button className="button primary" disabled={busy} onClick={() => onVerify(item)}>Mark verified</button>}</div></td></tr>)}</tbody></table></div></section>;
}

function AccessPanel({ items, drafts, busy, onRole, onApprove, onActive, onRefresh }: {
  items: OfficerAccessItem[]; drafts: Record<string, string>; busy: boolean;
  onRole: (id: string, role: string) => void; onApprove: (item: OfficerAccessItem) => void;
  onActive: (item: OfficerAccessItem, active: boolean) => void; onRefresh: () => void;
}) {
  return <section className="card report workflow-panel"><div className="report-header"><div><h3>Officer access approval</h3><p>New sign-ups remain pending until Admin assigns a role. Technical controls are never exposed to Field Officer accounts.</p></div><button className="button" onClick={onRefresh} disabled={busy}><RefreshCw size={14} /> Refresh</button></div><div className="table-wrap"><table className="data-table access-table"><thead><tr><th>Officer</th><th>Email</th><th>Current role</th><th>Assign role</th><th>Account</th><th>Action</th></tr></thead><tbody>{!items.length && <tr><td className="empty" colSpan={6}><UsersRound size={24} /><strong>{busy ? "Loading officer requestsâ€¦" : "No officer accounts found."}</strong></td></tr>}{items.map((item) => <tr key={item.user_id}><td><strong>{item.display_name ?? "Unnamed officer"}</strong></td><td>{item.email ?? "â€”"}</td><td><span className={`pill ${item.role === "pending" ? "pending" : "ok"}`}>{item.role.replaceAll("_", " ")}</span></td><td><select className="control" value={drafts[item.user_id] ?? (item.role === "pending" ? "field_officer" : item.role)} onChange={(event) => onRole(item.user_id, event.target.value)}><option value="field_officer">Field Officer</option><option value="technical_officer">Technical Officer</option><option value="auditor">Auditor</option><option value="admin">Admin</option></select></td><td><span className={`pill ${item.active ? "ok" : "error"}`}>{item.active ? "Active" : "Inactive"}</span></td><td><div className="workflow-actions"><button className="button primary" disabled={busy} onClick={() => onApprove(item)}>{item.role === "pending" ? "Approve access" : "Save role"}</button><button className={`button ${item.active ? "danger" : ""}`} disabled={busy} onClick={() => onActive(item, !item.active)}>{item.active ? "Deactivate" : "Reactivate"}</button></div></td></tr>)}</tbody></table></div></section>;
}

function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon: React.ReactNode }) {
  return <article className="card metric-card"><div className="metric-head"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{formatCount.format(value)}</div><div className="metric-note">{note}</div></article>;
}
