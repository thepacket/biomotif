/* The motif library: every entry loads, matches its own documented example,
   and behaves the way the biology says it should. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { BiomotifError, Record, revcomp, search } from "../src/engine.js";
import { LIB_FILES } from "../../tools/build.mjs";
import { Registry, buildMotif, digest, loadLibrarySource, orfs, overhang, parseSite, translate }
  from "../src/library.js";
import { parse } from "../src/engine.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const registry = new Registry();
const loadProblems = [];
for (const name of LIB_FILES) {
  loadProblems.push(...loadLibrarySource(`${name}.mtf`,
    readFileSync(join(ROOT, "library", `${name}.mtf`), "utf8"), registry));
}

const motif = (src) => buildMotif(parse(src), registry);
const dna = (s) => new Record("t", s, "dna");
const protein = (s) => new Record("t", s, "protein");
const entry = (name) => {
  const e = registry.get(name);
  assert.ok(e, `no motif named ${name}`);
  return e;
};

/* ---------------------------------------------------------------- loading */

test("every library file parses with no errors", () => {
  assert.deepEqual(loadProblems, []);
});

test("the library is the size it claims to be", () => {
  assert.equal(registry.size, 487);
  assert.equal(registry.categories().length, 57);
});

test("every entry carries a docstring, a category and a known alphabet", () => {
  for (const e of registry.all()) {
    assert.ok(e.doc.trim(), `${e.name} has no docstring`);
    assert.ok(e.category && e.category === e.category.toLowerCase() && !e.category.includes(" "));
    assert.ok(["dna", "rna", "protein"].includes(e.alphabet), `${e.name}: ${e.alphabet}`);
    assert.ok(e.pattern, `${e.name} does not describe itself`);
  }
});

test("every documented example is matched by its own motif", () => {
  const bad = [];
  for (const e of registry.all()) {
    if (!e.example) continue;
    const rec = new Record("x", e.example, e.alphabet === "protein" ? "protein" : "dna");
    if (!search(e.matcher, rec).length) bad.push(`${e.name}: ${e.example} vs ${e.pattern}`);
  }
  assert.deepEqual(bad, []);
});

test("no entry throws when run against a plain sequence", () => {
  const d = dna("ACGTACGTTTAGGGCACGTGAATTCATGGCTAAGGAGGTATAATTTGACA".repeat(4));
  const p = protein("MKWVTFISLLLLNGSAYSRGVFRRDTHKSEIAHRFKDLGEENFKDEVDKDEL".repeat(2));
  for (const e of registry.all()) {
    assert.doesNotThrow(() => search(e.matcher, e.alphabet === "protein" ? p : d), e.name);
  }
});

test("templates are flagged so a scan is not drowned by them", () => {
  assert.equal(registry.all().filter((e) => !e.scan).length, 166);
  assert.equal(entry("umi-8").scan, false, "an N-run matches everywhere");
  assert.equal(entry("pam-spcas9").scan, false, "NGG matches every 16th position");
  assert.equal(entry("loxp").scan, true);
  assert.equal(entry("tata-box").scan, true);
});

/* ------------------------------------------------- what the motifs mean */

test("a Shine-Dalgarno with a spacer and a start codon", () => {
  const hits = search(entry("ribosome-binding-site").matcher,
    dna("CCCC" + "AAGGAGG" + "TATACAT" + "ATG" + "GCTGCT"), { strand: "+" });
  assert.ok(hits.length);
  assert.equal(hits[0].bindings.start[2], "ATG");
});

test("a sigma-70 promoter needs the right spacing between its boxes", () => {
  const m = entry("sigma70-promoter").matcher;
  assert.ok(search(m, dna("TTGACA" + "ACGTACGTACGTACGTA" + "TATAAT"), { strand: "+" }).length);
  assert.deepEqual(search(m, dna("TTGACA" + "ACGT" + "TATAAT"), { strand: "+" }), [],
    "four bases is far too short a spacer");
});

test("loxP is a 34-mer whose arms are inverted repeats", () => {
  const site = entry("loxp").example;
  assert.equal(site.length, 34);
  assert.equal(site.slice(0, 13), revcomp(site.slice(-13)));
});

test("a G-quadruplex needs four G-tracts", () => {
  const m = entry("g-quadruplex").matcher;
  assert.ok(search(m, dna("GGGTTAGGGTTAGGGTTAGGG"), { strand: "+" }).length);
  assert.deepEqual(search(m, dna("GGGTTAGGGTTAGGG"), { strand: "+" }), [], "three tracts is not a quadruplex");
});

test("Kozak needs both the purine at -3 and the G at +4", () => {
  const m = entry("kozak").matcher;
  assert.ok(search(m, dna("GCCACCATGG"), { strand: "+" }).length);
  assert.deepEqual(search(m, dna("GCCCCCATGG"), { strand: "+" }), [], "C at -3 is not a purine");
  assert.deepEqual(search(m, dna("GCCACCATGA"), { strand: "+" }), [], "A at +4 is not G");
});

test("the N-glycosylation sequon excludes proline", () => {
  const m = entry("n-glycosylation").matcher;
  assert.ok(search(m, protein("AANGSAA")).length);
  assert.deepEqual(search(m, protein("AANPSAA")), []);
});

test("PTS1 must sit at the very C-terminus", () => {
  const m = entry("peroxisome-pts1").matcher;
  assert.ok(search(m, protein("MAAAASKL")).length);
  assert.deepEqual(search(m, protein("MSKLAAAA")), []);
});

test("an iron responsive element needs a stem that pairs, not just the loop", () => {
  const m = entry("iron-responsive-element").matcher;
  const stem = "GGGGC";
  assert.ok(search(m, dna(stem + "CAGTGT" + revcomp(stem)), { strand: "+" }).length);
  assert.deepEqual(search(m, dna("AAAAA" + "CAGTGT" + "AAAAA"), { strand: "+" }), []);
});

test("an RNA motif matches the same sequence spelled with T", () => {
  const m = entry("au-rich-element").matcher;
  assert.ok(search(m, dna("CCAUUUACC"), { strand: "+" }).length);
  assert.ok(search(m, dna("CCATTTACC"), { strand: "+" }).length);
});

/* ------------------------------------------------------------ enzymes */

test("well-known restriction sites are right", () => {
  for (const [name, site] of Object.entries({
    EcoRI: "GAATTC", BamHI: "GGATCC", HindIII: "AAGCTT", NotI: "GCGGCCGC",
    XhoI: "CTCGAG", KpnI: "GGTACC", SmaI: "CCCGGG", PstI: "CTGCAG",
    SalI: "GTCGAC", NdeI: "CATATG", NcoI: "CCATGG", SpeI: "ACTAGT",
  })) assert.equal(entry(name).meta.site, site, name);
});

test("cut positions give the right overhangs", () => {
  assert.equal(overhang(parseSite("G^AATTC")), "5' overhang of 4");
  assert.equal(overhang(parseSite("GGTAC^C")), "3' overhang of 4");
  assert.equal(overhang(parseSite("CCC^GGG")), "blunt");
  assert.equal(overhang(parseSite("GGTCTC(1/5)")), "5' overhang of 4", "Type IIS cuts outside its site");
  assert.equal(overhang(parseSite("GTGCAG(16/14)")), "3' overhang of 2");
});

test("a site with no cut mark is rejected", () => {
  assert.throws(() => parseSite("GAATTC"), BiomotifError);
});

test("a palindromic enzyme cuts symmetrically", () => {
  for (const e of registry.find({ category: "restriction" })) {
    const i = e.meta;
    if (i.kind !== "II" || i.site !== revcomp(i.site)) continue;
    assert.equal(i.cutTop + i.cutBottom, i.site.length, e.name);
  }
});

test("a linear digest cuts where the enzyme says", () => {
  const seq = new Record("s", "AAAA" + "GAATTC" + "TTTT" + "GAATTC" + "CCCC");
  const d = digest(seq, [{ name: "EcoRI", info: parseSite("G^AATTC") }]);
  assert.deepEqual(d.cuts, [5, 15]);
  assert.deepEqual(d.fragments.map((f) => f[2]), [5, 10, 9]);
});

test("a circular digest wraps the last fragment round to the first", () => {
  const seq = new Record("s", "AAAA" + "GAATTC" + "T".repeat(10) + "GAATTC" + "CCCC");
  const d = digest(seq, [{ name: "EcoRI", info: parseSite("G^AATTC") }], { circular: true });
  assert.equal(d.fragments.length, 2);
  assert.equal(d.fragments.reduce((n, f) => n + f[2], 0), seq.seq.length);
});

test("a non-palindromic Type IIS site is found on both strands", () => {
  const seq = new Record("s", "AAAAA" + revcomp("GGTCTC") + "AAAAAAAAAA");
  const d = digest(seq, [{ name: "BsaI", info: parseSite("GGTCTC(1/5)") }]);
  assert.ok(d.sites.length && d.sites[0].strand === "-");
});

/* ------------------------------------------- building motifs from source */

test("a motif expression builds into the matcher it describes", () => {
  assert.equal(motif('(iupac "TATAWAWR")').describe(), '(iupac "TATAWAWR")');
  assert.equal(motif('(gap 15 19)').describe(), "(gap 15 19)");
  assert.equal(motif("(seq \"A\" (gap 2 4) \"T\")").describe(), '(seq "A" (gap 2 4) "T")');
});

test("a bare name refers to a library motif", () => {
  assert.equal(motif("tata-box").describe(), entry("tata-box").matcher.describe());
});

test("bad motif source explains itself", () => {
  assert.throws(() => motif('(nonsense "X")'), /unknown motif form/);
  assert.throws(() => motif('(iupac "TATAZZ")'), /not a nucleotide code/);
  assert.throws(() => motif("(gap \"x\")"), /must be a number/);
  assert.throws(() => motif("(hairpin 4 (loop 3 5))"), /must be \(stem min max\)/);
});

test("quoted keywords and labels are unwrapped", () => {
  const m = motif("(named 'box \"TTGACA\")");
  const hit = search(m, dna("TTGACA"), { strand: "+" })[0];
  assert.ok(hit.bindings.box, "the label must be box, not the quote form");
});

/* -------------------------------------------------- sequence utilities */

test("translation, and the tables that differ", () => {
  assert.equal(translate("ATGGCTTAA"), "MA*");
  assert.equal(translate("ATGGCTTAA", { toStop: true }), "MA");
  assert.equal(translate("AUGGCU"), "MA", "U reads as T");
  assert.equal(translate("AGA", { table: 1 }), "R");
  assert.equal(translate("AGA", { table: 2 }), "*", "AGA is a stop in vertebrate mitochondria");
  assert.equal(translate("CTN"), "L", "every CTN codon is leucine");
  assert.equal(translate("ATN"), "X", "ATN spans isoleucine and methionine");
});

test("ORFs are found on both strands", () => {
  const cds = "ATG" + "GCT".repeat(40) + "TAA";
  const forward = orfs("TTTTT" + cds + "GGGGG", { minLength: 60 });
  assert.ok(forward.some((o) => o.start === 5 && o.strand === "+" && o.protein === "M" + "A".repeat(40)));
  const reverse = orfs("TTTTT" + revcomp(cds) + "GGGGG", { minLength: 60 });
  assert.ok(reverse.some((o) => o.strand === "-"));
});

test("every library motif reports a sane span", () => {
  for (const e of registry.all()) {
    const [lo, hi] = e.matcher.span();
    assert.ok(Number.isFinite(lo) && lo >= 0, `${e.name}: ${lo}`);
    assert.ok(hi >= lo, `${e.name}: ${lo}..${hi}`);
  }
});

test("a library pattern round-trips unchanged, so the editor never echoes itself", () => {
  /* The status line only shows the canonical form when it differs from what was
     typed. Clicking a library entry puts its canonical pattern in the editor,
     so if these ever stopped round-tripping the line would echo the source. */
  const tidy = (t) => t.replace(/\s+/g, " ").trim();
  const drift = registry.all()
    .filter((e) => tidy(buildMotif(parse(e.pattern), registry).describe()) !== tidy(e.pattern))
    .map((e) => e.name);
  assert.deepEqual(drift, []);
});
