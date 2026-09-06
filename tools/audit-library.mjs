/* Report the motif library as a scientific dataset. Missing provenance does
   not fail the audit: the report makes that debt measurable while contributors
   improve it entry by entry. */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Registry, loadLibrarySource } from "../web/src/library.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["prokaryote", "eukaryote", "plant", "rna", "protein", "tags", "restriction", "jaspar"];
const registry = new Registry();
const errors = [];
for (const name of FILES) {
  errors.push(...loadLibrarySource(`${name}.mtf`, readFileSync(join(ROOT, "library", `${name}.mtf`), "utf8"), registry));
}

const entries = registry.all();
const byEvidence = new Map();
for (const entry of entries) {
  const level = entry.provenance.evidence;
  byEvidence.set(level, (byEvidence.get(level) || 0) + 1);
}
const attributable = entries.filter((e) => e.provenance.citation || e.provenance.evidence === "catalogue").length;
console.log(`Library audit: ${entries.length} entries`);
console.log(`  attributable source: ${attributable}/${entries.length} (${(100 * attributable / entries.length).toFixed(1)}%)`);
for (const [level, count] of [...byEvidence].sort()) console.log(`  ${level}: ${count}`);
console.log(`  examples: ${entries.filter((e) => e.example).length}/${entries.length}`);
console.log(`  reviewed dates: ${entries.filter((e) => e.provenance.reviewed).length}/${entries.length}`);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
if (entries.some((e) => !e.doc || !e.category || !e.alphabet)) {
  console.error("Every entry must have a description, category and alphabet.");
  process.exitCode = 1;
}
