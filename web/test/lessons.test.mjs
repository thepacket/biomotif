/* The walkthroughs: every step is well formed, every motif builds, and the
   offline lesson finds what it says it finds. The Ensembl lesson's numbers
   were checked by hand against the fetched sequence; a test that depended on
   Ensembl would fail for reasons that are not ours. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parse, parseFasta, search } from "../src/engine.js";
import { Registry, buildMotif, loadLibrarySource } from "../src/library.js";
import { LIB_FILES } from "../../tools/build.mjs";
import { LESSONS, lessonById } from "../src/lessons.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const registry = new Registry();
for (const f of LIB_FILES) loadLibrarySource(`${f}.mtf`, readFileSync(join(ROOT, "library", `${f}.mtf`), "utf8"), registry);

const matcherFor = (motif) => registry.get(motif)?.matcher ?? buildMotif(parse(motif), registry);

test("every lesson is complete and every step does one thing", () => {
  assert.ok(LESSONS.length >= 2);
  for (const l of LESSONS) {
    assert.match(l.id, /^[a-z-]+$/);
    assert.ok(l.title && l.intro && l.seq && l.steps.length >= 4, l.id);
    assert.ok(l.seq.demo || l.seq.fetch, l.id);
    for (const s of l.steps) {
      assert.ok(s.title && s.text && s.look, `${l.id}: ${s.title}`);
      assert.equal(Number(!!s.motif) + Number(!!s.scan), 1, `${l.id}: ${s.title} must load a motif or scan, not both`);
      assert.match(s.look, /\.$/, s.title);
    }
  }
  assert.equal(lessonById("operon").id, "operon");
  assert.equal(lessonById("nothing"), null);
});

test("every motif a lesson loads builds against the library", () => {
  for (const l of LESSONS) for (const s of l.steps) if (s.motif) assert.doesNotThrow(() => matcherFor(s.motif), `${l.id}: ${s.motif}`);
});

test("the offline lesson finds what it says it finds", () => {
  const lesson = lessonById("operon");
  const rec = parseFasta(readFileSync(join(ROOT, "data", "operon.fa"), "utf8"))[0];
  for (const s of lesson.steps) {
    if (!s.motif) continue;
    const hits = search(matcherFor(s.motif), rec);
    assert.equal(hits.length, s.expect, `${s.title}: ${s.motif}`);
  }
  // The positions the text quotes.
  assert.equal(search(matcherFor("sigma70-promoter"), rec)[0].start + 1, 121);
  assert.equal(search(matcherFor("rho-independent-terminator"), rec)[0].start + 1, 1189);
});

test("the Ensembl lesson asks for the promoter, not just the gene", () => {
  const lesson = lessonById("beta-globin");
  assert.equal(lesson.seq.upstream, 200);
  assert.equal(lesson.seq.source, "ensembl");
  // The text counts positions from the start at 201, so the upstream must be 200.
  assert.ok(lesson.steps.some((s) => /position 201/.test(s.text)));
});
