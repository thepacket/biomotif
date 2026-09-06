/* Reproducible matcher benchmark. Kept out of CI because shared runners are
   noisy; the fixed sequence and reported throughput make local comparisons
   meaningful before and after an engine change. */

import { performance } from "node:perf_hooks";
import { parse, Record, search } from "../web/src/engine.js";
import { buildMotif, Registry } from "../web/src/library.js";

let x = 0x9e3779b9;
const base = () => {
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  return "ACGT"[x & 3];
};
const sequence = (n) => Array.from({ length: n }, base).join("");
const registry = new Registry();
const cases = [
  ["literal", '"GAATTC"', 1_000_000],
  ["IUPAC", '(iupac "TATAWAWR")', 1_000_000],
  ["spaced fuzzy", '(seq (fuzzy 1 (iupac "TTGACA")) (gap 15 19) (fuzzy 1 (iupac "TATAAT")))', 500_000],
  ["hairpin", '(hairpin (stem 5 10) (loop 3 8) :wobble #t)', 25_000],
];

console.log(`Node ${process.version}; deterministic random DNA`);
for (const [name, source, size] of cases) {
  const matcher = buildMotif(parse(source), registry);
  const record = new Record(name, sequence(size), "dna");
  search(matcher, record); // warm
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    search(matcher, record);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const ms = samples[2];
  console.log(`${name.padEnd(14)} ${(size / ms / 1000).toFixed(2).padStart(7)} Mb/s  (${ms.toFixed(1)} ms, ${size.toLocaleString()} bases)`);
}
