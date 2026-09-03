/* The matching engine. Every expected value here is written from the biology,
   not captured from a run, so a change in behaviour fails rather than being
   rubber-stamped. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Alt, AnyChar, AnyOf, AtEnd, AtStart, BiomotifError, CharRun, Edit, Fuzzy, Hairpin,
  Iupac, Literal, Named, NoneOf, Pwm, Record, Repeat, Seq,
  balanced, collapse, complement, expandIupac, formatFasta, guessType, matchesFull,
  parse, parseAll, parseFasta, revcomp, search, toIupac, transcribe,
} from "../src/engine.js";

const spans = (hits) => hits.map((h) => [h.start, h.end, h.strand]);
const texts = (hits) => hits.map((h) => h.seq);
const dna = (s) => new Record("t", s, "dna");
const protein = (s) => new Record("t", s, "protein");

/* --------------------------------------------------------------- reader */

test("reader: atoms", () => {
  assert.equal(parse("42"), 42);
  assert.equal(parse("-3.5"), -3.5);
  assert.equal(parse('"hi"'), "hi");
  assert.equal(parse("#t"), true);
  assert.equal(parse("#f"), false);
  assert.equal(parse("foo").name, "foo");
});

test("reader: lists and quote", () => {
  assert.deepEqual(parse("(1 2 (3 4))"), [1, 2, [3, 4]]);
  const q = parse("'x");
  assert.equal(q[0].name, "quote");
  assert.equal(q[1].name, "x");
});

test("reader: comments are dropped, semicolons inside strings are not", () => {
  assert.deepEqual(parseAll("; note\n(1 2) ; more\n(3)"), [[1, 2], [3]]);
  assert.equal(parse('"a;b"'), "a;b");
});

test("reader: docstrings may span lines", () => {
  assert.equal(parse('"one\ntwo"'), "one\ntwo");
});

test("reader: unbalanced input is an error, and balanced() sees it coming", () => {
  assert.throws(() => parse("(1 2"), BiomotifError);
  assert.throws(() => parse(")"), BiomotifError);
  assert.equal(balanced("(a b)"), true);
  assert.equal(balanced("(a b"), false);
  assert.equal(balanced('(a ")")'), true);
});

/* ------------------------------------------------------------ alphabets */

test("complement and reverse complement", () => {
  assert.equal(complement("ACGT"), "TGCA");
  assert.equal(revcomp("ACGT"), "ACGT");
  assert.equal(revcomp("AAGCTT"), "AAGCTT", "HindIII site is palindromic");
  assert.equal(revcomp("ATGC"), "GCAT");
  assert.equal(complement("RYSWKMN"), "YRSWMKN", "ambiguity codes complement too");
});

test("RNA keeps its U through complementing", () => {
  assert.equal(complement("ACGU"), "UGCA");
  assert.equal(transcribe("ATGGCT"), "AUGGCU");
});

test("sequence type is guessed from the letters", () => {
  assert.equal(guessType("ATGCATGCATGC"), "dna");
  assert.equal(guessType("AUGCAUGCAUGC"), "rna");
  assert.equal(guessType("MKWVTFISLLLLFSSAYSRG"), "protein");
});

test("IUPAC codes expand and collapse", () => {
  assert.deepEqual(expandIupac("AR"), ["AA", "AG"]);
  assert.equal(expandIupac("NN").length, 16);
  assert.equal(toIupac(new Set(["A", "G"])), "R");
  assert.equal(toIupac(new Set(["A", "C", "G", "T"])), "N");
});

/* -------------------------------------------------------------- literals */

test("a literal is found on both strands", () => {
  assert.deepEqual(spans(search("ACGT", dna("TTACGTTT"))), [[2, 6, "+"]]);
  assert.deepEqual(spans(search("AAAA", dna("TTTTGG"))), [[0, 4, "-"]]);
});

test("a palindromic site is one match, not two", () => {
  const hits = search("GAATTC", dna("TTGAATTCTT"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].strand, "+");
});

test("case and U/T spelling do not matter", () => {
  assert.equal(search("acgt", dna("TTACGTTT")).length, 1);
  assert.equal(search("ACGU", dna("TTACGTTT")).length, 1);
});

test("strand can be restricted", () => {
  assert.deepEqual(search("AAAA", dna("TTTTGG"), { strand: "+" }), []);
  assert.equal(search("AAAA", dna("TTTTGG"), { strand: "-" }).length, 1);
});

/* ----------------------------------------------------------------- IUPAC */

test("IUPAC consensus matches its degenerate positions", () => {
  assert.equal(search(new Iupac("TATAWAWR"), dna("CCTATAAAAGCC"), { strand: "+" }).length, 1);
  assert.deepEqual(search(new Iupac("TATAWAWR"), dna("CCTATTTATGCC"), { strand: "+" }), [],
    "TATTTATG has a T where the consensus demands an A");
});

test("IUPAC rejects a letter that is not a nucleotide code", () => {
  assert.throws(() => new Iupac("ATGZ"), BiomotifError);
});

/* --------------------------------------------------- classes and repeats */

test("character classes", () => {
  assert.equal(search(new AnyOf("AT"), dna("ACAT"), { strand: "+" }).length, 3);
  assert.equal(search(new NoneOf("AT"), dna("ACAT"), { strand: "+" }).length, 1);
  assert.equal(search(new AnyChar(), dna("ACGT"), { strand: "+" }).length, 4);
});

test("a gap of min..max, and nothing outside it", () => {
  const m = new Seq(["ATG", new CharRun(new AnyChar(), 3, 5), "TAG"]);
  assert.deepEqual(texts(search(m, dna("ATGCCCTAG"), { strand: "+" })), ["ATGCCCTAG"]);
  assert.deepEqual(texts(search(m, dna("ATGCCCCCTAG"), { strand: "+" })), ["ATGCCCCCTAG"]);
  assert.deepEqual(search(m, dna("ATGCCCCCCTAG"), { strand: "+" }), [], "a gap of 6 is outside 3..5");
});

test("a greedy gap gives characters back so the tail can match", () => {
  const m = new Seq(["A", new CharRun(new AnyChar(), 0, 10), "TTT"]);
  assert.equal(search(m, dna("ACGTTTGG"), { strand: "+" })[0].seq, "ACGTTT");
});

test("alternatives", () => {
  assert.equal(search(new Alt(["AAA", "GGG"]), dna("AAAGGG"), { strand: "+" }).length, 2);
});

test("repeat honours its bounds and is greedy", () => {
  assert.equal(texts(search(new Repeat(new Literal("CAG"), 3, 4), dna("CAGCAGCAGCAGCAG"),
    { strand: "+" }))[0], "CAGCAGCAGCAG");
  assert.deepEqual(search(new Repeat(new Literal("CAG"), 6), dna("CAGCAG"), { strand: "+" }), []);
});

test("repeat of a zero-width motif terminates", () => {
  const m = new Repeat(new Seq([]), 0, 5);
  assert.ok(Array.isArray(search(m, dna("ACGT"), { strand: "+" })));
});

test("a run of one character class", () => {
  assert.equal(texts(search(new CharRun(new AnyOf("CT"), 4, 8), dna("GGCTCTCTCTGG"),
    { strand: "+" }))[0], "CTCTCTCT");
});

/* ---------------------------------------------------------------- named */

test("named parts come back as bindings", () => {
  const m = new Seq([new Named("a", "ATG"), new CharRun(new AnyChar(), 3, 3), new Named("b", "TAG")]);
  const hit = search(m, dna("ATGCCCTAG"), { strand: "+" })[0];
  assert.equal(hit.bindings.a[2], "ATG");
  assert.equal(hit.bindings.b[2], "TAG");
});

test("bindings on the reverse strand report forward coordinates", () => {
  const m = new Seq([new Named("a", "ATG"), new Named("b", "CCC")]);
  const hit = search(m, dna("TTGGGCATTT"))[0];
  assert.equal(hit.strand, "-");
  assert.equal(hit.bindings.a[2], "ATG");
  assert.ok(hit.bindings.a[0] >= 0 && hit.bindings.a[1] <= 10);
});

/* ------------------------------------------------------- approximate */

test("fuzzy counts mismatches and respects its budget", () => {
  const hits = search(new Fuzzy(1, new Iupac("AGGAGG")), dna("CCAGGAGGTTAGGTGG"), { strand: "+" });
  const by = Object.fromEntries(hits.map((h) => [h.seq, h.extra.mismatches]));
  assert.equal(by.AGGAGG, 0);
  assert.equal(by.AGGTGG, 1);
  assert.deepEqual(search(new Fuzzy(0, "AAAA"), dna("AAAT"), { strand: "+" }), []);
  assert.equal(search(new Fuzzy(1, "AAAA"), dna("AAAT"), { strand: "+" }).length, 1);
});

test("fuzzy refuses a motif whose width is not fixed", () => {
  const m = new Fuzzy(1, new Repeat(new Literal("A"), 1, 4));
  assert.throws(() => search(m, dna("AAAA"), { strand: "+" }), BiomotifError);
});

test("fuzzy sees through a named wrapper", () => {
  const m = new Fuzzy(1, new Named("box", new Iupac("TTGACA")));
  assert.equal(search(m, dna("TTGACA"), { strand: "+" }).length, 1);
});

test("edit distance allows an insertion or deletion", () => {
  const hits = search(new Edit(1, "GAATTC"), dna("GAATC"), { strand: "+" });
  assert.ok(hits.length && hits[0].extra.edits === 1);
});

/* --------------------------------------------------------------- structure */

test("a hairpin needs a stem that really pairs", () => {
  const m = new Hairpin(4, 6, new CharRun(new AnyChar(), 4, 4));
  assert.deepEqual(search(m, dna("AAAATTTTGGGG"), { strand: "+" }), [],
    "AAAA cannot pair with GGGG");
  assert.equal(search(m, dna("GGCCTTTTGGCC"), { strand: "+" }).length, 1,
    "GGCC is its own reverse complement");
});

test("a hairpin reports its stem and loop", () => {
  const stem = "GGGCGC";
  const hit = search(new Hairpin(4, 8, new CharRun(new AnyChar(), 3, 6)),
    dna("AA" + stem + "TTTT" + revcomp(stem) + "AA"), { strand: "+" })[0];
  assert.equal(hit.bindings.stem5[2], stem);
  assert.equal(hit.bindings.loop[2], "TTTT");
  assert.equal(hit.bindings.stem3[2], revcomp(stem));
});

test("G:U wobble pairs only when asked for", () => {
  const seq = dna("GGGG" + "TTTT" + "TCCC");
  assert.deepEqual(search(new Hairpin(4, 4, new CharRun(new AnyChar(), 4, 4)), seq, { strand: "+" }), []);
  assert.equal(search(new Hairpin(4, 4, new CharRun(new AnyChar(), 4, 4), true), seq,
    { strand: "+" }).length, 1);
});

test("anchors", () => {
  assert.equal(search(new Seq([new AtStart(), "AAA"]), dna("AAAGGG"), { strand: "+" }).length, 1);
  assert.deepEqual(search(new Seq([new AtStart(), "GGG"]), dna("AAAGGG"), { strand: "+" }), []);
  assert.equal(search(new Seq(["GGG", new AtEnd()]), dna("AAAGGG"), { strand: "+" }).length, 1);
});

/* -------------------------------------------------------------------- PWM */

test("a weight matrix scores positions by how conserved they are", () => {
  const m = Pwm.fromSites([...Array(9).fill("TATAAA"), "TATAAT"]);
  assert.equal(m.consensus(), "TATAAA");
  assert.equal(m.width, 6);
  assert.ok(m.relative(m.score("TATAAA")) > 0.99);
  assert.ok(m.relative(m.score("GCGCGC")) < 0.2);
  assert.ok(m.score("TATAAT") > m.score("GATAAA"),
    "position 6 varies in the training set, position 1 does not");
});

test("a weight matrix search reports a score", () => {
  const m = Pwm.fromSites(Array(10).fill("TATAAA"), { threshold: 0.9 });
  const hit = search(m, dna("GGGTATAAAGGG"), { strand: "+" })[0];
  assert.equal(hit.seq, "TATAAA");
  assert.ok(typeof hit.score === "number");
});

test("a weight matrix refuses ragged training sites", () => {
  assert.throws(() => Pwm.fromSites(["AAAA", "AAA"]), BiomotifError);
});

/* ----------------------------------------------------------------- search */

test("whole-string matching", () => {
  assert.equal(matchesFull(new Iupac("ATGN"), "ATGC"), true);
  assert.equal(matchesFull(new Iupac("ATG"), "ATGC"), false);
});

test("overlap and limit", () => {
  assert.equal(search("AA", dna("AAAA"), { strand: "+" }).length, 3);
  assert.equal(search("AA", dna("AAAA"), { strand: "+", overlap: false }).length, 2);
  assert.equal(search("A", dna("AAAAA"), { strand: "+", limit: 2 }).length, 2);
});

test("matches sort by position, forward strand before reverse", () => {
  const hits = search(new Iupac("ATGCAT"), dna("TTATGCATTT"));
  assert.deepEqual(hits.map((h) => h.strand), ["+"], "a palindrome collapses to one row");
  const two = search(new Iupac("CANNTG"), dna("CAGGTGAAACACCTG"));
  const forwardFirst = two.filter((h) => h.start === two[0].start).map((h) => h.strand);
  assert.equal(forwardFirst[0], "+");
});

test("a sub-record keeps its offset into the parent", () => {
  const r = new Record("chr", "TTTTGAATTCTTTT");
  const sub = r.sub(2, 12);
  const hit = search("GAATTC", sub)[0];
  assert.equal(hit.start, 2, "relative to the sub-record");
  assert.equal(hit.absStart, 4, "relative to the parent");
});

test("collapse keeps one match per overlapping cluster", () => {
  const m = new CharRun(new AnyOf("CT"), 4, 20);
  const hits = search(m, dna("GGCTCTCTCTCTGG"), { strand: "+" });
  assert.ok(hits.length > 1);
  const kept = collapse(hits);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].seq, "CTCTCTCTCT");
});

/* ------------------------------------------------------------------ FASTA */

test("FASTA round trip", () => {
  const recs = [new Record("a", "ACGT".repeat(30), null, { description: "first" }),
                new Record("b", "TTTT")];
  const back = parseFasta(formatFasta(recs));
  assert.deepEqual(back.map((r) => r.name), ["a", "b"]);
  assert.equal(back[0].seq, "ACGT".repeat(30));
  assert.equal(back[0].description, "first");
});

test("FASTA skips comment lines and accepts a bare sequence", () => {
  assert.equal(parseFasta("; a note\n>one\nACGT\nACGT\n>two\nTTTT\n").length, 2);
  const bare = parseFasta("ACGTACGT\nACGT");
  assert.equal(bare.length, 1);
  assert.equal(bare[0].seq, "ACGTACGTACGT");
});

test("protein records are searched on one strand only", () => {
  const hits = search("MKW", protein("AAMKWAA"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].strand, "+");
});
