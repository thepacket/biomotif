/* Links: what goes into one, what stays out, and what a link from a stranger
   is allowed to do. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeState, encodeState, shareUrl } from "../src/share.js";

test("a link carries the motif and where the sequence came from", () => {
  const frag = encodeState({ motif: '(fuzzy 1 (iupac "TATAWAWR"))', fetch: "ENST00000335295", source: "ensembl", upstream: 200 });
  assert.equal(decodeState(frag).motif, '(fuzzy 1 (iupac "TATAWAWR"))');
  assert.equal(decodeState(frag).fetch, "ENST00000335295");
  assert.equal(decodeState(frag).source, "ensembl");
  assert.equal(decodeState(frag).upstream, 200);
});

test("the defaults are left out, so a link is as short as it can be", () => {
  assert.equal(encodeState({ motif: "tata-box", fetch: "HBB", source: "auto", species: "homo_sapiens", upstream: 0, circular: false }),
    "motif=tata-box&fetch=HBB");
  assert.equal(encodeState({}), "");
  assert.equal(decodeState(""), null);
  assert.equal(decodeState("#"), null);
});

test("an example sequence is linked by name and needs no network", () => {
  const frag = encodeState({ motif: "sigma70-promoter", demo: "operon", fetch: "HBB" });
  assert.equal(frag, "motif=sigma70-promoter&demo=operon");
  assert.deepEqual(decodeState("demo=operon&fetch=HBB"), { demo: "operon" });
});

test("a pasted sequence is never in a link", () => {
  // There is no key for sequence text: nothing the encoder accepts carries it.
  const frag = encodeState({ motif: "tata-box", seq: "ACGT", records: [{ seq: "ACGT" }], key: "sk-or-v1-secret" });
  assert.equal(frag, "motif=tata-box");
  assert.ok(!/ACGT|secret/.test(frag));
});

test("a link from anyone is bounded and unknown keys are dropped", () => {
  assert.equal(decodeState("upstream=999999999").upstream, 100000);
  assert.equal(decodeState("upstream=-5&motif=x").upstream, undefined);
  assert.equal(decodeState("motif=" + "a".repeat(5000)), null);
  assert.deepEqual(decodeState("javascript=alert(1)&motif=tata-box"), { motif: "tata-box" });
  assert.equal(decodeState("circular=1").circular, true);
  assert.equal(decodeState("circular=no"), null);
});

test("parentheses and quotes stay readable in the link", () => {
  const frag = encodeState({ motif: '(seq "GAATTC" (gap 1 5))' });
  assert.ok(frag.includes('(seq') && frag.includes('"GAATTC"'), frag);
  assert.equal(decodeState(frag).motif, '(seq "GAATTC" (gap 1 5))');
});

test("the whole link replaces any fragment already there", () => {
  assert.equal(shareUrl({ motif: "tata-box" }, "https://biomotif.fly.dev/#old"), "https://biomotif.fly.dev/#motif=tata-box");
  assert.equal(shareUrl({}, "https://biomotif.fly.dev/#old"), "https://biomotif.fly.dev/");
});
