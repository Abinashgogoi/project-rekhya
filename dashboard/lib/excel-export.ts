import ExcelJS from "exceljs";
import type { ReconciliationRow } from "../types";

export async function downloadReconciliationWorkbook(rows: ReconciliationRow[], startDate: string, endDate: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Project Rekhya";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Combined Report", {
    views: [{ state: "frozen", ySplit: 3, xSplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  sheet.mergeCells("A1:M1");
  sheet.getCell("A1").value = "Project Rekhya — Combined Reconciliation Report";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123D29" } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 30;
  sheet.mergeCells("A2:M2");
  sheet.getCell("A2").value = `Selected date range: ${startDate} to ${endDate} (inclusive)`;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF496053" } };
  sheet.addRow(["Sl No.", "Name", "User ID", "Block", "Group", "Portal Entry", "App Entry", "High Entry", "Krishi Sakhi Received", "Krishi Sakhi Pending", "Vendor Received", "Vendor Pending", "Evidence Count"]);
  const header = sheet.getRow(3);
  header.font = { bold: true, color: { argb: "FF173B27" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEFE3" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 34;
  for (const row of rows) sheet.addRow([row.serial_no, row.name, row.user_id, row.block ?? "", row.group_name ?? "", row.portal_entry, row.app_entry, row.high_entry, row.krishi_sakhi_received, row.krishi_sakhi_pending, row.vendor_received, row.vendor_pending, row.evidence_count]);
  const lastDataRow = Math.max(4, sheet.rowCount);
  const totalRow = sheet.addRow(["", "Filtered totals", "", "", "", { formula: `SUM(F4:F${lastDataRow})` }, { formula: `SUM(G4:G${lastDataRow})` }, { formula: `SUM(H4:H${lastDataRow})` }, { formula: `SUM(I4:I${lastDataRow})` }, { formula: `SUM(J4:J${lastDataRow})` }, { formula: `SUM(K4:K${lastDataRow})` }, { formula: `SUM(L4:L${lastDataRow})` }, { formula: `SUM(M4:M${lastDataRow})` }]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6F2" } };
  sheet.columns = [11, 28, 18, 18, 18, 14, 14, 14, 20, 20, 18, 18, 16].map((width) => ({ width }));
  sheet.getColumn(3).numFmt = "@";
  for (let column = 6; column <= 13; column += 1) sheet.getColumn(column).numFmt = "#,##0";
  for (let column = 9; column <= 12; column += 1) sheet.getColumn(column).numFmt = "₹#,##0.00";
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `project-rekhya-combined-${startDate}-to-${endDate}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
