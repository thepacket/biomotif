/* The build: both outputs assemble, carry the library, and stay within what
   the deployed content security policy allows. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { LIB_FILES, MODULES, build, bundleModules } from "../../tools/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = mkdtempSync(join(tmpdir(), "biomotif-dist-"));
build({ dist: out });
const files = readdirSync(out);
const read = (name) => readFileSync(join(out, name), "utf8");
const index = read("index.html");
const jsName = files.find((f) => f.endsWith(".js"));
const cssName = files.find((f) => f.endsWith(".css"));
const js = read(jsName);

test("the dist build is an index and two fingerprinted assets", () => {
  assert.equal(files.length, 3);
  assert.ok(jsName && cssName && files.includes("index.html"));
});

test("asset names are their own content hash", () => {
  for (const name of [jsName, cssName]) {
    const want = createHash("sha256").update(read(name)).digest("hex").slice(0, 8);
    assert.ok(name.includes(want), `${name} does not match its content`);
  }
});

test("the served page is a whole document", () => {
  for (const tag of ["<!doctype html>", '<html lang="en">', "<head>", "</head>", "<body>", "</body>", "</html>"])
    assert.ok(index.includes(tag), tag);
  assert.ok(index.indexOf("<body>") < index.indexOf("masthead"));
  assert.ok(index.indexOf("masthead") < index.indexOf("</body>"));
});

test("nothing is inlined, because the policy forbids unsafe-inline", () => {
  assert.ok(!index.includes('<script type="module">'));
  assert.ok(!index.includes("<style>"));
  assert.match(index, /<script type="module" src="\/biomotif\.[0-9a-f]{8}\.js">/);
  assert.match(index, /<link rel="stylesheet" href="\/biomotif\.[0-9a-f]{8}\.css">/);
});

test("the bundle is valid script with no leftover module syntax", () => {
  assert.doesNotThrow(() => new Function(js));
  assert.ok(!/^\s*import\s+.*from\s+"\.\//m.test(js));
  assert.ok(!/^export\s+/m.test(js));
});

test("the bundle declares each top-level name once", () => {
  const names = [...js.matchAll(/^(?:function|class|const|let)\s+(\w+)/gm)].map((m) => m[1]);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  assert.deepEqual(dupes, []);
});

test("every source module reaches the bundle", () => {
  for (const name of MODULES) assert.ok(js.includes(`==== ${name} ====`), name);
});

test("the motif library ships inside the page, verbatim", () => {
  for (const name of LIB_FILES) {
    assert.ok(js.includes(`${name}.mtf`), name);
    const source = readFileSync(join(ROOT, "library", `${name}.mtf`), "utf8");
    const marker = source.split("\n").find((l) => l.startsWith("(defmotif") || l.startsWith("(defenzyme"));
    assert.ok(js.includes(JSON.stringify(marker).slice(1, -1)), `${name} is not embedded unchanged`);
  }
});

test("the example sequences ship too, so the page works offline", () => {
  for (const key of ["operon", "plasmid", "gene", "utr3", "proteins"])
    assert.ok(js.includes(`"${key}"`), key);
});

test("the self-contained build is a fragment the Artifact viewer wraps", () => {
  const single = readFileSync(join(ROOT, "web", "biomotif.html"), "utf8");
  assert.ok(!single.includes("<!doctype html>"), "the viewer supplies the skeleton");
  assert.ok(single.includes("<title>Biomotif</title>"));
  assert.ok(single.includes("<style>") && single.includes('<script type="module">'));
  assert.ok(statSync(join(ROOT, "web", "biomotif.html")).size < 16 * 1024 * 1024);
});

test("the rail splitter is reachable without a mouse", () => {
  /* It divides the category chips from the motif list, so it has to be a real
     separator: focusable, labelled, and driven by the keyboard as well as by
     dragging. */
  const src = readFileSync(join(ROOT, "web", "src", "index.html"), "utf8");
  const splitter = src.match(/<div class="splitter"[^>]*>/s)[0];
  assert.match(splitter, /role="separator"/);
  assert.match(splitter, /aria-orientation="horizontal"/);
  assert.match(splitter, /tabindex="0"/);
  assert.match(splitter, /aria-label="[^"]+"/);
  assert.ok(src.indexOf('id="category-chips"') < src.indexOf('class="splitter"'));
  assert.ok(src.indexOf('class="splitter"') < src.indexOf('id="entry-list"'));

  const app = readFileSync(join(ROOT, "web", "src", "app.js"), "utf8");
  for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "dblclick"])
    assert.ok(app.includes(key), `the splitter should answer to ${key}`);
  assert.match(app, /setPointerCapture/, "a drag must keep the pointer even when it leaves the bar");
  assert.match(app, /localStorage/, "the split should be remembered");

  const css = readFileSync(join(ROOT, "web", "src", "app.css"), "utf8");
  assert.match(css, /\.splitter[\s\S]*?touch-action: none/, "a touch drag must not scroll the page");
  assert.match(css, /\.splitter[\s\S]*?cursor: row-resize/);
  assert.match(css, /\.splitter \{ display: none; \}/, "stacked on a narrow screen there is nothing to divide");
});

test("bundling twice gives the same bytes", () => {
  assert.equal(bundleModules(), bundleModules());
});

after(() => {
  // Leave the temporary directory: the OS clears it, and keeping it lets a
  // failing run be inspected.
});
