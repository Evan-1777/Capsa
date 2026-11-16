import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(HERE, "../src/docs/fileTree.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm" });
const mod = await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);

const { buildFileTree, listDirectoryEntries, ancestorDirs, splitBreadcrumbs, parentDir } = mod;

function doc(p) {
  return {
    id: `doc_${p}`,
    workspace_id: "ws_1",
    scope: "category",
    category_id: "cat_1",
    path: p,
    char_count: 10,
    created_at: "2026-11-16T00:00:00.000000+00:00",
    updated_at: "2026-11-16T00:00:00.000000+00:00",
  };
}

// 1. Folder-first ordering + case-insensitive localeCompare + lexicographic tie-breaker + deep fileCount
const tree = buildFileTree([
  doc("zebra.md"),
  doc("Alpha.md"),
  doc("alpha.md"),
  doc("guides/overview.md"),
  doc("guides/api/v2.md"),
  doc("guides/api/v1.md"),
  doc("Docs/intro.md"),
]);

assert.deepEqual(
  tree.map((n) => `${n.kind}:${n.name}`),
  ["folder:Docs", "folder:guides", "file:Alpha.md", "file:alpha.md", "file:zebra.md"],
);
assert.equal(tree[0].fileCount, 1);
assert.equal(tree[1].fileCount, 3);
assert.deepEqual(
  tree[1].children.map((n) => `${n.kind}:${n.name}`),
  ["folder:api", "file:overview.md"],
);
assert.equal(tree[1].children[0].fileCount, 2);
assert.deepEqual(
  tree[1].children[0].children.map((n) => n.path),
  ["guides/api/v1.md", "guides/api/v2.md"],
);

// 2. listDirectoryEntries for root, nested folder, and non-existent folder
const rootEntries = listDirectoryEntries(tree, "");
assert.equal(rootEntries.exists, true);
assert.deepEqual(rootEntries.folders.map((f) => f.path), ["Docs", "guides"]);
assert.deepEqual(rootEntries.files.map((f) => f.path), ["Alpha.md", "alpha.md", "zebra.md"]);

const guidesEntries = listDirectoryEntries(tree, "guides");
assert.equal(guidesEntries.exists, true);
assert.deepEqual(guidesEntries.folders.map((f) => f.path), ["guides/api"]);
assert.deepEqual(guidesEntries.files.map((f) => f.path), ["guides/overview.md"]);

const missingEntries = listDirectoryEntries(tree, "guides/unknown");
assert.equal(missingEntries.exists, false);
assert.deepEqual(missingEntries.folders, []);
assert.deepEqual(missingEntries.files, []);

// 3. ancestorDirs
assert.deepEqual(ancestorDirs("a/b/c.md"), ["a", "a/b"]);
assert.deepEqual(ancestorDirs("readme.md"), []);
assert.deepEqual(ancestorDirs(""), []);

// 4. splitBreadcrumbs & parentDir
assert.deepEqual(splitBreadcrumbs("guides/api/spec.md"), [
  { label: "guides", path: "guides" },
  { label: "api", path: "guides/api" },
  { label: "spec.md", path: "guides/api/spec.md" },
]);
assert.deepEqual(splitBreadcrumbs(""), []);
assert.equal(parentDir("guides/api/spec.md"), "guides/api");
assert.equal(parentDir("readme.md"), "");

console.log("fileTree.check.mjs passed");
