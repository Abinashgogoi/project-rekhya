export function normalizeUserId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : "";
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\.0$/, "").replace(/\s+/g, "");
}

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function isoDate(year: number, month: number, day: number) {
  if (!validDate(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseExcelDate(value: unknown): { date: string | null; warning?: string } {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return { date: isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) };
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return { date: isoDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()) };
  }
  const raw = String(value ?? "").trim();
  if (!raw) return { date: null };
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (match) return { date: isoDate(Number(match[1]), Number(match[2]), Number(match[3])) };
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/);
  if (match) {
    const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]);
    const warning = day <= 12 && month <= 12 ? `Ambiguous date interpreted as day-first: ${raw}` : undefined;
    return { date: isoDate(year, month, day), warning };
  }
  return { date: null };
}

export function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim().replace(/[₹,\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function canonicalFingerprint(parts: Array<string | number | null | undefined>) {
  return parts.map((part) => String(part ?? "").trim().toLowerCase().replace(/\s+/g, " ")).join("\u001f");
}
