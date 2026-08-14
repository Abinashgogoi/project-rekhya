import { detectHeaderMap } from "./header-map";
import { normalizeUserId } from "./normalize";

export const masterHeaders = {
  name: ["Name", "Worker Name", "Owner Name", "User Name"],
  userId: ["User ID", "UserID", "Mobile", "Mobile No", "Mobile Number", "Login ID"],
  password: ["Password", "Credential", "Pass", "Login Password"],
  block: ["Block", "Block Name"],
  group: ["Worker Type", "Group", "Worker Group", "Type"],
} as const;

export type MasterRecordCandidate = {
  sourceRowNumber: number; name: string; userId: string; password: string; block: string | null;
  group: "Krishi Sakhi" | "Vendor" | null; rawFields: Record<string, unknown>;
};

export function parseMasterRows(rows: Array<Record<string, unknown>>) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const detected = detectHeaderMap(headers, masterHeaders, ["name", "userId", "password"]);
  if (detected.errors.length) return { records: [] as MasterRecordCandidate[], warnings: [], errors: detected.errors, headerMap: detected.map };
  const records: MasterRecordCandidate[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = String(row[detected.map.name!] ?? "").trim();
    const userId = normalizeUserId(row[detected.map.userId!]);
    const password = String(row[detected.map.password!] ?? "");
    if (!name || !userId || !password) { errors.push(`Row ${rowNumber}: Name, User ID and Password are required.`); return; }
    const previous = seen.get(userId);
    if (previous) { errors.push(`Row ${rowNumber}: User ID ${userId} duplicates row ${previous}.`); return; }
    seen.set(userId, rowNumber);
    const block = detected.map.block ? String(row[detected.map.block] ?? "").trim() || null : null;
    const groupRaw = detected.map.group ? String(row[detected.map.group] ?? "").trim().toLowerCase() : "";
    let group: "Krishi Sakhi" | "Vendor" | null = null;
    if (groupRaw) {
      if (["krishi sakhi", "krishisakhi", "farmer", "farmers"].includes(groupRaw)) group = "Krishi Sakhi";
      else if (groupRaw === "vendor") group = "Vendor";
      else warnings.push(`Row ${rowNumber}: unrecognized group '${String(row[detected.map.group!] ?? "")}' kept blank.`);
    }
    records.push({ sourceRowNumber: rowNumber, name, userId, password, block, group, rawFields: row });
  });
  return { records, warnings, errors, headerMap: detected.map };
}
