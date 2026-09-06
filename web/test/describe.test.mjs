/* The explanation pane. It is written for someone who does not know the
   biology, which means an inaccuracy here is worse than one anywhere else in
   the app: there is no reader who would catch it. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { Record, parseFasta, search } from "../src/engine.js";
import { Registry, buildMotif, loadLibrarySource } from "../src/library.js";
import { parse } from "../src/engine.js";
import { LIB_FILES } from "../../tools/build.mjs";
import { describeState, expectedByChance, generator, rnaMotifs } from "../src/describe.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const registry = new Registry();
for (const f of LIB_FILES) {
  loadLibrarySource(`${f}.mtf`, readFileSync(join(ROOT, "library", `${f}.mtf`), "utf8"), registry);
}
const plasmid = parseFasta(readFileSync(join(ROOT, "data", "plasmid.fa"), "utf8"))[0];
const protein = parseFasta(readFileSync(join(ROOT, "data", "proteins.fa"), "utf8"), "protein")[0];

const run = (name, record = plasmid) => {
  const entry = registry.get(name);
  const hits = search(entry.matcher, record);
  return describeState({ record, entry, matcher: entry.matcher, source: entry.pattern, hits });
};
const text = (sections) => sections.map((s) => s.body).join(" ");
const found = (sections) => sections.find((s) => s.heading === "What was found");

test("every section has a heading and prose", () => {
  for (const s of run("loxp")) {
    assert.ok(s.heading && s.heading.trim(), JSON.stringify(s));
    assert.ok(s.body && s.body.trim().length > 20, s.heading);
  }
});

test("an enriched site is distinguished without calling it biologically proven", () => {
  /* This is the whole point of the pane. loxP is 34 fixed bases and never
     appears in a shuffled sequence; CANNTG is six bases with two free and
     turns up as often by accident as it does for real. */
  assert.equal(found(run("loxp")).tone, "strong");
  assert.match(found(run("loxp")).body, /does not establish|not proof/i);

  const eBox = buildMotif(parse('(iupac "CANNTG")'), registry);
  const hits = search(eBox, plasmid);
  assert.ok(hits.length > 10, "the noisy case needs to actually be noisy");
  const sections = describeState({ record: plasmid, entry: null, matcher: eBox,
                                   source: '(iupac "CANNTG")', hits });
  assert.equal(found(sections).tone, "noise");
  assert.match(found(sections).body, /background/i);
});

test("the chance estimate is stable and non-negative", () => {
  const m = registry.get("poly-a-signal").matcher;
  const a = expectedByChance(m, plasmid);
  const b = expectedByChance(m, plasmid);
  assert.equal(a, b, "the same sequence must give the same estimate twice");
  assert.ok(a >= 0);
});

test("a protein is never described as having two strands", () => {
  const sections = describeState({ record: protein, entry: registry.get("n-glycosylation"),
    matcher: registry.get("n-glycosylation").matcher, source: "", hits: [] });
  const all = text(sections);
  assert.ok(!/strand/i.test(all), `a protein has no strands: ${all}`);
  assert.match(all, /single direction|one way to read/);
});

test("nothing found is explained two different ways", () => {
  /* Absent-and-expected and absent-but-unlikely-anyway are different findings,
     and a beginner cannot tell them apart without being told. */
  const absent = buildMotif(parse('(iupac "GGGCCCGGGCCCGGGCCC")'), registry);
  const rare = describeState({ record: plasmid, entry: null, matcher: absent, source: "", hits: [] });
  assert.match(found(rare).body, /absence informative/);

  const common = buildMotif(parse('(iupac "ATGCATG")'), registry);
  const expected = expectedByChance(common, plasmid);
  if (expected > 0.5) {
    const loose = describeState({ record: plasmid, entry: null, matcher: common, source: "", hits: [] });
    assert.match(found(loose).body, /not surprising/);
  }
});

test("a scan says how many places the matches sit at, not just how many there are", () => {
  /* Several patterns describe the same feature — the loose TATA box, the strict
     one, and the promoter containing both — so a raw match count reads as more
     findings than there are. */
  const overlapping = [
    { motif: "tata-box", absStart: 100, absEnd: 108, strand: "+" },
    { motif: "tata-box-strict", absStart: 100, absEnd: 106, strand: "+" },
    { motif: "tata-inr-promoter", absStart: 98, absEnd: 140, strand: "+" },
    { motif: "e-box", absStart: 500, absEnd: 506, strand: "+" },
  ];
  const sections = describeState({ record: plasmid, hits: overlapping, mode: "scan" });
  const body = sections.find((s) => s.heading === "What was found").body;
  assert.match(body, /4 matches/);
  assert.match(body, /2 places/, "three overlapping matches are one place, plus the lone one");
  assert.match(body, /draws each place once/);
});

test("an RNA element found in DNA carries a warning, and in RNA does not", () => {
  rnaMotifs.add("au-rich-element");
  const hit = [{ motif: "au-rich-element", absStart: 10, absEnd: 15, strand: "-" }];
  const onDna = describeState({ record: plasmid, hits: hit, mode: "scan" });
  const caution = onDna.find((s) => s.heading === "One thing to be careful of");
  assert.ok(caution, "an RNA element in DNA needs saying");
  assert.match(caution.body, /copied into RNA/);
  assert.match(caution.body, /opposite strand/);

  const rnaRecord = new Record("r", plasmid.seq, "rna");
  const onRna = describeState({ record: rnaRecord, hits: hit, mode: "scan" });
  assert.ok(!onRna.some((s) => s.heading === "One thing to be careful of"),
    "in RNA there is nothing to warn about");
});

test("the other buttons each explain what they did", () => {
  for (const mode of ["scan", "orfs", "digest"]) {
    const sections = describeState({ record: plasmid, hits: [], mode });
    const headings = sections.map((s) => s.heading);
    assert.ok(headings.includes("What was done"), mode);
    assert.ok(headings.includes("The sequence"), mode);
    assert.ok(text(sections).length > 200, `${mode} says too little`);
  }
});

test("the prose the pane writes itself avoids jargon", () => {
  /* Library docstrings are quoted as written and use the field's vocabulary;
     rewriting 487 of them is a separate job. What the pane composes around
     them must not, so this checks the generated sentences only — built with no
     entry, so no docstring is included. */
  const m = registry.get("sigma70-promoter").matcher;
  let all = text(describeState({ record: plasmid, entry: null, matcher: m,
    source: registry.get("sigma70-promoter").pattern, hits: search(m, plasmid) }));
  for (const mode of ["scan", "orfs", "digest"]) {
    all += " " + text(describeState({ record: plasmid, hits: [], mode }));
  }
  for (const word of ["codon", "ORF", "consensus", "5'", "3'", " bp", "motif", "IUPAC"]) {
    assert.ok(!all.includes(word), `"${word}" appears unexplained in prose the pane wrote itself`);
  }
});

test("a description survives a motif it cannot characterise", () => {
  const sections = describeState({ record: plasmid, entry: null, matcher: null, source: "", hits: [] });
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].heading, "The sequence");
});

test("with nothing loaded it says so rather than failing", () => {
  const sections = describeState({ record: null, hits: [] });
  assert.equal(sections.length, 1);
  assert.match(sections[0].body, /Fetch a sequence|pick an example/);
});

test("the shuffle's generator does not collapse, which is what it did before", () => {
  const rand = generator();
  const draws = [];
  for (let i = 0; i < 20_000; i++) draws.push(rand());

  // The bug: seed * 1103515245 overflows 2^53, so the low bits were rounded
  // away and 20,000 draws visited only 12,889 distinct states.
  assert.equal(new Set(draws).size, draws.length, "every draw should be distinct");
  assert.ok(draws.every((d) => d >= 0 && d < 1), "draws are in [0, 1)");

  // Roughly uniform: each tenth should hold a tenth, give or take.
  const buckets = new Array(10).fill(0);
  for (const d of draws) buckets[Math.floor(d * 10)]++;
  for (const [i, n] of buckets.entries()) {
    assert.ok(n > 1700 && n < 2300, `bucket ${i} held ${n}, which is not close to 2000`);
  }

  // Seeded, so the same sequence is always explained the same way.
  assert.equal(generator()(), draws[0], "the default seed always starts the same stream");
  assert.notEqual(generator(99)(), draws[0], "a different seed gives a different stream");
});
