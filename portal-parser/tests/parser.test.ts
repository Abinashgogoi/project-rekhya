import assert from "node:assert/strict";
import test from "node:test";
import { parseMasterRows } from "../src/master-parser";
import { parsePortalRows } from "../src/parser";
import { parseExcelDate } from "../src/normalize";
import { findLikelyHeaderRow } from "../../dashboard/lib/excel-import";

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
  assert.equal(result.requiredMatches, 3);
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
