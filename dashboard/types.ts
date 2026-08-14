export type OfficerRole = "admin" | "technical_officer" | "field_officer" | "auditor" | "pending";

export type ReconciliationRow = {
  worker_id: string; serial_no: number; name: string; user_id: string; block: string | null;
  group_name: "Krishi Sakhi" | "Vendor" | string | null; portal_entry: number;
  normal_total: number; high_entry: number; app_entry: number; dashboard_unpaid: number | null;
  unpaid_list_count: number | null; pre_cutoff_count: number; verification_status: string | null;
  krishi_sakhi_received: number | null; krishi_sakhi_pending: number | null;
  vendor_received: number | null; vendor_pending: number | null; evidence_count: number;
};

export type Profile = { id: string; display_name: string | null; role: OfficerRole; active: boolean };
