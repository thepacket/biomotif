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
import { describeState, expectedByChance } from "../src/describe.js";

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

test("a real site is called real, and a chance one is not", () => {
  /* This is the whole point of the pane. loxP is 34 fixed bases and never
     appears in a shuffled sequence; CANNTG is six bases with two free and
     turns up as often by accident as it does for real. */
  assert.equal(found(run("loxp")).tone, "strong");

  const eBox = buildMotif(parse('(iupac "CANNTG")'), registry);
  const hits = search(eBox, plasmid);
  assert.ok(hits.length > 10, "the noisy case needs to actually be noisy");
  const sections = describeState({ record: plasmid, entry: null, matcher: eBox,
                                   source: '(iupac "CANNTG")', hits });
  assert.equal(found(sections).tone, "noise");
  assert.match(found(sections).body, /chance/i);
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
  assert.match(found(rare).body, /absence is meaningful/);

  const common = buildMotif(parse('(iupac "ATGCATG")'), registry);
  const expected = expectedByChance(common, plasmid);
  if (expected > 0.5) {
    const loose = describeState({ record: plasmid, entry: null, matcher: common, source: "", hits: [] });
    assert.match(found(loose).body, /not surprising/);
  }
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
