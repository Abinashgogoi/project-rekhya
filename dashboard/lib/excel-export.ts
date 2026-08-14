import ExcelJS from "exceljs";
import type { ReconciliationRow } from "../types";

export type ExportColumn =
  | "serial_no" | "name" | "user_id" | "password" | "block" | "group_name"
  | "portal_entry" | "normal_total" | "app_entry" | "high_entry"
  | "krishi_sakhi_received" | "krishi_sakhi_pending"
  | "vendor_received" | "vendor_pending" | "verification_status" | "evidence_count";

export const exportColumnLabels: Record<ExportColumn, string> = {
  serial_no: "Sl No.", name: "Name", user_id: "User ID", password: "Password",
  block: "Block", group_name: "Group", portal_entry: "Portal Entry",
  normal_total: "Normal Total", app_entry: "App Entry", high_entry: "High Entry",
  krishi_sakhi_received: "Krishi Sakhi Amount Received",
  krishi_sakhi_pending: "Krishi Sakhi Pending Amount",
  vendor_received: "Vendor Amount Received", vendor_pending: "Vendor Pending Amount",
  verification_status: "Verification Status", evidence_count: "Evidence Count",
};

export const fullExportColumns = Object.keys(exportColumnLabels) as ExportColumn[];
export const combinedExportColumns: ExportColumn[] = [
  "serial_no", "name", "user_id", "password", "portal_entry", "app_entry", "high_entry",
  "krishi_sakhi_received", "krishi_sakhi_pending", "vendor_received", "vendor_pending", "evidence_count",
];

function valueFor(row: ReconciliationRow, column: ExportColumn, credentials: Record<string, string>) {
  if (column === "password") return credentials[row.worker_id] ?? "";
  return row[column as keyof ReconciliationRow] ?? "";
}

export async function downloadReconciliationWorkbook(
  rows: ReconciliationRow[],
  startDate: string,
  endDate: string,
  columns: ExportColumn[] = combinedExportColumns,
  credentials: Record<string, string> = {},
) {
  if (!columns.length) throw new Error("Select at least one report column.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Project Rekhya";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Combined Report", {
    views: [{ state: "frozen", ySplit: 3, xSplit: Math.min(3, columns.length) }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  const endColumn = sheet.getColumn(columns.length).letter;
  sheet.mergeCells(`A1:${endColumn}1`);
  sheet.getCell("A1").value = "Project Rekhya — Combined Reconciliation Report";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123D29" } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(`A2:${endColumn}2`);
  sheet.getCell("A2").value = `Selected date range: ${startDate} to ${endDate} (inclusive)`;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF496053" } };
  sheet.addRow(columns.map((column) => exportColumnLabels[column]));
  const header = sheet.getRow(3);
  header.font = { bold: true, color: { argb: "FF173B27" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEFE3" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 34;
  for (const row of rows) sheet.addRow(columns.map((column) => valueFor(row, column, credentials)));
  const lastDataRow = Math.max(4, sheet.rowCount);
  const totalValues = columns.map((column, index) => {
    if (index === 1) return "Filtered totals";
    if (["portal_entry", "normal_total", "app_entry", "high_entry", "krishi_sakhi_received", "krishi_sakhi_pending", "vendor_received", "vendor_pending", "evidence_count"].includes(column)) {
      const letter = sheet.getColumn(index + 1).letter;
      return { formula: `SUM(${letter}4:${letter}${lastDataRow})` };
    }
    return "";
  });
  const totalRow = sheet.addRow(totalValues);
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6F2" } };
  columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = column === "name" ? 28 : column.includes("received") || column.includes("pending") ? 22 : 17;
    if (column === "user_id" || column === "password") sheetColumn.numFmt = "@";
    if (column.includes("received") || column.includes("pending")) sheetColumn.numFmt = "₹#,##0.00";
  });
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `project-rekhya-combined-${startDate}-to-${endDate}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
