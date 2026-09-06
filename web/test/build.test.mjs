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
const jsName = files.find((f) => f.endsWith(".js") && f !== "sw.js");
const cssName = files.find((f) => f.endsWith(".css"));
const js = read(jsName);

test("the dist build is an index, two fingerprinted assets and a service worker", () => {
  assert.equal(files.length, 4);
  assert.ok(jsName && cssName && files.includes("index.html") && files.includes("sw.js"));
});

test("the service worker keeps the page's own files and nothing else", () => {
  const sw = read("sw.js");
  assert.doesNotThrow(() => new Function(sw));
  for (const f of ["/index.html", `/${cssName}`, `/${jsName}`]) assert.ok(sw.includes(`"${f}"`), f);
  assert.ok(!sw.includes("/sw.js"), "the worker must not cache itself, or it could never update");
  assert.match(sw, /url\.origin !== self\.location\.origin[^\n]*return/, "cross-origin requests pass straight through");
  assert.match(sw, /caches\.delete/, "old caches are dropped");
  assert.match(sw, /e\.request\.mode === "navigate"[\s\S]*fetch\("\/index\.html", \{ cache: "no-cache" \}\)/,
    "a reload checks for a new page before falling back offline");
  assert.match(sw, /catch\(\(\) => caches\.match\("\/index\.html"\)\)/,
    "navigation still works from the cached page when offline");
  // A different build is a different cache, so the old page is not served forever.
  assert.match(sw, /const CACHE = "biomotif-[0-9a-f]{8}"/);
});

test("the page registers the worker only when served, never as a single file", () => {
  assert.match(js, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(js, /registration\.update\(\)/, "a running page asks whether a new worker is available");
  assert.match(js, /script\[src\*="\/biomotif\."\]/);
  assert.ok(!read("index.html").includes("sw.js"), "registration is in the bundle, not inline");
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

test("a track label is never cut down to the width of its match", () => {
  /* The regression: lanes reserved only the match span, and the name was then
     sliced to fit it, so the 8-character "minus-35" over a 6-base site came out
     as "minus-". A lane must claim whichever is wider. */
  const app = readFileSync(join(ROOT, "web", "src", "app.js"), "utf8");
  const packing = app.match(/const claimed = [^;]+;/)[0];
  assert.match(packing, /Math\.max\(b,/, "the lane must reserve the label, not just the match");
  assert.match(packing, /label\.length/);
  assert.ok(!/h\.motif\.slice\(0, Math\.max\(0, b - a\)\)/.test(app),
    "the label must not be sliced to the match width");

  // A hand-typed motif is named after its own expression, which runs far past
  // the line; only library names, up to 31 characters, are short enough to use.
  assert.match(app, /function trackName/);
  assert.match(app, /your pattern/);
});

test("the track draws one row per site, not one per match", () => {
  const app = readFileSync(join(ROOT, "web", "src", "app.js"), "utf8");
  assert.match(app, /const clusters = \[\]/, "overlapping matches must be grouped");
  assert.match(app, /c\.strand === h\.strand/, "a group must not span both strands");
  assert.match(app, /\+\$\{c\.members\.length - 1\}/, "the rest of a group must be counted");
  assert.match(app, /rows are only room for names, and carry no meaning/,
    "the rows look meaningful and are not, so the legend has to say so");
});

test("bundling twice gives the same bytes", () => {
  assert.equal(bundleModules(), bundleModules());
});

after(() => {
  // Leave the temporary directory: the OS clears it, and keeping it lets a
  // failing run be inspected.
});
