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

export type PendingCredential = {
  worker_id: string;
  user_id: string;
  name: string;
  updated_at: string | null;
};

export type TrashWorker = {
  worker_id: string;
  name: string;
  user_id: string;
  block: string | null;
  group_name: string | null;
  deleted_at: string;
  retention_until: string;
  deletion_reason: string | null;
  deleted_by_name: string | null;
  portal_count: number;
  app_count: number;
  evidence_count: number;
  payment_count: number;
  verification_count: number;
};

export type ImportHistoryItem = {
  batch_id: string;
  file_id: string | null;
  source_type: "master" | "portal";
  source_label: string;
  original_filename: string | null;
  batch_status: "queued" | "processing" | "processed" | "processed_with_warnings" | "failed";
  file_status: "queued" | "processing" | "processed" | "processed_with_warnings" | "failed" | null;
  row_count: number;
  accepted_row_count: number;
  ignored_out_of_scope_count: number;
  duplicate_row_count: number;
  detected_start_date: string | null;
  detected_end_date: string | null;
  warning_count: number;
  error_message: string | null;
  uploaded_by: string;
  created_at: string;
  completed_at: string | null;
  data_destination: string;
  original_file_retained: boolean;
  file_deleted_at: string | null;
  file_retention_until: string | null;
  is_trashed: boolean;
};

export type SourceFileTrashItem = {
  file_id: string;
  batch_id: string;
  source_type: "master" | "portal";
  filename: string;
  deleted_at: string;
  retention_until: string;
  deletion_reason: string | null;
  deleted_by_name: string | null;
  row_count: number;
  accepted_row_count: number;
  affected_record_count: number;
  detected_start_date: string | null;
  detected_end_date: string | null;
  data_destination: string;
};
