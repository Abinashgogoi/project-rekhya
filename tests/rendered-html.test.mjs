import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("bundles persistent upload feedback and exact-location restore guidance", async () => {
  const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const assetsDirectory = path.join(projectRoot, "dist", "client", "assets");
  const assetNames = await readdir(assetsDirectory);
  const dashboardAsset = assetNames.find((name) => /^dashboard-app-.*\.js$/.test(name));
  assert.ok(dashboardAsset, "dashboard client asset should exist");
  const source = await readFile(path.join(assetsDirectory, dashboardAsset), "utf8");
  assert.match(source, /Upload and processing history/);
  assert.match(source, /Review and confirm files/);
  assert.match(source, /validation failed\. Nothing from this file was added/);
  assert.match(source, /Move .*selected upload\(s\) to Trash/);
  assert.match(source, /Linked records are not moved to another table or directory/);
  assert.match(source, /Exact-location restore/);
  assert.match(source, /Uploaded source files/);
  assert.match(source, /Upload Portal Folder/);
  assert.match(source, /Pending Passwords/);
  assert.match(source, /does not try another worker/);
  assert.match(source, /Password is pending\. Add its confirmed value/);
});
