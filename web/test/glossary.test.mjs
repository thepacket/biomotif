/* The glossary: a term is explained once per passage, markup is left alone,
   and the definitions are what a beginner needs. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TERMS, annotate } from "../src/glossary.js";

test("a term is wrapped once, at its first appearance", () => {
  const out = annotate("DNA has two strands; a strand reads one way.");
  assert.equal((out.match(/class="term"/g) || []).length, 1);
  assert.ok(out.startsWith('DNA has two <span class="term"'), out);
  assert.match(out, /role="tooltip"/);
});

test("several terms in one passage are each explained", () => {
  const out = annotate("The consensus is looked for on both strands, allowing one mismatch.");
  for (const word of ["consensus", "strands", "mismatch"]) assert.ok(out.includes(`>${word}<span class="term-def"`), word);
});

test("markup already there is untouched, and a definition cannot contain a definition", () => {
  const out = annotate("<strong>tata-box</strong> — bound on both <em>strands</em>.");
  assert.ok(out.includes("<strong>tata-box</strong>"));
  assert.ok(out.includes("<em>"));
  // The definition of "strands" mentions "strand"; that must not be wrapped again.
  const defs = out.match(/<span class="term-def"[^>]*>[^<]*<\/span>/g) || [];
  assert.equal(defs.length, 1);
  assert.equal((out.match(/class="term"/g) || []).length, 1);
});

test("the definitions are plain prose, and each term has one", () => {
  for (const t of TERMS) {
    assert.ok(t.def.length > 20 && t.def.length < 260, t.re.source);
    assert.match(t.def, /\.$/, t.re.source);
  }
  assert.ok(TERMS.length >= 20);
});

test("matching is on whole words, case-insensitively", () => {
  assert.ok(!annotate("upstreams").includes("term"), "not a prefix");
  assert.ok(annotate("Upstream of it").includes('class="term"'));
  assert.ok(!annotate("database").includes("term"), "'base' inside another word is not a base");
});

test("the tooltip is reachable from the keyboard and named for a screen reader", () => {
  const out = annotate("one strand");
  assert.match(out, /tabindex="0" aria-describedby="def-\d+"/);
  assert.match(out, /role="tooltip" id="def-\d+"/);
});
