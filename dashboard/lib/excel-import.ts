import type ExcelJS from "exceljs";

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if ("richText" in value) return value.richText.map((item) => item.text).join("");
  if ("text" in value) return value.text;
  if ("hyperlink" in value) return value.text;
  return String(value);
}

export async function readWorkbookRows(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(`${file.name}: only .xlsx workbooks are accepted without conversion.`);
  const bytes = await file.arrayBuffer();
  const [{ default: ExcelModule }, digest] = await Promise.all([import("exceljs"), crypto.subtle.digest("SHA-256", bytes.slice(0))]);
  const workbook = new ExcelModule.Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`${file.name}: workbook contains no worksheet.`);
  const headerCells = worksheet.getRow(1).values as ExcelJS.CellValue[];
  const headers = headerCells.slice(1).map((value) => String(cellValue(value) ?? "").trim());
  if (!headers.some(Boolean)) throw new Error(`${file.name}: first row contains no column headings.`);
  const rows: Array<Record<string, unknown>> = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
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
    sha256,
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rowCount: rows.length,
  };
}
