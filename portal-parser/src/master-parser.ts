import { detectHeaderMap, normalizeHeader } from "./header-map";
import { normalizeUserId } from "./normalize";

export const masterHeaders = {
  name: ["Name", "Worker Name", "Owner Name", "User Name"],
  userId: ["User ID", "UserID", "Use ID", "Mobile", "Mobile No", "Mobile Number", "Login ID"],
  password: ["Password", "Credential", "Pass", "Login Password"],
  block: ["Block", "Block Name"],
  group: ["Worker Type", "Group", "Worker Group", "Type"],
} as const;

export type MasterRecordCandidate = {
  sourceRowNumber: number; name: string; userId: string; password: string; block: string | null;
  group: "Krishi Sakhi" | "Vendor" | "SeSTA" | null; rawFields: Record<string, unknown>;
};

export type MasterSheetContext = {
  worksheetName?: string;
  defaultBlock?: string | null;
  defaultGroup?: "Krishi Sakhi" | "Vendor" | "SeSTA" | null;
};

export function inferMasterSheetContext(worksheetName: string): MasterSheetContext {
  const parts = worksheetName.split("-").map((part) => part.trim()).filter(Boolean);
  const lower = worksheetName.toLowerCase();
  if (lower.includes("krishi sakhi")) return { worksheetName, defaultBlock: parts[0] ?? null, defaultGroup: "Krishi Sakhi" };
  if (lower.startsWith("vendor")) return { worksheetName, defaultBlock: parts.slice(1).join(" - ") || null, defaultGroup: "Vendor" };
  if (lower.startsWith("sesta")) return { worksheetName, defaultBlock: parts.slice(1).join(" - ") || null, defaultGroup: "SeSTA" };
  return { worksheetName, defaultBlock: null, defaultGroup: null };
}

function matchingHeaders(headers: string[], aliases: readonly string[]) {
  const byNormalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return aliases.flatMap((alias) => {
    const header = byNormalized.get(normalizeHeader(alias));
    return header ? [header] : [];
  }).filter((header, index, all) => all.indexOf(header) === index);
}

export function parseMasterRows(rows: Array<Record<string, unknown>>, context: MasterSheetContext = {}) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const detected = detectHeaderMap<keyof typeof masterHeaders>(headers, masterHeaders, ["name", "userId", "password"]);
  const structuralErrors = detected.errors.filter((error) => !error.endsWith(": password"));
  if (structuralErrors.length) return { records: [] as MasterRecordCandidate[], warnings: [], errors: structuralErrors, headerMap: detected.map };
  const records: MasterRecordCandidate[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const userIdHeaders = matchingHeaders(headers, masterHeaders.userId);
  const passwordHeaders = matchingHeaders(headers, masterHeaders.password);
  rows.forEach((row, index) => {
    const rowNumber = Number(row.__projectRekhyaSourceRowNumber) || index + 2;
    const sourceName = String(row[detected.map.name!] ?? "").trim();
    const userId = userIdHeaders.map((header) => normalizeUserId(row[header])).find(Boolean) ?? "";
    const password = passwordHeaders.map((header) => String(row[header] ?? "").trim()).find(Boolean) ?? "";
    const location = context.worksheetName ? `${context.worksheetName} row ${rowNumber}` : `Row ${rowNumber}`;
    if (!userId) { errors.push(`${location}: User ID/Mobile is required; row skipped.`); return; }
    const name = sourceName || "Name pending";
    const previous = seen.get(userId);
    if (previous) { errors.push(`${location}: User ID ${userId} duplicates row ${previous}; duplicate row skipped.`); return; }
    seen.set(userId, rowNumber);
    if (!sourceName) warnings.push(`${location}: Name is blank; User ID remains in scope as 'Name pending'.`);
    if (!password) warnings.push(`${location}: Password is blank; User ID will remain in scope but Android verification will stay pending until a password is added.`);
    const block = detected.map.block ? String(row[detected.map.block] ?? "").trim() || context.defaultBlock || null : context.defaultBlock || null;
    const groupRaw = detected.map.group ? String(row[detected.map.group] ?? "").trim().toLowerCase() : "";
    let group: "Krishi Sakhi" | "Vendor" | "SeSTA" | null = context.defaultGroup || null;
    if (groupRaw) {
      if (["krishi sakhi", "krishisakhi", "farmer", "farmers"].includes(groupRaw)) group = "Krishi Sakhi";
      else if (groupRaw === "vendor") group = "Vendor";
      else if (groupRaw === "sesta") group = "SeSTA";
      else warnings.push(`Row ${rowNumber}: unrecognized group '${String(row[detected.map.group!] ?? "")}' kept blank.`);
    }
    records.push({ sourceRowNumber: rowNumber, name, userId, password, block, group, rawFields: row });
  });
  return { records, warnings, errors, headerMap: detected.map };
}
