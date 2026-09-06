/* Exported coordinates are part of the scientific interface: each convention
   gets a direct test rather than being inferred from the browser UI. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Match, Record } from "../src/engine.js";
import { resultsBed, resultsGff3, resultsJson, resultsTsv } from "../src/formats.js";

const record = new Record("chrTest", "AACCGGTTAACC", "dna", { offset: 100 });
const hit = new Match("demo", 2, 6, "+", "CCGG", { core: [2, 6, "CCGG"] }, record, null, {});

test("TSV and GFF3 use 1-based, end-inclusive coordinates", () => {
  assert.match(resultsTsv([hit]), /\t103\t106\t4\t\+\tCCGG\t/);
  assert.match(resultsGff3([hit]), /chrTest\tBiomotif\tsequence_motif\t103\t106\t\.\t\+/);
});

test("BED uses 0-based, end-exclusive coordinates", () => {
  assert.match(resultsBed([hit]), /chrTest\t102\t106\tdemo\t0\t\+/);
});

test("JSON records provenance and its coordinate convention", () => {
  const json = JSON.parse(resultsJson([hit], { record, motif: '(iupac "CCGG")',
    libraryEntry: "demo", provenance: { evidence: "literature-backed" } }));
  assert.match(json.coordinateConvention, /1-based.*0-based/);
  assert.equal(json.matches[0].start, 103);
  assert.equal(json.analysis.provenance.evidence, "literature-backed");
});
