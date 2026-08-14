import type ExcelJS from "exceljs";
import { normalizeHeader } from "../../portal-parser/src/header-map";
import { masterHeaders } from "../../portal-parser/src/master-parser";
import { portalHeaders } from "../../portal-parser/src/parser";

export type WorkbookKind = "master" | "portal";

function definitionsFor(kind: WorkbookKind) {
  return kind === "master" ? masterHeaders : portalHeaders;
}

function requiredFieldsFor(kind: WorkbookKind) {
  return kind === "master" ? new Set(["name", "userId", "password"]) : new Set(["userId", "transactionDate"]);
}

export function scoreWorkbookHeader(headers: string[], kind: WorkbookKind) {
  const normalizedHeaders = new Set(headers.map(normalizeHeader).filter(Boolean));
  const definitions = definitionsFor(kind) as Record<string, readonly string[]>;
  const requiredFields = requiredFieldsFor(kind);
  let score = 0;
  let requiredMatches = 0;
  let totalMatches = 0;
  for (const [field, aliases] of Object.entries(definitions)) {
    if (!aliases.some((alias) => normalizedHeaders.has(normalizeHeader(alias)))) continue;
    totalMatches += 1;
    if (requiredFields.has(field)) {
      requiredMatches += 1;
      score += 100;
    } else {
      score += 10;
    }
  }
  return { score, requiredMatches, totalMatches };
}

export function findLikelyHeaderRow(rows: string[][], kind: WorkbookKind) {
  let best = { rowNumber: 1, score: -1, requiredMatches: 0, totalMatches: 0 };
  rows.forEach((headers, index) => {
    const result = scoreWorkbookHeader(headers, kind);
    if (result.score > best.score) best = { rowNumber: index + 1, ...result };
  });
  return best;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if ("richText" in value) return value.richText.map((item) => item.text).join("");
  if ("text" in value) return value.text;
  if ("hyperlink" in value) return value.text;
  return String(value);
}

export async function readWorkbookRows(file: File, kind: WorkbookKind) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(`${file.name}: only .xlsx workbooks are accepted without conversion.`);
  const bytes = await file.arrayBuffer();
  const [{ default: ExcelModule }, digest] = await Promise.all([import("exceljs"), crypto.subtle.digest("SHA-256", bytes.slice(0))]);
  const workbook = new ExcelModule.Workbook();
  await workbook.xlsx.load(bytes);
  if (!workbook.worksheets.length) throw new Error(`${file.name}: workbook contains no worksheet.`);

  let selectedWorksheet = workbook.worksheets[0];
  let selectedHeaderRow = 1;
  let selectedScore = -1;
  for (const candidateWorksheet of workbook.worksheets) {
    const scanLimit = Math.min(candidateWorksheet.actualRowCount, 30);
    const candidateRows: string[][] = [];
    for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber += 1) {
      const values = candidateWorksheet.getRow(rowNumber).values as ExcelJS.CellValue[];
      candidateRows.push(values.slice(1).map((value) => String(cellValue(value) ?? "").trim()));
    }
    const candidate = findLikelyHeaderRow(candidateRows, kind);
    if (candidate.score > selectedScore) {
      selectedWorksheet = candidateWorksheet;
      selectedHeaderRow = candidate.rowNumber;
      selectedScore = candidate.score;
    }
  }

  const worksheet = selectedWorksheet;
  const headerCells = worksheet.getRow(selectedHeaderRow).values as ExcelJS.CellValue[];
  const headers = headerCells.slice(1).map((value) => String(cellValue(value) ?? "").trim());
  if (!headers.some(Boolean)) throw new Error(`${file.name}: no usable column-heading row was found in the first 30 rows.`);
  const rows: Array<Record<string, unknown>> = [];
  for (let rowNumber = selectedHeaderRow + 1; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellValue(row.getCell(index + 1).value);
      record[header] = value;
      if (value !== null && value !== undefined && value !== "") hasValue = true;
    });
    if (hasValue) rows.push(record);
  }
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    rows,
    headers,
    worksheetName: worksheet.name,
    headerRowNumber: selectedHeaderRow,
    sha256,
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rowCount: rows.length,
  };
}
