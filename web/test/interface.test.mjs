/* The interface, driven through a small DOM of its own (dom.mjs). What these
   can check is structure, text and the requests the page makes; there is no
   layout here, so nothing about appearance. Every test shares one page, in
   the order written, the way a reader would use it. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { installPage } from "./dom.mjs";
import { LIB_FILES } from "../../tools/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------ the network */

const requests = [];
const reply = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, headers: { get: () => null },
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

// A stand-in for the HBB transcript with 200 bases of upstream: the real TATA
// box, CATAAAAG, sits at 169, which is 32 before the start at 201.
const filler = (n) => "GCGCCGGCCGCGGC".repeat(Math.ceil(n / 14)).slice(0, n);
const HBB = `>ENST00000335295.4 chromosome:GRCh38:11:5225264:5227071:-1\n${filler(168)}CATAAAAG${filler(124)}\n`;

async function fakeFetch(url) {
  requests.push(String(url));
  const u = String(url);
  if (u.includes("openrouter.ai")) return reply({}, { ok: false, status: 503 });
  if (u.includes("/sequence/id/ENST00000335295")) return reply(HBB);
  if (u.includes("/lookup/id/ENST00000335295")) {
    return reply({ id: "ENST00000335295", display_name: "HBB-201", seq_region_name: "11", start: 5225464, end: 5227071,
                   strand: -1, assembly_name: "GRCh38", description: "haemoglobin subunit beta [Source:HGNC Symbol;Acc:HGNC:4827]" });
  }
  if (u.includes("/lookup/symbol/homo_sapein/")) return reply({ error: "Can not find internal name for species" }, { ok: false, status: 400 });
  if (u.includes("/info/assembly/homo_sapein")) return reply({ error: "Can not find internal name for species 'homo_sapein'" });
  if (u.includes("/info/species")) {
    return reply({ species: [{ name: "homo_sapiens", display_name: "Human", common_name: "Human", assembly: "GRCh38", aliases: ["human"] },
                             { name: "mus_musculus", display_name: "Mouse", common_name: "Mouse", assembly: "GRCm39", aliases: [] }] });
  }
  return reply("", { ok: false, status: 404 });
}

/* --------------------------------------------------------------- the page */

const { document, location, clipboard, Event } = installPage(read("web", "src", "index.html"), { fetch: fakeFetch });
window.BIOMOTIF_LIBRARY = Object.fromEntries(LIB_FILES.map((n) => [`${n}.mtf`, read("library", `${n}.mtf`)]));
window.BIOMOTIF_DATA = Object.fromEntries(["operon", "plasmid", "gene", "utr3", "proteins"].map((k) => [k, read("data", `${k}.fa`)]));
await import("../src/app.js");

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
/** The text a sighted reader sees: the tooltips' definitions are left out,
    since they are only shown on hover or focus. */
const seen = (node) => node.nodeType === 3 ? node.data
  : node.classList?.contains("term-def") ? "" : node.childNodes.map(seen).join("");
const text = (s) => seen($(s)).replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 2000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error(`gave up waiting for ${what}`); await sleep(10); }
}
const type = (sel, value) => { $(sel).value = value; $(sel).dispatchEvent(new Event("input", { bubbles: true })); };

test("the page opens working: the operon loaded and a real promoter found", () => {
  assert.equal(text("#lib-stat"), "523");
  assert.equal(text("#rail-count"), "523 of 523");
  assert.equal($$("#entry-list .entry").length, 523);
  assert.equal(text("#seq-stat-label"), "synthetic_operon");
  assert.deepEqual([...$$("#summary .summary-item")].map((i) => i.textContent).slice(0, 3), ["1 match", "1 forward", "0 reverse"]);
  assert.equal($("#motif-status").className, "motif-status ok");
  assert.equal(location.hash, "#motif=sigma70-promoter&demo=operon", "the address bar describes the screen");
  assert.ok($$("table.hits tr[data-hit]").length === 1);
  assert.match(text("#results-body"), /box35=TTGACA/);
});

test("the library filters as you type, and an entry loads by click", () => {
  type("#library-search", "tata");
  const n = $$("#entry-list .entry").length;
  assert.ok(n > 0 && n < 100, `${n} entries match tata`);
  assert.equal(text("#rail-count"), `${n} of 523`);
  const entry = [...$$("#entry-list .entry")].find((e) => e.querySelector(".entry-name").textContent === "tata-box");
  entry.click();
  assert.equal($("#motif-source").value, '(iupac "TATAWAWR")');
  // The list is rebuilt on selection, so the marked entry is a new element.
  assert.equal($("#entry-list .entry[aria-current=true] .entry-name").textContent, "tata-box");
  assert.equal(location.hash, "#motif=tata-box&demo=operon", "a library motif is linked by name");
  assert.match(text("#doc-card"), /Bucher 1990/);
  type("#library-search", "");
  assert.equal($$("#entry-list .entry").length, 523);
});

test("the explanation defines its words, and the verdict is computed", () => {
  const terms = [...$$("#explain .term")].map((t) => t.firstChild.textContent.toLowerCase());
  assert.ok(terms.includes("strands") || terms.includes("strand"), terms.join(","));
  assert.ok($$("#explain .term-def[role=tooltip]").length === terms.length);
  assert.ok($("#explain section.noise, #explain section.strong, #explain section.some, #explain section.none"),
    "the findings carry a verdict tone");
});

test("a row in the table finds its match in the picture, and back", () => {
  $('[data-demo="plasmid"]').click();
  assert.equal(text("#seq-stat-label"), "pSYN1");
  assert.match(text("#summary"), /^1 match/);
  assert.equal($$(".track mark").length, 1);
  $('table.hits tr[data-hit="0"]').click();
  assert.equal($$(".track mark.flash").length, 1);
  assert.ok($('table.hits tr[data-hit="0"]').classList.contains("picked"));
  $(".track mark").click();
  assert.equal($$("table.hits tr.picked").length, 1);
  assert.equal($("table.hits tr[data-hit]").tabIndex, 0, "rows are reachable from the keyboard");
});

test("a digest draws the gel", () => {
  $("#circular").checked = true;
  $("#digest-btn").click();
  const svg = $("svg.gel");
  assert.ok(svg, "a gel is drawn");
  assert.match(svg.getAttribute("aria-label"), /^A drawn gel: /);
  const labels = [...svg.querySelectorAll(".gel-label")].map((t) => t.textContent);
  assert.equal(labels[0], "ladder");
  assert.equal(labels.length, 4, "each enzyme alone, then both");
  assert.match(text("#results-note"), /fragments \d+/);
  assert.match(text("#explain"), /drawn as they would look on a gel/);
  $("#circular").checked = false;
});

test("export puts the matches on the clipboard as TSV", async () => {
  $("#export-btn").click();
  await until(() => clipboard.text, "the clipboard");
  assert.match(clipboard.text, /^sequence\tmotif\tstart\tend\tlength\tstrand\tmatch\tdetail\n/);
});

test("the HBB promoter button fetches the gene with its upstream, and says which build", async () => {
  requests.length = 0;
  [...$$("[data-fetch]")].find((b) => b.textContent === "HBB promoter").click();
  await until(() => $("#fetch-status").className.includes("good"), "the fetch");
  assert.ok(requests.some((u) => /sequence\/id\/ENST00000335295.*expand_5prime=200/.test(u)), requests.join("\n"));
  assert.ok(!requests.some((u) => u.includes("openrouter")), "nothing else was contacted");
  assert.equal(text("#seq-stat-label"), "ENST00000335295.4");
  const status = text("#fetch-status");
  assert.match(status, /position 201 is the start/);
  assert.match(status, /GRCh38/);
  assert.match(text("#explain"), /GRCh38 assembly of the genome/);
  assert.match(text("#explain"), /haemoglobin subunit beta/);
  assert.equal($("#fetch-upstream").value, "200");
  assert.match(location.hash, /fetch=ENST00000335295/);
  assert.match(location.hash, /upstream=200/);
});

test("a misspelt species is reported as one, with the name meant", async () => {
  $("#fetch-species").value = "homo_sapein";
  $("#fetch-query").value = "HBB";
  $("#fetch-btn").click();
  await until(() => $("#fetch-status").className.includes("bad"), "the failure");
  assert.equal(text("#fetch-status"), "Ensembl has no species called homo_sapein. Did you mean homo_sapiens?");
  $("#fetch-species").value = "homo_sapiens";
});

test("Copy link puts the address on the clipboard", async () => {
  clipboard.text = "";
  $("#link-btn").click();
  await until(() => clipboard.text, "the clipboard");
  assert.ok(clipboard.text.startsWith("http://localhost:8080/#"), clipboard.text);
  assert.equal(clipboard.text, location.href);
  assert.ok(!/homo_sapiens/.test(clipboard.text), "the default species is left out");
});

test("a walkthrough runs step by step, and each step is a link", async () => {
  $("#lesson-pick button").click();
  assert.ok($("#lesson-panel").open);
  assert.equal(text("#lesson-next"), "Start");
  $("#lesson-next").click();
  await until(() => $("#motif-source").value.includes("box35"), "step one");
  assert.equal(text("#seq-stat-label"), "synthetic_operon", "the lesson loaded its own sequence");
  assert.equal(text("#lesson-step-title"), "Find the promoter");
  $("#lesson-next").click();
  await until(() => $("#motif-source").value.includes("AGGAGG") || $("#motif-source").value.includes("shine"), "step two");
  assert.match(text("#summary"), /^3 matches/);
  assert.equal(location.hash, "#motif=shine-dalgarno&demo=operon&lesson=operon/2");
  assert.equal($$("#lesson-steps .done").length, 1);
  assert.equal($("#lesson-steps button[aria-current=step]").textContent, "Find where each gene starts being translated");
  $("#lesson-close").click();
  assert.ok($("#lesson-body").hidden);
  assert.ok(!location.hash.includes("lesson="));
});

test("a link opens what it describes", async () => {
  location.hash = "#motif=tata-box&demo=gene&circular=1";
  window.dispatchEvent(new Event("hashchange"));
  assert.equal(text("#seq-stat-label"), "SYNGENE1");
  assert.equal($("#motif-source").value, '(iupac "TATAWAWR")');
  assert.ok($("#circular").checked);
  assert.match(text("#summary"), /^2 matches/);
});

test("a pasted sequence stays out of the link", () => {
  $("#seq-input").value = ">mine\nTTGACAGCGAGCAGCATTTACTGTATAATCCCC\n";
  $("#seq-load").click();
  assert.equal(text("#seq-stat-label"), "mine");
  assert.equal(location.hash, "#motif=tata-box&circular=true");
});
