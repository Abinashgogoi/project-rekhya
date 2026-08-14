import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { detectHeaderMap } from "../src/header-map";
import { inferMasterSheetContext, masterHeaders, mergeMasterRecordsByUserId, parseMasterRows } from "../src/master-parser";
import { parsePortalRows } from "../src/parser";
import { parseExcelDate } from "../src/normalize";
import { findLikelyHeaderRow, readWorkbookRows } from "../../dashboard/lib/excel-import";

test("portal parser includes only master-scoped User IDs", () => {
  const result = parsePortalRows([
    { "User ID": "0012345678", "Transaction Date": "14/08/2026", Amount: "₹100", "Policy ID": "P1" },
    { "User ID": "9999999999", "Transaction Date": "14/08/2026", Amount: 100, "Policy ID": "P2" },
  ], new Set(["0012345678"]));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].userId, "0012345678");
  assert.equal(result.ignoredOutOfScope, 1);
});

test("duplicate-looking portal records are preserved and flagged", () => {
  const rows = [
    { Mobile: "9876543210", "Txn Date": "2026-08-14", Amount: 350, "Farmer Name": "A" },
    { Mobile: "9876543210", "Txn Date": "2026-08-14", Amount: 350, "Farmer Name": "A" },
  ];
  const result = parsePortalRows(rows, new Set(["9876543210"]));
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].possibleDuplicateWithinFile, false);
  assert.equal(result.records[1].possibleDuplicateWithinFile, true);
  assert.match(result.warnings.at(-1) ?? "", /preserved/);
});

test("master parser rejects duplicate authoritative IDs", () => {
  const result = parseMasterRows([
    { Name: "One", "User ID": "9876543210", Password: "a" },
    { Name: "Two", "User ID": "9876543210", Password: "b" },
  ]);
  assert.equal(result.records.length, 1);
  assert.match(result.errors[0], /duplicates row 2/);
});

test("explicit User ID takes priority over Mobile No without ambiguity", () => {
  const detected = detectHeaderMap(["Name", "Mobile No.", "User ID", "Password"], masterHeaders, ["name", "userId"]);
  assert.equal(detected.map.userId, "User ID");
  assert.deepEqual(detected.errors, []);
});

test("master parser falls back to Mobile No and accepts a blank password", () => {
  const result = parseMasterRows([
    {
      __projectRekhyaSourceRowNumber: 7,
      Name: "Example Worker",
      "Mobile No.": "9876543210",
      "User ID": "",
      Password: "",
    },
  ], inferMasterSheetContext("Biswanath - Krishi Sakhi"));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].userId, "9876543210");
  assert.equal(result.records[0].password, "");
  assert.equal(result.records[0].block, "Biswanath");
  assert.equal(result.records[0].group, "Krishi Sakhi");
  assert.match(result.warnings[0], /Password is blank/);
});

test("blank names stay in scope when a User ID or Mobile No exists", () => {
  const result = parseMasterRows([{
    __projectRekhyaSourceRowNumber: 41,
    Name: "",
    "Mobile No.": 9365703416,
    Password: "",
  }], inferMasterSheetContext("Behali - Krishi Sakhi"));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].name, "Name pending");
  assert.equal(result.records[0].userId, "9365703416");
  assert.ok(result.warnings.some((message) => message.includes("Name is blank")));
});

test("scientific-notation IDs are expanded without changing the integer", () => {
  const result = parseMasterRows([{ Name: "Scientific ID", "Mobile No.": "9.365703416E+9", Password: "secret" }]);
  assert.equal(result.records[0].userId, "9365703416");
});

test("Latumoni reports under Biswanath Krishi Sakhi while a duplicate credential can be merged", () => {
  const krishi = parseMasterRows([{
    __projectRekhyaWorksheetName: "Biswanath - Krishi Sakhi",
    __projectRekhyaSourceRowNumber: 28,
    Name: "Latumoni Hazarika",
    "Mobile No.": "8822798435",
    Password: "",
  }], inferMasterSheetContext("Biswanath - Krishi Sakhi")).records[0];
  const vendor = parseMasterRows([{
    __projectRekhyaWorksheetName: "Vendor - Pabhoi",
    __projectRekhyaSourceRowNumber: 8,
    Name: "Latumoni Borah",
    "Mobile No.": "8822798435",
    Password: "authorized-vendor-credential",
  }], inferMasterSheetContext("Vendor - Pabhoi")).records[0];
  const merged = mergeMasterRecordsByUserId([krishi, vendor]);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.records[0].name, "Latumoni Hazarika");
  assert.equal(merged.records[0].block, "Biswanath");
  assert.equal(merged.records[0].group, "Krishi Sakhi");
  assert.equal(merged.records[0].password, "authorized-vendor-credential");
  assert.equal(merged.duplicates[0].credentialSourceSheet, "Vendor - Pabhoi");
});

test("SeSTA sheet name supplies its group and block", () => {
  const context = inferMasterSheetContext("SeSTA - Sakomatha");
  assert.equal(context.defaultGroup, "SeSTA");
  assert.equal(context.defaultBlock, "Sakomatha");
});

test("Excel serial and Indian day-first dates are parsed", () => {
  assert.equal(parseExcelDate(46248).date, "2026-08-14");
  assert.equal(parseExcelDate("31/07/2026").date, "2026-07-31");
});

test("missing required columns fail without guessing", () => {
  const result = parsePortalRows([{ Name: "A", Amount: 100 }], new Set(["1"]));
  assert.equal(result.records.length, 0);
  assert.ok(result.errors.some((message) => message.includes("Required column not found")));
});

test("master workbook header detection skips title rows", () => {
  const result = findLikelyHeaderRow([
    ["Combined Master ID Password – Sotea Krishi Sakhi"],
    ["Sl No.", "Name", "User ID", "Password", "Block", "Group"],
    ["1", "Example User", "9876543210", "secret", "Sotea", "Krishi Sakhi"],
  ], "master");
  assert.equal(result.rowNumber, 2);
  assert.equal(result.requiredMatches, 2);
});

test("portal workbook header detection skips report metadata", () => {
  const result = findLikelyHeaderRow([
    ["Portal Transaction Report"],
    ["Generated on", "15/08/2026"],
    ["Mobile No.", "Transaction Date", "Amount", "Policy ID"],
  ], "portal");
  assert.equal(result.rowNumber, 3);
  assert.equal(result.requiredMatches, 2);
});

test("workbook reader does not truncate sheets with leading blank rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Vendor - Behali");
  sheet.getRow(5).values = ["Name", "Mobile No.", "Password"];
  sheet.getRow(6).values = ["First", "9876543210", "one"];
  sheet.getRow(7).values = ["Second", "9876543211", "two"];
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], "master.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const imported = await readWorkbookRows(file, "master");
  assert.equal(imported.sheets[0].headerRowNumber, 5);
  assert.equal(imported.sheets[0].rows.length, 2);
});
