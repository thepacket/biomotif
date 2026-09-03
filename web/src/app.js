/* Biomotif workbench: library browser, motif editor, assistant, results. */

import * as E from "./engine.js";
import {
  Registry, loadLibrarySource, buildMotif, digest, gcContent, meltingTemp, orfs, translate,
} from "./library.js";
import { SOURCES, detectSource, fetchSequence, searchDatabase } from "./databases.js";
import {
  DEFAULT_MODEL, SUGGESTED_MODELS, fetchModels, getApiKey, getModel, resolveProvider,
  setApiKey, setModel,
} from "./assistant.js";
import { PROMPT_COUNT, PROMPT_GROUPS } from "./prompts.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  registry: new Registry(),
  records: [],
  active: 0,
  motifSource: "",
  matcher: null,
  hits: [],
  selectedEntry: null,
  filterCategory: null,
  filterText: "",
  lastRunLabel: "",
  provider: null,     // the assistant, once one is available
  asking: null,       // AbortController for the request in flight
  fetching: null,     // AbortController for the request in flight
};

/* ------------------------------------------------------------------ library */

function loadLibrary() {
  const problems = [];
  for (const [name, text] of Object.entries(window.BIOMOTIF_LIBRARY)) {
    problems.push(...loadLibrarySource(name, text, state.registry));
  }
  if (problems.length) console.warn("library problems:", problems);
}

function renderRail() {
  const list = $("#entry-list");
  list.textContent = "";
  const alphabet = currentRecord() ? (currentRecord().type === "protein" ? "protein" : null) : null;
  let entries = state.registry.find({ category: state.filterCategory, text: state.filterText });
  // Show motifs that fit the loaded sequence's alphabet first: a protein motif
  // is not wrong to look at while a plasmid is loaded, just not applicable.
  if (alphabet === "protein") {
    entries.sort((a, b) => (a.alphabet === "protein" ? 0 : 1) - (b.alphabet === "protein" ? 0 : 1));
  } else if (currentRecord()) {
    entries.sort((a, b) => (a.alphabet !== "protein" ? 0 : 1) - (b.alphabet !== "protein" ? 0 : 1));
  }
  $("#rail-count").textContent = `${entries.length} of ${state.registry.size}`;
  const frag = document.createDocumentFragment();
  for (const e of entries.slice(0, 400)) {
    const b = el("button", "entry");
    b.type = "button";
    if (state.selectedEntry === e.name) b.setAttribute("aria-current", "true");
    b.appendChild(el("div", "entry-name", e.name));
    const meta = el("div", "entry-meta");
    meta.appendChild(el("span", "entry-cat", `${e.category} · ${e.alphabet}`));
    if (!e.scan) meta.appendChild(el("span", "tag-template", "template"));
    b.appendChild(meta);
    if (e.doc) b.appendChild(el("div", "entry-doc", e.doc));
    b.addEventListener("click", () => useEntry(e));
    frag.appendChild(b);
  }
  if (!entries.length) frag.appendChild(el("div", "empty", "No motif matches that search."));
  else if (entries.length > 400) frag.appendChild(el("div", "empty", `${entries.length - 400} more — narrow the search.`));
  list.appendChild(frag);
}

function renderCategories() {
  const box = $("#category-chips");
  box.textContent = "";
  const all = el("button", "chip", "all");
  all.type = "button";
  all.setAttribute("aria-pressed", String(state.filterCategory === null));
  all.addEventListener("click", () => { state.filterCategory = null; renderCategories(); renderRail(); });
  box.appendChild(all);
  const counts = new Map();
  for (const e of state.registry.all()) counts.set(e.category, (counts.get(e.category) || 0) + 1);
  for (const cat of [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))) {
    const c = el("button", "chip", `${cat} ${counts.get(cat)}`);
    c.type = "button";
    c.setAttribute("aria-pressed", String(state.filterCategory === cat));
    c.addEventListener("click", () => {
      state.filterCategory = state.filterCategory === cat ? null : cat;
      renderCategories(); renderRail();
    });
    box.appendChild(c);
  }
}

function useEntry(entry) {
  state.selectedEntry = entry.name;
  setMotifSource(entry.pattern, entry.name);
  showDoc(entry);
  renderRail();
  run();
}

function showDoc(entry) {
  const card = $("#doc-card");
  card.textContent = "";
  if (!entry) { card.hidden = true; return; }
  card.hidden = false;
  card.appendChild(el("h3", null, entry.name));
  if (entry.doc) card.appendChild(el("p", null, entry.doc));
  const bits = [`${entry.category} · ${entry.alphabet}`];
  if (entry.example) bits.push(`example ${entry.example}`);
  if (entry.meta) bits.push(`cut ${entry.meta.cutTop}/${entry.meta.cutBottom}`);
  if (!entry.scan) bits.push("template: matches almost anywhere, so Scan skips it");
  bits.push(`defined in ${entry.source}`);
  if (entry.ref) bits.push(entry.ref);
  card.appendChild(el("div", "ref", bits.join(" — ")));
}

/* ----------------------------------------------------------------- motif */

function setMotifSource(text, label = "") {
  state.motifSource = text;
  $("#motif-source").value = text;
  state.lastRunLabel = label;
  validate();
}

function validate() {
  const status = $("#motif-status");
  const src = $("#motif-source").value.trim();
  state.motifSource = src;
  if (!src) {
    status.textContent = "";
    state.matcher = null;
    $("#run-btn").disabled = true;
    return;
  }
  if (!E.balanced(src)) {
    status.className = "motif-status bad";
    status.textContent = "unbalanced parentheses";
    state.matcher = null;
    $("#run-btn").disabled = true;
    return;
  }
  try {
    const form = E.parse(src);
    const matcher = buildMotif(form, state.registry);
    // Some errors only surface when a motif is used — fuzzy, for one, checks
    // that its inner motif has a fixed width the first time it matches. Try one
    // step against a stub so the status line is honest before anything is run.
    const rec = currentRecord();
    const kind = rec ? rec.type : "dna";
    const stub = kind === "protein" ? "MKWVTFISLLLLNGSAYSRG" : "ACGTACGTACGTACGTACGT";
    matcher.matchAt({ seq: stub, kind, nuc: kind !== "protein" }, 0, {}).next();
    state.matcher = matcher;
    status.className = "motif-status ok";
    status.textContent = "reads as " + state.matcher.describe();
    $("#run-btn").disabled = false;
  } catch (err) {
    status.className = "motif-status bad";
    status.textContent = err.message;
    state.matcher = null;
    $("#run-btn").disabled = true;
  }
}

/* -------------------------------------------------------------- sequences */

const currentRecord = () => state.records[state.active] || null;

function loadSequences(text, type = null) {
  const records = E.parseFasta(text, type);
  if (!records.length) return false;
  state.records = records;
  state.active = 0;
  renderRecords();
  renderRail();
  return true;
}

function renderRecords() {
  const box = $("#record-list");
  box.textContent = "";
  state.records.forEach((r, i) => {
    const b = el("button", "record-btn");
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === state.active));
    b.appendChild(el("b", null, r.name));
    const unit = r.type === "protein" ? "aa" : "bp";
    const extra = r.type === "protein" ? "" : ` · GC ${(gcContent(r.seq) * 100).toFixed(1)}%`;
    b.appendChild(el("span", null, `${r.length.toLocaleString()} ${unit} · ${r.type}${extra}`));
    b.addEventListener("click", () => { state.active = i; renderRecords(); renderRail(); run(); });
    box.appendChild(b);
  });
  const rec = currentRecord();
  $("#seq-stat").textContent = rec ? `${rec.length.toLocaleString()} ${rec.type === "protein" ? "aa" : "bp"}` : "—";
  $("#seq-stat-label").textContent = rec ? rec.name : "no sequence";
  renderExamples();
}

/* -------------------------------------------------------------- retrieval */

function fetchStatus(text, kind = "busy") {
  const box = $("#fetch-status");
  box.hidden = !text;
  box.className = `fetch-status ${kind}`;
  box.textContent = text;
}

function fetchBusy(busy) {
  $("#fetch-btn").disabled = busy;
  $("#search-btn").disabled = busy;
}

/** One request at a time: a second one cancels the first rather than racing it. */
function beginRequest() {
  state.fetching?.abort();
  state.fetching = new AbortController();
  fetchBusy(true);
  return state.fetching.signal;
}

function describeError(err) {
  if (err.name === "AbortError") return null;
  return err.message || "Something went wrong reaching the database.";
}

async function doFetch(query, { source, upstream, species, title } = {}) {
  const q = (query ?? $("#fetch-query").value).trim();
  if (!q) { fetchStatus("Enter an accession, a gene symbol or a region.", "bad"); return; }
  const chosen = source ?? $("#fetch-source").value;
  const up = upstream ?? (Number($("#fetch-upstream").value) || 0);
  const sp = species ?? ($("#fetch-species").value.trim() || "homo_sapiens");
  const signal = beginRequest();
  const where = chosen === "auto" ? (detectSource(q) ? SOURCES[detectSource(q)].label : "a database") : SOURCES[chosen].label;
  fetchStatus(`Fetching ${q} from ${where}…`);
  $("#fetch-results").hidden = true;
  try {
    const { records, info, source: used } = await fetchSequence(q, { source: chosen, upstream: up, species: sp, signal });
    state.records = records;
    state.active = 0;
    renderRecords();
    renderRail();
    const bases = records.reduce((n, r) => n + r.seq.length, 0);
    const bits = [`${SOURCES[used].label}: ${records.length} record${records.length === 1 ? "" : "s"}, ${bases.toLocaleString()} ${records[0].type === "protein" ? "residues" : "bases"}`];
    if (up > 0 && used === "ensembl") bits.push(`the first ${up.toLocaleString()} bases are upstream, so position ${up + 1} is the start`);
    if (info?.display_name) bits.push(`${info.display_name} on ${info.seq_region_name}:${info.start}-${info.end} strand ${info.strand > 0 ? "+" : "−"} (${info.assembly_name})`);
    if (title) bits.push(title);
    fetchStatus(bits.join(" · "), "good");
    run();
  } catch (err) {
    const msg = describeError(err);
    if (msg) fetchStatus(msg, "bad");
  } finally {
    fetchBusy(false);
  }
}

async function doSearch() {
  const term = $("#fetch-query").value.trim();
  if (!term) { fetchStatus("Type a name to search for, such as \"hemoglobin beta human\".", "bad"); return; }
  const picked = $("#fetch-source").value;
  const source = picked === "uniprot" ? "uniprot" : "ncbi";
  const signal = beginRequest();
  fetchStatus(`Searching ${SOURCES[source].label} for “${term}”…`);
  $("#fetch-results").hidden = true;
  try {
    const results = await searchDatabase(term, { source, signal });
    if (!results.length) {
      fetchStatus(`${SOURCES[source].label} has nothing matching “${term}”.`, "bad");
      return;
    }
    fetchStatus(`${results.length} result${results.length === 1 ? "" : "s"} from ${SOURCES[source].label}. Pick one to load it.`, "good");
    renderSearchResults(results);
  } catch (err) {
    const msg = describeError(err);
    if (msg) fetchStatus(msg, "bad");
  } finally {
    fetchBusy(false);
  }
}

function renderSearchResults(results) {
  const box = $("#fetch-results");
  box.textContent = "";
  box.hidden = false;
  for (const r of results) {
    const b = el("button", "hit-row");
    b.type = "button";
    const head = el("b", null, r.label);
    b.appendChild(head);
    const unit = r.moltype === "protein" ? "aa" : "bp";
    const meta = [r.length ? `${r.length.toLocaleString()} ${unit}` : null, r.organism, r.moltype]
      .filter(Boolean).join(" · ");
    if (meta) b.appendChild(el("em", null, "  " + meta));
    if (r.description) b.appendChild(el("span", null, r.description));
    b.addEventListener("click", () => {
      $("#fetch-query").value = r.id;
      $("#fetch-results").hidden = true;
      doFetch(r.id, { source: r.source, upstream: 0 });
    });
    box.appendChild(b);
  }
}

/* ------------------------------------------------------------------- runs */

function run() {
  const rec = currentRecord();
  if (!rec || !state.matcher) return;
  let hits;
  try {
    hits = E.search(state.matcher, rec, { name: state.lastRunLabel || undefined });
  } catch (err) {
    renderResults([], err.message);
    return;
  }
  state.hits = hits;
  renderResults(hits);
}

function scanAll() {
  const rec = currentRecord();
  if (!rec) return;
  const wantProtein = rec.type === "protein";
  const out = [];
  for (const e of state.registry.all()) {
    if (!e.scan) continue;
    if ((e.alphabet === "protein") !== wantProtein) continue;
    if (e.category === "restriction") continue;
    try { out.push(...E.search(e.matcher, rec)); } catch { /* a motif that cannot run here */ }
  }
  state.hits = E.collapse(out);
  state.lastRunLabel = "";
  renderResults(state.hits, null, `Scanned ${rec.name} with every applicable library motif. Templates and restriction sites are excluded; use the library list for those.`);
}

function runDigest() {
  const rec = currentRecord();
  if (!rec || rec.type === "protein") return;
  const enzymes = state.registry.all().filter((e) => e.meta);
  const circular = $("#circular").checked;
  const counts = enzymes.map((e) => {
    const n = E.search(e.matcher, rec).length;
    return { entry: e, n };
  }).filter((x) => x.n > 0);
  const unique = counts.filter((x) => x.n === 1).map((x) => x.entry);
  const chosen = unique.slice(0, 2);
  if (chosen.length < 2) {
    counts.sort((a, b) => a.n - b.n);
    for (const c of counts) if (chosen.length < 2 && !chosen.includes(c.entry)) chosen.push(c.entry);
  }
  if (!chosen.length) { renderResults([], "No restriction site from the library cuts this sequence."); return; }
  const d = digest(rec, chosen.map((e) => ({ name: e.name, info: e.meta })), { circular });
  const hits = [];
  for (const s of d.sites) {
    hits.push(new E.Match(s.enzyme, s.start, s.end, s.strand, rec.seq.slice(s.start, s.end),
      { cut: [s.cutTop, s.cutTop, String(s.cutTop)] }, rec, null, {}));
  }
  state.hits = hits;
  state.lastRunLabel = "";
  const sizes = d.fragments.map((f) => f[2]).sort((a, b) => b - a);
  renderResults(hits, null,
    `${chosen.map((e) => e.name).join(" + ")} on ${circular ? "circular" : "linear"} ${rec.name}: ` +
    `${d.cuts.length} cut${d.cuts.length === 1 ? "" : "s"}, fragments ${sizes.join(", ")} bp. ` +
    `Single cutters available: ${unique.length ? unique.slice(0, 14).map((e) => e.name).join(", ") : "none"}.`);
}

function runOrfs() {
  const rec = currentRecord();
  if (!rec || rec.type === "protein") return;
  const found = orfs(rec.seq, { minLength: 150, table: 11 });
  state.hits = found.map((o) => new E.Match("orf", o.start, o.end, o.strand,
    rec.seq.slice(o.start, o.end), {}, rec, null,
    { frame: o.frame, residues: o.protein.length, protein: o.protein.slice(0, 30) + (o.protein.length > 30 ? "…" : "") }));
  state.lastRunLabel = "";
  renderResults(state.hits, null, `Open reading frames of at least 50 codons, bacterial code (table 11), both strands.`);
}

/* ---------------------------------------------------------------- results */

function renderResults(hits, error = null, note = null) {
  const summary = $("#summary");
  const body = $("#results-body");
  summary.textContent = "";
  body.textContent = "";
  $("#results-note").textContent = note || "";
  $("#results-note").hidden = !note;
  $("#export-btn").disabled = !hits.length;

  if (error) {
    body.appendChild(el("div", "empty", error));
    return;
  }
  const rec = currentRecord();
  const fwd = hits.filter((h) => h.strand === "+").length;
  const items = [
    [`${hits.length}`, hits.length === 1 ? "match" : "matches"],
    [`${fwd}`, "forward"],
    [`${hits.length - fwd}`, "reverse"],
  ];
  if (rec && hits.length) {
    const per = (hits.length / rec.length) * 1000;
    items.push([per.toFixed(2), rec.type === "protein" ? "per 1000 aa" : "per kb"]);
  }
  for (const [n, label] of items) {
    const s = el("div", "summary-item");
    s.appendChild(el("b", null, n));
    s.appendChild(document.createTextNode(" " + label));
    summary.appendChild(s);
  }

  if (!hits.length) {
    body.appendChild(el("div", "empty",
      "Nothing found. Try a looser motif: wrap it in (fuzzy 1 …), widen a gap, or pick a shorter consensus."));
    return;
  }
  body.appendChild(buildTrack(rec, hits));
  body.appendChild(buildTable(hits));
}

const BASE_CLASS = { A: "A", C: "C", G: "G", T: "T", U: "T" };

function buildTrack(rec, hits) {
  const wrap = el("div", "panel");
  const head = el("header");
  head.appendChild(el("h2", null, "Sequence"));
  const legend = el("span", "hint", "matched bases highlighted · A C G T coloured");
  legend.classList.add("spacer");
  head.appendChild(legend);
  wrap.appendChild(head);

  const bodyBox = el("div", "panel-body");
  const pre = el("div", "track scroller");
  const width = 60;
  const covered = new Uint8Array(rec.length);
  for (const h of hits) for (let i = h.start; i < h.end && i < rec.length; i++) covered[i] = 1;

  const lines = [];
  const interesting = [];
  for (let start = 0; start < rec.length; start += width) {
    let any = false;
    for (let i = start; i < Math.min(start + width, rec.length); i++) if (covered[i]) { any = true; break; }
    interesting.push(any);
  }
  const dense = rec.length > 6000;
  let skipped = 0;
  for (let block = 0, start = 0; start < rec.length; block++, start += width) {
    if (dense && !interesting[block] && !(block > 0 && interesting[block - 1]) && !(interesting[block + 1])) {
      skipped++;
      continue;
    }
    if (skipped) {
      lines.push(`<div class="skip">      ⋯ ${skipped * width} bases with no match ⋯</div>`);
      skipped = 0;
    }
    const end = Math.min(start + width, rec.length);
    let row = `<span class="gutter">${String(rec.offset + start + 1).padStart(8)} </span>`;
    let open = false;
    for (let i = start; i < end; i++) {
      const c = rec.seq[i].toUpperCase();
      if (covered[i] && !open) { row += "<mark>"; open = true; }
      if (!covered[i] && open) { row += "</mark>"; open = false; }
      const cls = BASE_CLASS[c];
      row += cls ? `<span class="${cls}">${c}</span>` : c;
    }
    if (open) row += "</mark>";
    lines.push(`<div>${row}</div>`);

    // A label lane under the block, one row per non-overlapping set of hits.
    const here = hits.filter((h) => h.start < end && h.end > start);
    const lanes = [];
    for (const h of here.sort((a, b) => a.start - b.start)) {
      const a = Math.max(h.start - start, 0), b = Math.min(h.end - start, width);
      const lane = lanes.find((L) => L.every(([la, lb]) => b <= la || lb <= a));
      if (lane) lane.push([a, b, h]); else lanes.push([[a, b, h]]);
    }
    for (const lane of lanes.slice(0, 3)) {
      const buf = Array(width).fill(" ");
      for (const [a, b, h] of lane) {
        const mark = h.strand === "-" ? "<" : ">";
        for (let k = a; k < b; k++) buf[k] = mark;
        const label = h.motif.slice(0, Math.max(0, b - a));
        for (let k = 0; k < label.length; k++) buf[a + k] = label[k];
      }
      lines.push(`<div class="lane">         ${escapeHtml(buf.join("").replace(/\s+$/, ""))}</div>`);
    }
  }
  if (skipped) lines.push(`<div class="skip">      ⋯ ${skipped * width} bases with no match ⋯</div>`);
  pre.innerHTML = lines.join("");
  bodyBox.appendChild(pre);
  wrap.appendChild(bodyBox);
  return wrap;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTable(hits) {
  const wrap = el("div", "panel");
  const head = el("header");
  head.appendChild(el("h2", null, "Matches"));
  wrap.appendChild(head);
  const scroll = el("div", "scroller");
  const t = el("table", "hits");
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Motif", "Start", "End", "Len", "Strand", "Sequence", "Detail"]) hr.appendChild(el("th", null, h));
  thead.appendChild(hr);
  t.appendChild(thead);
  const tb = el("tbody");
  for (const h of hits.slice(0, 500)) {
    const tr = el("tr");
    tr.appendChild(el("td", "name", h.motif));
    tr.appendChild(el("td", "num", String(h.absStart + 1)));
    tr.appendChild(el("td", "num", String(h.absEnd)));
    tr.appendChild(el("td", "num", String(h.length)));
    const st = el("td");
    const badge = el("span", `strand ${h.strand === "+" ? "fwd" : "rev"}`, h.strand);
    st.appendChild(badge);
    tr.appendChild(st);
    tr.appendChild(el("td", "mono", h.seq.length > 60 ? h.seq.slice(0, 28) + "…" + h.seq.slice(-28) : h.seq));
    const detail = el("td", "binds");
    const parts = [];
    if (h.score !== null && h.score !== undefined) parts.push(["score", String(h.score)]);
    for (const [k, v] of Object.entries(h.extra)) parts.push([k, String(v)]);
    for (const [k, v] of Object.entries(h.bindings)) parts.push([k, v[2]]);
    parts.forEach(([k, v], i) => {
      if (i) detail.appendChild(document.createTextNode("  "));
      detail.appendChild(el("b", null, k + "="));
      detail.appendChild(document.createTextNode(v));
    });
    tr.appendChild(detail);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  scroll.appendChild(t);
  wrap.appendChild(scroll);
  if (hits.length > 500) {
    const more = el("div", "panel-body");
    more.appendChild(el("div", "panel-note", `Showing the first 500 of ${hits.length}. Export to see them all.`));
    wrap.appendChild(more);
  }
  return wrap;
}

/* -------------------------------------------------------------- assistant */

const GRAMMAR = `
"GAATTC"                     a literal, matched on both strands; U and T are the same base
(iupac "TATAWAWR")           a nucleotide consensus with IUPAC ambiguity codes
(prosite "N-{P}-[ST]-{P}")   a protein pattern: x is any residue, [..] a choice, {..} an exclusion,
                             (n) or (n,m) a repeat count, < anchors the N-terminus, > the C-terminus
(seq A B C)                  the parts one after another
(alt A B C)                  any one of them
(gap 15 19)                  15 to 19 of any character
(run "CT" 8 20)              a run of 8 to 20 characters from that set
(repeat M 3 6)               M repeated 3 to 6 times; the max may be omitted for unbounded
(opt M)                      M or nothing
(any-of "AT") (none-of "P")  one character in, or not in, a set
(named 'label M)             M, captured under that label and reported with the match
(fuzzy 2 M)                  a FIXED-WIDTH M with up to 2 mismatches
(edit 1 "GAATTC")            up to 1 substitution, insertion or deletion
(hairpin (stem 5 10) (loop 3 8) :wobble #t)
                             a stem-loop; the engine checks the stem really base-pairs
(pwm-from-sites '("TATAAA" "TATAAT") :threshold 0.8)   a position weight matrix
at-start  at-end             sequence boundaries
`.trim();

function assistantPrompt(request, rec) {
  const kind = rec ? rec.type : "dna";
  const names = state.registry.all().map((e) => e.name);
  return `You write motifs in the Biomotif pattern language. Answer only with JSON.

THE LANGUAGE
${GRAMMAR}

RULES
- A motif is ONE s-expression. No variables, no lambdas, no arithmetic.
- fuzzy needs a fixed width: (fuzzy 1 (iupac "TTGACA")) is fine, (fuzzy 1 (repeat "A" 1 5)) is not.
- Use (named 'x ...) for parts the biologist will want reported separately.
- Prefer (iupac ...) over a bare literal whenever the site is degenerate.
- For protein patterns always use (prosite "..."), never iupac.
- The sequence loaded now is ${kind}. Write a motif for that alphabet.
- "library" is for the case where ONE existing motif answers the whole request on its
  own. If the request adds anything that motif does not have — a second element, a
  distance, a bound, a mismatch budget, a narrowed alternative — leave "library" empty
  and write the composition. Most requests are compositions; naming a near relative
  there is wrong and unhelpful.

LIBRARY NAMES YOU MAY REFER TO
${names.join(" ")}

REQUEST
${request}

Reply with JSON only, no prose around it:
{"motif": "<the s-expression>",
 "name": "<a short kebab-case name>",
 "explanation": "<two sentences: what it matches and why it is written that way>",
 "caveats": "<one sentence on how often this would match by chance, or empty>",
 "library": "<a library motif that alone answers the whole request, otherwise empty>"}`;
}

async function ask() {
  const request = $("#ask-input").value.trim();
  if (!request || !state.provider) return;
  if (state.provider.needsKey && !getApiKey()) {
    $("#assistant-settings").open = true;
    $("#or-key").focus();
    return;
  }
  const out = $("#assistant-out");
  const btn = $("#ask-btn");
  state.asking?.abort();
  state.asking = new AbortController();
  btn.disabled = true;
  out.hidden = false;
  out.textContent = "";
  out.appendChild(el("h3", null, "Thinking…"));
  try {
    const { data, meta } = await state.provider.ask(assistantPrompt(request, currentRecord()),
      { signal: state.asking.signal });
    out.textContent = "";
    out.appendChild(el("h3", null, data.name || "Motif"));
    if (data.explanation) out.appendChild(el("p", null, data.explanation));
    if (data.caveats) out.appendChild(el("div", "warn-line", data.caveats));
    if (data.library && state.registry.get(data.library)) {
      const line = el("div", "hint");
      line.appendChild(document.createTextNode("The library already has this: "));
      const link = el("button", "btn btn-sm", data.library);
      link.type = "button";
      link.addEventListener("click", () => useEntry(state.registry.get(data.library)));
      line.appendChild(link);
      out.appendChild(line);
    }
    if (meta.promptTokens || meta.completionTokens) {
      const cost = meta.cost != null ? `  ·  $${meta.cost.toFixed(4)}` : "";
      out.appendChild(el("div", "cost",
        `${meta.model}  ·  ${meta.promptTokens.toLocaleString()} in  ·  ` +
        `${meta.completionTokens.toLocaleString()} out${cost}`));
    }
    if (data.motif) {
      setMotifSource(data.motif, data.name || "assistant");
      state.selectedEntry = null;
      showDoc(null);
      renderRail();
      if (state.matcher) run();
    }
  } catch (err) {
    if (err.name === "AbortError") { out.hidden = true; return; }
    out.textContent = "";
    out.appendChild(el("h3", null, "Could not write that motif"));
    const codes = {
      not_granted: "You declined to let this page use Claude. Reload to be asked again, or write the motif yourself.",
      rate_limited: "Too many requests just now. Wait a moment and try again.",
    };
    out.appendChild(el("p", null, codes[err.code] || err.message ||
      "Something went wrong. Try rephrasing the request."));
  } finally {
    btn.disabled = false;
  }
}

/* ----------------------------------------------------------------- export */

function hitsToTsv() {
  const rows = [["sequence", "motif", "start", "end", "length", "strand", "match", "detail"].join("\t")];
  for (const h of state.hits) {
    const detail = [
      ...(h.score != null ? [`score=${h.score}`] : []),
      ...Object.entries(h.extra).map(([k, v]) => `${k}=${v}`),
      ...Object.entries(h.bindings).map(([k, v]) => `${k}=${v[2]}`),
    ].join(";");
    rows.push([h.record ? h.record.name : "", h.motif, h.absStart + 1, h.absEnd, h.length, h.strand, h.seq, detail].join("\t"));
  }
  return rows.join("\n") + "\n";
}

/* ------------------------------------------------------------------- boot */

const DEMO_LABELS = {
  plasmid: "pSYN1 plasmid",
  operon: "bacterial operon",
  gene: "spliced gene",
  utr3: "3' UTRs",
  proteins: "proteins",
};

function wire() {
  $("#library-search").addEventListener("input", (e) => {
    state.filterText = e.target.value.trim();
    renderRail();
  });
  $("#motif-source").addEventListener("input", () => {
    // An edited motif is no longer the library entry it started from, so it
    // must not keep that entry's name on the results.
    state.selectedEntry = null;
    state.lastRunLabel = "";
    validate();
  });
  $("#run-btn").addEventListener("click", run);
  $("#scan-btn").addEventListener("click", scanAll);
  $("#digest-btn").addEventListener("click", runDigest);
  $("#orf-btn").addEventListener("click", runOrfs);
  $("#ask-btn").addEventListener("click", ask);
  $("#ask-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
  });
  $("#seq-load").addEventListener("click", () => {
    const text = $("#seq-input").value.trim();
    if (!text) return;
    if (loadSequences(text)) { $("#seq-input").value = ""; run(); }
  });
  $("#seq-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (loadSequences(await file.text())) run();
    e.target.value = "";
  });
  $("#fetch-btn").addEventListener("click", () => doFetch());
  $("#search-btn").addEventListener("click", doSearch);
  $("#fetch-query").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doFetch(); }
  });
  for (const btn of document.querySelectorAll("[data-fetch]")) {
    btn.addEventListener("click", () => {
      $("#fetch-query").value = btn.dataset.fetch;
      const up = Number(btn.dataset.upstream) || 0;
      $("#fetch-upstream").value = String(up);
      if (btn.dataset.source) $("#fetch-source").value = btn.dataset.source;
      doFetch(btn.dataset.fetch, { source: btn.dataset.source, upstream: up, title: btn.dataset.title });
    });
  }
  for (const btn of document.querySelectorAll("[data-demo]")) {
    btn.addEventListener("click", () => {
      const key = btn.dataset.demo;
      state.fetching?.abort();
      loadSequences(window.BIOMOTIF_DATA[key], key === "proteins" ? "protein" : null);
      fetchStatus("");
      run();
    });
  }
  $("#export-btn").addEventListener("click", async () => {
    const downloads = await window.claude?.use?.("downloads");
    const name = `biomotif-${(currentRecord()?.name || "hits").replace(/\W+/g, "-")}.tsv`;
    if (downloads) {
      try { await downloads.save({ filename: name, data: hitsToTsv() }); return; } catch { /* fall through */ }
    }
    await navigator.clipboard?.writeText(hitsToTsv());
    $("#results-note").hidden = false;
    $("#results-note").textContent = "Results copied to the clipboard as tab-separated text.";
  });
}

function renderExamples() {
  const box = $("#examples");
  box.textContent = "";
  $("#prompt-count").textContent = `Example requests (${PROMPT_COUNT})`;
  const kind = currentRecord()?.type ?? "dna";
  // Put the groups that fit the loaded sequence first; the rest still show,
  // because picking an example is often how you decide what to load next.
  const fits = (g) => (g.alphabet === "protein") === (kind === "protein");
  const groups = [...PROMPT_GROUPS].sort((a, b) => Number(fits(b)) - Number(fits(a)));
  for (const g of groups) {
    const section = el("div", "example-group");
    const h = el("h4", null, g.group + " ");
    if (!fits(g)) h.appendChild(el("em", null, `· ${g.alphabet}`));
    section.appendChild(h);
    const list = el("ul");
    for (const prompt of g.prompts) {
      const li = el("li");
      const b = el("button", null, prompt);
      b.type = "button";
      b.addEventListener("click", () => {
        $("#ask-input").value = prompt;
        $("#prompt-examples").open = false;
        if (state.provider?.needsKey && !getApiKey()) {
          // The request is ready; it just has nowhere to go yet.
          $("#assistant-settings").open = true;
          $("#or-key").focus();
        } else {
          $("#ask-input").focus();
        }
      });
      li.appendChild(b);
      list.appendChild(li);
    }
    section.appendChild(list);
    box.appendChild(section);
  }
}

function assistantReady() {
  const ready = state.provider && (!state.provider.needsKey || !!getApiKey());
  $("#composer").hidden = !ready;
  $("#assistant-note").hidden = ready;
  $("#ask-btn").textContent = ready ? "Write it" : "Add a key";
}

async function initAssistant() {
  state.provider = await resolveProvider();
  const settings = $("#assistant-settings");
  // The settings only exist to hold a key, so the artifact never shows them.
  settings.hidden = !state.provider?.needsKey;
  if (state.provider?.needsKey) {
    $("#or-key").value = getApiKey();
    $("#or-model").value = getModel();
    const fillModels = (ids) => {
      const list = $("#or-models");
      list.textContent = "";
      for (const id of ids) {
        const option = el("option");
        option.value = id;
        list.appendChild(option);
      }
    };
    fillModels(SUGGESTED_MODELS);
    $("#or-key").addEventListener("input", (e) => { setApiKey(e.target.value); assistantReady(); });
    $("#or-model").addEventListener("input", (e) => setModel(e.target.value || DEFAULT_MODEL));
    // The full catalogue is a nicety, so it loads quietly and late.
    fetchModels().then((ids) => { if (ids.length) fillModels(ids); });
  }
  assistantReady();
}

function boot() {
  loadLibrary();
  $("#lib-stat").textContent = String(state.registry.size);
  $("#cat-stat").textContent = String(state.registry.categories().length);
  renderCategories();
  renderExamples();
  wire();
  // Open in a working state: a plasmid loaded and a real promoter already found.
  loadSequences(window.BIOMOTIF_DATA.operon);
  const entry = state.registry.get("sigma70-promoter");
  state.selectedEntry = entry.name;
  setMotifSource(entry.pattern, entry.name);
  showDoc(entry);
  renderRail();
  run();
  initAssistant();
}

boot();
