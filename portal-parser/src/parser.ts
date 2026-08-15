import { detectHeaderMap } from "./header-map";
import { canonicalFingerprint, normalizeUserId, parseAmount, parseExcelDate } from "./normalize";

export const portalHeaders = {
  userId: ["User ID", "UserID", "Login ID", "Mobile", "Mobile No", "Mobile Number", "User Mobile", "Operator ID", "POS Mobile", "posMobile"],
  transactionDate: ["Transaction Date", "Txn Date", "Application Date", "Date of Application", "Created Date"],
  amount: ["Amount", "Premium Amount", "Paid Amount", "Transaction Amount", "UTR Amount", "utrAmount"],
  policyId: ["Policy ID", "Policy Number", "Policy No", "Application ID"],
  applicantName: ["Applicant Name", "Farmer Name", "Beneficiary Name", "Name", "POS Name", "posName"],
  status: ["Status", "Application Status", "Transaction Status", "Policy Status", "policyStatus"],
} as const;

export type PortalRecordCandidate = {
  sourceRowNumber: number; userId: string; transactionDate: string; amount: number | null;
  policyId: string | null; applicantName: string | null; status: string | null;
  fingerprintSource: string; possibleDuplicateWithinFile: boolean; rawFields: Record<string, unknown>;
};

export function parsePortalRows(rows: Array<Record<string, unknown>>, inScopeUserIds: ReadonlySet<string>, fallbackTransactionDate: string | null = null) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const required: Array<keyof typeof portalHeaders> = fallbackTransactionDate ? ["userId"] : ["userId", "transactionDate"];
  const detected = detectHeaderMap<keyof typeof portalHeaders>(headers, portalHeaders, required);
  if (detected.errors.length) return { records: [] as PortalRecordCandidate[], ignoredOutOfScope: 0, warnings: [], errors: detected.errors, headerMap: detected.map };
  const map = detected.map;
  const records: PortalRecordCandidate[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let ignoredOutOfScope = 0;
  const fingerprints = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const userId = normalizeUserId(row[map.userId!]);
    if (!userId) { errors.push(`Row ${rowNumber}: User ID is blank or invalid.`); return; }
    if (!inScopeUserIds.has(userId)) { ignoredOutOfScope += 1; return; }
    const parsedDate = parseExcelDate(map.transactionDate ? row[map.transactionDate] : fallbackTransactionDate);
    if (!parsedDate.date) { errors.push(`Row ${rowNumber}: transaction date is blank or invalid.`); return; }
    if (parsedDate.warning) warnings.push(`Row ${rowNumber}: ${parsedDate.warning}`);
    const amount = map.amount ? parseAmount(row[map.amount]) : null;
    if (map.amount && row[map.amount] !== null && row[map.amount] !== "" && amount === null) errors.push(`Row ${rowNumber}: amount is invalid.`);
    const policyId = map.policyId ? String(row[map.policyId] ?? "").trim() || null : null;
    const applicantName = map.applicantName ? String(row[map.applicantName] ?? "").trim() || null : null;
    const status = map.status ? String(row[map.status] ?? "").trim() || null : null;
    const fingerprintSource = canonicalFingerprint([userId, parsedDate.date, amount, policyId, applicantName, status]);
    const seen = fingerprints.get(fingerprintSource) ?? 0;
    fingerprints.set(fingerprintSource, seen + 1);
    records.push({ sourceRowNumber: rowNumber, userId, transactionDate: parsedDate.date, amount, policyId, applicantName, status, fingerprintSource, possibleDuplicateWithinFile: seen > 0, rawFields: row });
  });
  const repeated = [...fingerprints.values()].filter((count) => count > 1).length;
  if (repeated) warnings.push(`${repeated} duplicate-looking record group(s) preserved for manual review; no record was deleted.`);
  return { records, ignoredOutOfScope, warnings, errors, headerMap: map };
}
