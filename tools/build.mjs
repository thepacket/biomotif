/* Assemble the web app from web/src/ and the .mtf motif library.

   Two outputs, same source:
     node tools/build.mjs                    web/biomotif.html, one self-contained file
     node tools/build.mjs --dist web/dist    index.html + fingerprinted .css/.js, for nginx

   The split build exists so the deployed page needs no 'unsafe-inline' in its
   content security policy. The .mtf files are embedded verbatim and parsed in
   the browser either way, so they stay the one source of truth: nothing here
   rewrites a motif. */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "web", "src");
const SINGLE = join(ROOT, "web", "biomotif.html");

export const LIB_FILES = ["prokaryote", "eukaryote", "plant", "rna", "protein", "tags", "restriction"];
export const MODULES = ["engine.js", "library.js", "databases.js", "app.js"];
const DEMOS = { operon: "operon.fa", plasmid: "plasmid.fa", gene: "gene.fa",
                utr3: "utr3.fa", proteins: "proteins.fa" };

const read = (...parts) => readFileSync(join(...parts), "utf8");

/** Concatenate the ES modules into one script: no bundler, no import maps.
    app.js reaches the engine through a namespace alias (`E.search`), so the
    bundle rebuilds that alias from engine.js's own export list. */
export function bundleModules() {
  const parts = [];
  for (const name of MODULES) {
    let text = read(SRC, name);
    const exported = name === "engine.js"
      ? [...text.matchAll(/^export\s+(?:class|function\*?|const|let)\s+(\w+)/gm)].map((m) => m[1])
      : null;
    text = text
      .replace(/^\s*import\s+\{[^}]*\}\s+from\s+"\.\/[^"]+";\s*$/gm, "")
      .replace(/^\s*import\s+\*\s+as\s+\w+\s+from\s+"\.\/[^"]+";\s*$/gm, "")
      .replace(/^export\s+/gm, "");
    parts.push(`/* ==== ${name} ==== */\n${text}`);
    if (exported) {
      parts.push("/* namespace alias the modules used before bundling */\n" +
                 `const E = { ${[...new Set(exported)].sort().join(", ")} };`);
    }
  }
  return parts.join("\n\n");
}

export function buildSources() {
  const library = Object.fromEntries(LIB_FILES.map((n) => [`${n}.mtf`, read(ROOT, "library", `${n}.mtf`)]));
  const demos = Object.fromEntries(Object.entries(DEMOS).map(([k, v]) => [k, read(ROOT, "data", v)]));
  const data =
    `const BIOMOTIF_LIBRARY = ${JSON.stringify(library)};\n` +
    `const BIOMOTIF_DATA = ${JSON.stringify(demos)};\n` +
    "window.BIOMOTIF_LIBRARY = BIOMOTIF_LIBRARY;\nwindow.BIOMOTIF_DATA = BIOMOTIF_DATA;\n";
  return { css: read(SRC, "app.css"), js: `${data}\n${bundleModules()}`,
           libraryCount: LIB_FILES.length, demoCount: Object.keys(DEMOS).length };
}

const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 8);

function buildSingle(css, js) {
  const html = read(SRC, "index.html")
    .replace("/*__CSS__*/", () => css)
    .replace("/*__JS__*/", () => js);
  writeFileSync(SINGLE, html);
  return SINGLE;
}

/** index.html plus fingerprinted assets, so nginx can cache them forever and
    the page can run under script-src 'self'. */
function buildDist(css, js, outDir) {
  // Empty the directory rather than replace it: removing and recreating it
  // pulls the working directory out from under anything already serving it.
  mkdirSync(outDir, { recursive: true });
  for (const stale of readdirSync(outDir)) rmSync(join(outDir, stale), { recursive: true, force: true });

  const cssName = `biomotif.${digest(css)}.css`;
  const jsName = `biomotif.${digest(js)}.js`;
  writeFileSync(join(outDir, cssName), css);
  writeFileSync(join(outDir, jsName), js);

  let html = read(SRC, "index.html")
    .replace("<style>/*__CSS__*/</style>", `<link rel="stylesheet" href="/${cssName}">`)
    .replace('<script type="module">/*__JS__*/</script>', `<script type="module" src="/${jsName}"></script>`);

  // The single-file build is a fragment the Artifact viewer wraps; a served
  // page has to carry its own document, including the head/body boundary.
  const marker = '<header class="masthead">';
  if (!html.includes(marker)) throw new Error("build: cannot find the masthead to split head from body");
  const [head, body] = html.split(marker);
  html = '<!doctype html>\n<html lang="en">\n<head>\n' +
         '<meta charset="utf-8">\n' +
         '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
         '<meta name="description" content="A workbench for DNA, RNA and protein sequence patterns, ' +
         'with 487 documented motifs.">\n' +
         '<meta name="color-scheme" content="light dark">\n' +
         head.trim() + "\n</head>\n<body>\n" + marker + body + "\n</body>\n</html>\n";
  writeFileSync(join(outDir, "index.html"), html);
  return outDir;
}

export function build({ dist = null } = {}) {
  const { css, js, libraryCount, demoCount } = buildSources();
  const single = buildSingle(css, js);
  const out = [`${single}  ${(statSync(single).size / 1024).toFixed(0)} KB  ` +
               `(${libraryCount} library files, ${demoCount} example sequences)`];
  if (dist) {
    const dir = isAbsolute(dist) ? dist : join(ROOT, dist);
    buildDist(css, js, dir);
    const total = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    out.push(`${dir}  ${(total / 1024).toFixed(0)} KB  ${readdirSync(dir).sort().join(", ")}`);
  }
  return out;
}

if (process.argv[1] && basename(process.argv[1]) === "build.mjs") {
  const i = process.argv.indexOf("--dist");
  for (const line of build({ dist: i === -1 ? null : process.argv[i + 1] })) console.log(line);
}
