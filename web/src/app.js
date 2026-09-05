/* Biomotif workbench: library browser, motif editor, assistant, results. */

import * as E from "./engine.js";
import {
  Registry, loadLibrarySource, buildMotif, digest, gcContent, meltingTemp, orfs, translate,
} from "./library.js";
import { SOURCES, detectSource, ensemblSpecies, fetchSequence, searchDatabase } from "./databases.js";
import {
  DEFAULT_MODEL, SUGGESTED_MODELS, fetchModels, getApiKey, getModel, resolveProvider,
  setApiKey, setModel,
} from "./assistant.js";
import { PROMPT_COUNT, PROMPT_GROUPS } from "./prompts.js";
import { describeState, rnaMotifs } from "./describe.js";
import { decodeState, encodeState, shareUrl } from "./share.js";
import { gelSvg } from "./gel.js";
import { annotate } from "./glossary.js";

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
  railObserver: null, // watches the rail so the splitter's bounds stay true
  mode: "motif",      // which button produced what is on screen
  origin: null,       // a sentence about where the sequence came from
  search: null,       // the last search, so more of it can be asked for
  came: null,         // how the sequence was obtained, when that can go in a link
  gel: null,          // the lanes of the last digest, for the drawn gel
};

/* ------------------------------------------------------------------ library */

function loadLibrary() {
  const problems = [];
  for (const [name, text] of Object.entries(window.BIOMOTIF_LIBRARY)) {
    problems.push(...loadLibrarySource(name, text, state.registry));
  }
  if (problems.length) console.warn("library problems:", problems);
  // The explanation pane needs to know which elements act on RNA, so it can say
  // what finding one in DNA does and does not mean.
  for (const e of state.registry.all()) if (e.alphabet === "rna") rnaMotifs.add(e.name);
}

function renderRail() {
  const list = $("#entry-list");
  list.textContent = "";
  // Name order, throughout. Floating the motifs that suit the loaded sequence
  // to the top made the list quicker to skim but impossible to look something
  // up in, since where a name sat depended on what was loaded at the time.
  // What that ordering knew is said in place instead, by marking the entries
  // the loaded sequence cannot be matched against. They stay where they are,
  // and stay clickable: reading one is not the same as running it.
  const entries = state.registry.find({ category: state.filterCategory, text: state.filterText });
  const wants = currentRecord() ? (currentRecord().type === "protein" ? "protein" : "nucleotide") : null;
  $("#rail-count").textContent = `${entries.length} of ${state.registry.size}`;
  const frag = document.createDocumentFragment();
  /* Every match is listed. A cap made sense while the order was arbitrary, but
     against a sorted list it silently removes the tail of the alphabet -- the
     TATA box among it -- from a list whose whole point is that you can find a
     name in it. 523 buttons cost about a millisecond to build. */
  for (const e of entries) {
    const b = el("button", "entry");
    b.type = "button";
    if (state.selectedEntry === e.name) b.setAttribute("aria-current", "true");
    b.appendChild(el("div", "entry-name", e.name));
    const meta = el("div", "entry-meta");
    meta.appendChild(el("span", "entry-cat", `${e.category} · ${e.alphabet}`));
    // An RNA motif is applicable to DNA: the engine reads U and T as the same
    // base. Only the protein/nucleotide divide is a real one.
    const needs = wants && (e.alphabet === "protein") !== (wants === "protein")
      ? (e.alphabet === "protein" ? "needs a protein" : "needs DNA or RNA")
      : null;
    if (needs) {
      b.classList.add("off");
      // Said in words as well as in colour, and on hover for the whole row.
      meta.appendChild(el("span", "tag-off", needs));
      b.title = `${e.name} is written for ${e.alphabet === "protein" ? "proteins" : "nucleotide sequences"}, ` +
                `so it cannot match the ${currentRecord().type === "protein" ? "protein" : "DNA or RNA"} loaded now.`;
    }
    if (!e.scan) meta.appendChild(el("span", "tag-template", "template"));
    b.appendChild(meta);
    if (e.doc) b.appendChild(el("div", "entry-doc", e.doc));
    b.addEventListener("click", () => useEntry(e));
    frag.appendChild(b);
  }
  if (!entries.length) frag.appendChild(el("div", "empty", "No motif matches that search."));
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
  setMotifSource(entry.editorSource ?? entry.pattern, entry.name);
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

/** What the motif will do, said in terms the source does not already say.

    The canonical form is only worth showing when it differs from what was
    typed — an alias like `tata-box` or `(opt m)` expands, but anything already
    canonical, which includes every library pattern, would just be echoed back. */
function summarise(matcher, source, kind) {
  const bits = [];
  const canonical = matcher.describe();
  const tidy = (t) => t.replace(/\s+/g, " ").trim();
  if (tidy(canonical) !== tidy(source)) bits.push("reads as " + canonical);

  const [lo, hi] = matcher.span();
  const unit = kind === "protein" ? "residues" : "bases";
  if (hi === Infinity) bits.push(`matches ${lo} ${unit} or more`);
  else if (lo === hi) bits.push(`matches ${lo} ${unit}`);
  else bits.push(`matches ${lo} to ${hi} ${unit}`);

  bits.push(kind === "protein" ? "one strand" : "both strands");
  return bits.join("  ·  ");
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
    status.textContent = summarise(matcher, src, kind);
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

const n2 = (x) => x.toLocaleString();

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
    // Too long for the chip, but worth having on hover when several are loaded.
    if (r.description) b.title = r.description;
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
    const { records, info, source: used, assembly } = await fetchSequence(q, { source: chosen, upstream: up, species: sp, signal });
    state.records = records;
    state.active = 0;
    state.came = { fetch: q, source: chosen, species: sp, upstream: up };
    state.origin = `It was fetched from ${SOURCES[used].label}${up > 0 && used === "ensembl"
      ? `, with the first ${n2(up)} bases being the region upstream of the gene, so position ${n2(up + 1)} is where the gene itself starts`
      : ""}.`;
    // Positions get copied into other tools, where they mean nothing without
    // the build they were read from: the same gene sits elsewhere on GRCh37.
    if (assembly) state.origin += ` Its coordinates are on the ${assembly} assembly of the genome, which is the build to quote alongside any position you copy from here.`;
    renderRecords();
    renderRail();
    const bases = records.reduce((n, r) => n + r.seq.length, 0);
    const bits = [`${SOURCES[used].label}: ${records.length} record${records.length === 1 ? "" : "s"}, ${bases.toLocaleString()} ${records[0].type === "protein" ? "residues" : "bases"}`];
    if (up > 0 && used === "ensembl") bits.push(`the first ${up.toLocaleString()} bases are upstream, so position ${up + 1} is the start`);
    if (info?.display_name) bits.push(`${info.display_name} on ${info.seq_region_name}:${info.start}-${info.end} strand ${info.strand > 0 ? "+" : "−"} (${info.assembly_name})`);
    else if (assembly) bits.push(`coordinates on ${assembly}`);
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

const plural2 = (c, one, many) => `${n2(c)} ${c === 1 ? one : many}`;

async function doSearch(limit = 20) {
  const term = $("#fetch-query").value.trim();
  if (!term) { fetchStatus("Type a name to search for, such as \"hemoglobin beta human\".", "bad"); return; }
  const picked = $("#fetch-source").value;
  const source = picked === "uniprot" ? "uniprot" : "ncbi";
  const signal = beginRequest();
  fetchStatus(`Searching ${SOURCES[source].label} for “${term}”…`);
  $("#fetch-results").hidden = true;
  try {
    const { results, total } = await searchDatabase(term, { source, signal, limit });
    if (!results.length) {
      fetchStatus(`${SOURCES[source].label} has nothing matching “${term}”.`, "bad");
      return;
    }
    state.search = { term, source, limit, total };
    const more = total > results.length;
    fetchStatus(
      (more
        ? `Showing ${n2(results.length)} of ${n2(total)} matches in ${SOURCES[source].label}. ` +
          "Pick one to load it, ask for more, or narrow the search — the first few are rarely the ones you want out of this many."
        : `${plural2(results.length, "match", "matches")} in ${SOURCES[source].label}. Pick one to load it.`),
      more ? "busy" : "good");
    renderSearchResults(results, more);
  } catch (err) {
    const msg = describeError(err);
    if (msg) fetchStatus(msg, "bad");
  } finally {
    fetchBusy(false);
  }
}

function renderSearchResults(results, more = false) {
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
  /* A footer pinned to the bottom of the list. On a machine with overlay
     scrollbars — the macOS default — a list that overflows looks exactly like
     one that ends, so this says how much is out of sight. It doubles as the
     control for asking the database for more. */
  const shown = results.length;
  const footer = el("button", "hit-row more");
  footer.type = "button";
  const next = Math.min(shown + 40, 200);
  if (more && next > shown) {
    footer.appendChild(el("b", null, `Show ${next - shown} more`));
    footer.appendChild(el("span", null,
      `${n2(state.search.total - shown)} further matches. Past a couple of hundred it is quicker to narrow the ` +
      "search than to scroll: add the organism, or use a field like HBB[gene] AND human[orgn]."));
    footer.addEventListener("click", () => doSearch(next));
  } else {
    footer.appendChild(el("b", null, `${plural2(shown, "result", "results")}`));
    footer.appendChild(el("span", null, more
      ? "That is as many as this will list. Narrow the search to see different ones."
      : "That is all of them."));
    footer.disabled = true;
  }
  box.appendChild(footer);

  /* Reading scrollHeight flushes layout, so this is accurate straight away.
     A requestAnimationFrame here would be worse than useless: its callback
     never runs while the tab is hidden, so the list would render unmarked. */
  const hiddenPx = box.scrollHeight - box.clientHeight;
  box.classList.toggle("overflowing", hiddenPx > 8);
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
  state.mode = "motif";
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
  state.mode = "scan";
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
  // The gel a lab would run to check this: each enzyme alone, then both.
  const lane = (entries) => ({
    label: entries.map((e) => e.name).join(" + "),
    sizes: digest(rec, entries.map((e) => ({ name: e.name, info: e.meta })), { circular }).fragments.map((f) => f[2]),
  });
  state.gel = chosen.length > 1 ? [...chosen.map((e) => lane([e])), lane(chosen)] : [lane(chosen)];
  const hits = [];
  for (const s of d.sites) {
    hits.push(new E.Match(s.enzyme, s.start, s.end, s.strand, rec.seq.slice(s.start, s.end),
      { cut: [s.cutTop, s.cutTop, String(s.cutTop)] }, rec, null, {}));
  }
  state.hits = hits;
  state.lastRunLabel = "";
  state.mode = "digest";
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
  state.mode = "orfs";
  renderResults(state.hits, null, `Open reading frames of at least 50 codons, bacterial code (table 11), both strands.`);
}

/* ---------------------------------------------------------------- explain */

/** A very small subset of Markdown: **bold** only, escaped first. */
function prose(text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderExplain() {
  const box = $("#explain");
  box.textContent = "";
  let sections;
  try {
    sections = describeState({
      record: currentRecord(),
      entry: state.selectedEntry ? state.registry.get(state.selectedEntry) : null,
      matcher: state.matcher,
      source: state.motifSource,
      hits: state.hits,
      mode: state.mode,
      origin: state.origin,
    });
  } catch (err) {
    // An explanation is a convenience; it must never take the results down.
    box.appendChild(el("p", null, "No description available for this."));
    console.warn("describe failed", err);
    return;
  }
  for (const s of sections) {
    const section = el("section", [s.tone, s.muted ? "muted" : ""].filter(Boolean).join(" "));
    section.appendChild(el("h3", null, s.heading));
    const p = el("p");
    // The words the pane cannot avoid — strand, consensus — get a definition
    // on hover or focus, at their first appearance in each passage.
    p.innerHTML = annotate(prose(s.body));
    section.appendChild(p);
    box.appendChild(section);
  }
}

/* ------------------------------------------------------------------ links */

/** What a link to the current screen would say. */
function linkState() {
  // A library motif goes by name, which is shorter and reads as what it is.
  return { motif: state.selectedEntry || state.motifSource, ...(state.came ?? {}),
           circular: $("#circular").checked, lesson: state.lesson || "" };
}

/** Keep the address bar describing what is on screen, so the link is always
    there to copy. replaceState, not the hash: the page must not scroll, and
    every edit must not become a history entry. */
function syncLink() {
  try {
    const frag = encodeState(linkState());
    const want = frag ? `#${frag}` : "";
    if ((location.hash || "") === want) return;
    history.replaceState(null, "", `${location.pathname}${location.search}${want}`);
  } catch { /* an embedded viewer with no address to write to */ }
}

/** Open the page as a link describes it. Returns false when the link said
    nothing, so the caller can open the page its usual way instead. */
function applyLink(link) {
  if (!link) return false;
  if (link.motif) {
    const entry = state.registry.get(link.motif);
    state.selectedEntry = entry ? entry.name : null;
    setMotifSource(entry ? (entry.editorSource ?? entry.pattern) : link.motif, entry ? entry.name : "");
    showDoc(entry ?? null);
  }
  $("#circular").checked = !!link.circular;
  if (link.demo && window.BIOMOTIF_DATA[link.demo]) {
    document.querySelector(`[data-demo="${link.demo}"]`)?.click();
  } else if (link.fetch) {
    $("#fetch-query").value = link.fetch;
    if (link.source) $("#fetch-source").value = link.source;
    $("#fetch-species").value = link.species || "homo_sapiens";
    $("#fetch-upstream").value = String(link.upstream || 0);
    doFetch(link.fetch, { source: link.source || "auto", species: link.species, upstream: link.upstream || 0 });
  } else if (!currentRecord()) {
    return false;
  }
  if (link.lesson) openLesson(link.lesson);
  return true;
}

function openLesson() { /* the walkthrough, when there is one */ }

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
    renderExplain();
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

  renderExplain();
  syncLink();
  if (!hits.length) {
    body.appendChild(el("div", "empty",
      "Nothing found. Try a looser motif: wrap it in (fuzzy 1 …), widen a gap, or pick a shorter consensus."));
    return;
  }
  if (state.mode === "digest" && state.gel) body.appendChild(buildGel(state.gel));
  body.appendChild(buildTrack(rec, hits));
  body.appendChild(buildTable(hits));
}

function buildGel(lanes) {
  const wrap = el("div", "panel");
  const head = el("header");
  head.appendChild(el("h2", null, "Gel"));
  const legend = el("span", "hint spacer",
    "how the pieces would look on an agarose gel · bigger pieces run less far · a longer piece carries more stain, so it is darker");
  head.appendChild(legend);
  wrap.appendChild(head);
  const bodyBox = el("div", "panel-body gel-box scroller");
  bodyBox.innerHTML = gelSvg(lanes);
  wrap.appendChild(bodyBox);
  return wrap;
}

const BASE_CLASS = { A: "A", C: "C", G: "G", T: "T", U: "T" };
/* Enough rows to read a promoter's parts at once, few enough that a
   whole-library scan does not bury the sequence. */
const MAX_LANES = 5;

/** A match is named after its motif, but a hand-typed motif has no name — its
    "name" is the expression itself, which for anything real runs longer than
    the line. Library names reach 31 characters and fit. */
function trackName(motif) {
  return /^[("]/.test(motif) ? "your pattern" : motif;
}

function buildTrack(rec, hits) {
  const wrap = el("div", "panel");
  const head = el("header");
  head.appendChild(el("h2", null, "Sequence"));
  const legend = el("span", "hint",
    "matched bases highlighted · rows are only room for names, and carry no meaning · " +
    "> reads left to right, < is the other strand");
  legend.classList.add("spacer");
  head.appendChild(legend);
  wrap.appendChild(head);

  const bodyBox = el("div", "panel-body");
  const pre = el("div", "track scroller");
  const width = TRACK_WIDTH;
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
      // Each highlighted run knows where it sits, so a click on it can find
      // the matches it belongs to, and a click in the table can find it.
      if (covered[i] && !open) { row += `<mark data-at="${i}" title="Click to pick out these matches in the table">`; open = true; }
      if (!covered[i] && open) { row += "</mark>"; open = false; }
      const cls = BASE_CLASS[c];
      row += cls ? `<span class="${cls}">${c}</span>` : c;
    }
    if (open) row += "</mark>";
    lines.push(`<div class="bases" data-from="${start}">${row}</div>`);

    /* One row per site, not per match. Several patterns routinely describe the
       same feature — tata-box, tata-box-strict and tata-inr-promoter all land
       on one TATA box — and listing each as its own row reads as three
       findings. Overlapping matches on the same strand are drawn once, named
       after the widest of them, with a count of the rest. */
    const here = hits.filter((h) => h.start < end && h.end > start);
    const clusters = [];
    for (const h of [...here].sort((a, b) => a.start - b.start || b.end - a.end)) {
      const open = clusters.find((c) => c.strand === h.strand && h.start < c.end && h.end > c.start);
      if (open) {
        open.start = Math.min(open.start, h.start);
        open.end = Math.max(open.end, h.end);
        open.members.push(h);
        if (h.end - h.start > open.widest.end - open.widest.start) open.widest = h;
      } else {
        clusters.push({ start: h.start, end: h.end, strand: h.strand, widest: h, members: [h] });
      }
    }

    /* A lane reserves whichever is wider, the site or its name, so a short site
       with a long name is not truncated to the width of the site — which is how
       "minus-35" used to come out as "minus-". */
    const lanes = [];
    for (const c of clusters) {
      const a = Math.max(c.start - start, 0), b = Math.min(c.end - start, width);
      const extra = c.members.length > 1 ? ` +${c.members.length - 1}` : "";
      const label = (c.strand === "-" ? "<" : ">") + trackName(c.widest.motif) + extra;
      const claimed = Math.max(b, a + label.length + 1);   // +1 keeps names apart
      const lane = lanes.find((L) => L.every(([la, , , lc]) => claimed <= la || lc <= a));
      if (lane) lane.push([a, b, c, claimed, label]);
      else lanes.push([[a, b, c, claimed, label]]);
    }
    for (const lane of lanes.slice(0, MAX_LANES)) {
      const buf = Array(width).fill(" ");
      for (const [a, b, c, , label] of lane) {
        const mark = c.strand === "-" ? "<" : ">";
        for (let k = a; k < b; k++) buf[k] = mark;
        // The name runs to the block edge if it needs to; the lane reserved it.
        for (let k = 0; k < label.length && a + k < width; k++) buf[a + k] = label[k];
      }
      lines.push(`<div class="lane">         ${escapeHtml(buf.join("").replace(/\s+$/, ""))}</div>`);
    }
    if (lanes.length > MAX_LANES) {
      lines.push(`<div class="lane skip">         … ${lanes.length - MAX_LANES} more ` +
                 `${lanes.length - MAX_LANES === 1 ? "row" : "rows"} of matches here, listed in the table below</div>`);
    }
  }
  if (skipped) lines.push(`<div class="skip">      ⋯ ${skipped * width} bases with no match ⋯</div>`);
  pre.innerHTML = lines.join("");
  bodyBox.appendChild(pre);
  wrap.appendChild(bodyBox);
  return wrap;
}

/* The picture and the table describe the same matches; each can point at the
   other. A row picks out its match in the sequence — a beginner's difficulty is
   reading a position number and finding it by eye — and a highlighted run
   picks out its matches in the table. */

const TRACK_WIDTH = 60;

function showHitInTrack(index) {
  const h = state.hits[index];
  const body = $("#results-body");
  if (!h || !body) return;
  const line = body.querySelector(`.bases[data-from="${Math.floor(h.start / TRACK_WIDTH) * TRACK_WIDTH}"]`);
  if (!line) return;
  line.scrollIntoView({ block: "center", behavior: "smooth" });
  for (const m of body.querySelectorAll(".track mark.flash")) m.classList.remove("flash");
  for (const m of body.querySelectorAll(".track mark")) {
    const at = Number(m.dataset.at);
    const len = m.textContent.length;
    if (at < h.end && at + len > h.start) m.classList.add("flash");
  }
  for (const r of body.querySelectorAll("table.hits tr.picked")) r.classList.remove("picked");
  body.querySelector(`table.hits tr[data-hit="${index}"]`)?.classList.add("picked");
}

function showRunInTable(mark) {
  const at = Number(mark.dataset.at);
  const len = mark.textContent.length;
  const body = $("#results-body");
  const rows = body.querySelectorAll("table.hits tr[data-hit]");
  let first = null;
  for (const r of rows) {
    const h = state.hits[Number(r.dataset.hit)];
    const on = h && h.start < at + len && h.end > at;
    r.classList.toggle("picked", on);
    if (on && !first) first = r;
  }
  for (const m of body.querySelectorAll(".track mark.flash")) m.classList.remove("flash");
  mark.classList.add("flash");
  if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
}

function wireResultsLinks() {
  const body = $("#results-body");
  body.addEventListener("click", (e) => {
    const mark = e.target.closest(".track mark");
    if (mark) { showRunInTable(mark); return; }
    const row = e.target.closest("table.hits tr[data-hit]");
    if (row) showHitInTrack(Number(row.dataset.hit));
  });
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest?.("table.hits tr[data-hit]");
    if (!row) return;
    e.preventDefault();
    showHitInTrack(Number(row.dataset.hit));
  });
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
  hits.slice(0, 500).forEach((h, i) => {
    const tr = el("tr");
    // A row is the way to the sequence: click it, or reach it with Tab and
    // press Enter, and the picture above scrolls to the match and flashes it.
    tr.tabIndex = 0;
    tr.dataset.hit = String(i);
    tr.title = "Show this match in the sequence above";
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
  });
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

/* --------------------------------------------------------------- splitter */

const CHIPS_HEIGHT = "biomotif-chips-height";
const CHIPS_MIN = 34;      // one row of chips
const LIST_MIN = 120;      // enough of the motif list to still be a list
const CHIPS_DEFAULT = 132;
let chipsWanted = CHIPS_DEFAULT;   // what the reader asked for, before clamping

function chipsBounds() {
  const rail = $(".rail").getBoundingClientRect();
  const chips = $("#category-chips").getBoundingClientRect();
  // Everything above the chips plus everything below the list must still fit.
  const fixed = (chips.top - rail.top) + $("#rail-splitter").offsetHeight;
  return [CHIPS_MIN, Math.max(CHIPS_MIN, rail.height - fixed - LIST_MIN)];
}

function setChipsHeight(px, remember = true) {
  const [lo, hi] = chipsBounds();
  const height = Math.round(Math.min(hi, Math.max(lo, px)));
  $("#category-chips").style.height = `${height}px`;
  const splitter = $("#rail-splitter");
  splitter.setAttribute("aria-valuenow", String(height));
  splitter.setAttribute("aria-valuemin", String(lo));
  splitter.setAttribute("aria-valuemax", String(Math.round(hi)));
  if (remember) {
    try { localStorage.setItem(CHIPS_HEIGHT, String(height)); } catch { /* storage refused */ }
  }
  return height;
}

function wireSplitter() {
  const splitter = $("#rail-splitter");
  const chips = $("#category-chips");
  let startY = 0;
  let startHeight = 0;

  /* The bounds depend on the rail, whose height is set by the grid row it
     shares with the results and keeps changing as they render. Rather than
     guess when it has settled, re-read them whenever someone is about to use
     the splitter — which is the only moment they have to be right. */
  const refresh = () => setChipsHeight(chipsWanted, false);
  splitter.addEventListener("pointerenter", refresh);
  splitter.addEventListener("focus", refresh);

  splitter.addEventListener("pointerdown", (e) => {
    refresh();
    startY = e.clientY;
    startHeight = chips.getBoundingClientRect().height;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    e.preventDefault();
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!splitter.hasPointerCapture(e.pointerId)) return;
    chipsWanted = setChipsHeight(startHeight + (e.clientY - startY));
  });
  const end = (e) => {
    if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
    splitter.classList.remove("dragging");
  };
  splitter.addEventListener("pointerup", end);
  splitter.addEventListener("pointercancel", end);

  splitter.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16;
    const now = chips.getBoundingClientRect().height;
    if (e.key === "ArrowUp") chipsWanted = setChipsHeight(now - step);
    else if (e.key === "ArrowDown") chipsWanted = setChipsHeight(now + step);
    else if (e.key === "Home") chipsWanted = setChipsHeight(CHIPS_MIN);
    else if (e.key === "End") chipsWanted = setChipsHeight(chipsBounds()[1]);
    else return;
    e.preventDefault();
  });
  // Double-click puts it back where it started.
  splitter.addEventListener("dblclick", () => { chipsWanted = setChipsHeight(CHIPS_DEFAULT); });

  let stored = null;
  try { stored = localStorage.getItem(CHIPS_HEIGHT); } catch { /* storage refused */ }
  chipsWanted = Number(stored) || CHIPS_DEFAULT;
  setChipsHeight(chipsWanted, false);

  /* The rail is only as tall as the grid row it shares with the results, so
     until those have rendered the bounds are far too tight and would clamp a
     remembered height away. settleSplitter() re-applies it once boot is done;
     the observer keeps it honest when the window changes afterwards. */
  if (typeof ResizeObserver === "function") {
    let last = 0;
    // Held on state: an observer that nothing references can be collected.
    state.railObserver = new ResizeObserver(([entry]) => {
      const height = Math.round(entry.contentRect.height);
      if (height === last) return;
      last = height;
      setChipsHeight(chipsWanted, false);
    });
    state.railObserver.observe($(".rail"));
  }
}

/** Re-apply the remembered split now that the rail has its real height. */
function settleSplitter() {
  if ($("#rail-splitter")) setChipsHeight(chipsWanted, false);
}

function wire() {
  wireSplitter();
  wireResultsLinks();
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
    state.origin = null;
    state.came = null;   // pasted: stays out of any link
    if (loadSequences(text)) { $("#seq-input").value = ""; run(); }
  });
  $("#seq-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.origin = null;
    state.came = null;   // a file: likewise
    if (loadSequences(await file.text())) run();
    e.target.value = "";
  });
  $("#fetch-btn").addEventListener("click", () => doFetch());
  // The species list is a few hundred names, fetched the first time the field
  // is used and folded into the datalist behind the model organisms already there.
  $("#fetch-species").addEventListener("focus", async () => {
    const list = $("#species-list");
    if (list.dataset.loaded) return;
    list.dataset.loaded = "1";
    const species = await ensemblSpecies();
    const have = new Set([...list.querySelectorAll("option")].map((o) => o.value));
    for (const s of species) {
      if (have.has(s.name)) continue;
      const option = el("option");
      option.value = s.name;
      option.label = s.display && s.display !== s.name ? `${s.display} (${s.assembly})` : s.assembly;
      list.appendChild(option);
    }
  }, { once: false });
  // Wrapped: doSearch takes a result limit, and a bare listener would hand it the event.
  $("#search-btn").addEventListener("click", () => doSearch());
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
      // proteins.fa holds real sequences; the rest are generated. Saying
      // "synthetic" of all of them would be teaching something false.
      state.origin = key === "proteins"
        ? "It is one of the built-in examples, drawn from real proteins — serum albumin, a kinase, a zinc finger protein, a Ras GTPase — plus one construct assembled from common laboratory tags."
        : "It is one of the built-in examples: a synthetic sequence with known features planted in it, so you can see what the tool does before using your own.";
      loadSequences(window.BIOMOTIF_DATA[key], key === "proteins" ? "protein" : null);
      state.came = { demo: key };
      fetchStatus("");
      run();
    });
  }
  $("#link-btn").addEventListener("click", async () => {
    const btn = $("#link-btn");
    const url = shareUrl(linkState());
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = state.came ? "Link copied" : "Link copied (motif only)";
    } catch {
      // No clipboard, as in some embedded viewers: the address bar has it.
      btn.textContent = "See the address bar";
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 2200);
  });
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
  // A link says what to open. Otherwise open in a working state: a plasmid
  // loaded and a real promoter already found.
  const link = decodeState(location.hash);
  if (!link?.demo && !link?.fetch) {
    loadSequences(window.BIOMOTIF_DATA.operon);
    state.came = { demo: "operon" };
  }
  if (!link?.motif) {
    const entry = state.registry.get("sigma70-promoter");
    state.selectedEntry = entry.name;
    setMotifSource(entry.editorSource ?? entry.pattern, entry.name);
    showDoc(entry);
  }
  applyLink(link);
  renderRail();
  run();
  window.addEventListener("hashchange", () => applyLink(decodeState(location.hash)));
  initAssistant();
  settleSplitter();
}

boot();
