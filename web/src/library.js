/* Loading the .mtf motif library, restriction digests, and the sequence
   utilities the interface needs. The .mtf files are the single source of
   truth and are parsed here verbatim: no build step rewrites them. */

import {
  Alt, AnyChar, AnyOf, AtEnd, AtStart, BiomotifError, CharRun, Edit, Fuzzy, Hairpin,
  Iupac, Literal, Matcher, Named, NoneOf, Pwm, Regex, Repeat, Seq, Sym, Tagged,
  expandIupac, parse, parseAll, prosite, revcomp, search,
} from "./engine.js";

/* --------------------------------------------------- motif from s-expression */

/** The name in `'promoter`, `:promoter` or `promoter`. Quote reads as a list. */
function nameOf(x) {
  if (Array.isArray(x) && x.length === 2 && x[0] instanceof Sym && x[0].name === "quote") x = x[1];
  return x instanceof Sym ? x.name.replace(/^:/, "") : String(x);
}

/** Turn a motif s-expression into a matcher. Constructors only: no variables,
    no lambdas. A bare symbol names a library motif or an anchor. */
export function buildMotif(form, registry = null) {
  if (typeof form === "string") return new Literal(form);
  if (form instanceof Matcher) return form;
  if (form instanceof Sym) {
    if (form.name === "at-start") return new AtStart();
    if (form.name === "at-end") return new AtEnd();
    if (form.name === "any") return new AnyChar();
    const entry = registry?.get(form.name);
    if (entry) return entry.matcher;
    throw new BiomotifError(`unknown motif name: ${form.name}`);
  }
  if (!Array.isArray(form)) throw new BiomotifError(`not a motif: ${form}`);
  if (!form.length) throw new BiomotifError("empty motif");
  const head = form[0];
  if (!(head instanceof Sym)) throw new BiomotifError(`a motif must start with a name, got ${head}`);
  const op = head.name;
  const { args, kw } = splitArgs(form.slice(1));
  const M = (x) => buildMotif(x, registry);
  const int = (x, what) => {
    if (typeof x !== "number") throw new BiomotifError(`${op}: ${what} must be a number, got ${x}`);
    return x;
  };
  const str = (x, what) => {
    if (typeof x !== "string") throw new BiomotifError(`${op}: ${what} must be a string in quotes, got ${x}`);
    return x;
  };

  switch (op) {
    case "quote": return M(args[0]);
    case "seq": return new Seq(args.map(M));
    case "alt": return new Alt(args.flatMap((a) => (Array.isArray(a) && a[0] instanceof Sym ? [M(a)] : Array.isArray(a) ? a.map(M) : [M(a)])));
    case "literal": return new Literal(str(args[0], "the sequence"));
    case "iupac": case "dna": case "rna": return new Iupac(str(args[0], "the pattern"));
    case "prosite": case "protein": return prosite(str(args[0], "the pattern"));
    case "regex": return new Regex(str(args[0], "the pattern"));
    case "any-of": return new AnyOf(str(args[0], "the characters"));
    case "none-of": return new NoneOf(str(args[0], "the characters"));
    case "any": return new AnyChar();
    case "gap": {
      const lo = int(args[0], "the minimum");
      const hi = args.length > 1 ? int(args[1], "the maximum") : lo;
      return new CharRun(new AnyChar(), lo, hi, `(gap ${lo} ${hi})`);
    }
    case "run": {
      const chars = str(args[0], "the characters");
      const lo = args.length > 1 ? int(args[1], "the minimum") : 1;
      const hi = args.length > 2 ? int(args[2], "the maximum") : null;
      return new CharRun(new AnyOf(chars), lo, hi, `(run "${chars}" ${lo}${hi === null ? "" : " " + hi})`);
    }
    case "repeat": {
      const inner = M(args[0]);
      const lo = args.length > 1 ? int(args[1], "the minimum") : 0;
      const hi = args.length > 2 ? int(args[2], "the maximum") : null;
      if (inner instanceof AnyOf || inner instanceof NoneOf || inner instanceof AnyChar) {
        return new CharRun(inner, lo, hi);
      }
      return new Repeat(inner, lo, hi);
    }
    case "opt": return new Repeat(M(args[0]), 0, 1);
    case "exactly": { const n = int(args[1], "the count"); return new Repeat(M(args[0]), n, n); }
    case "named": return new Named(nameOf(args[0]), M(args[1]));
    case "fuzzy": return new Fuzzy(int(args[0], "the mismatch budget"), M(args[1]));
    case "edit": return new Edit(int(args[0], "the edit budget"), str(args[1], "the sequence"));
    case "revcomp-motif": return new Literal(revcomp(str(args[0], "the sequence")));
    case "n-terminal": return new Seq([new AtStart(), M(args[0])]);
    case "c-terminal": return new Seq([M(args[0]), new AtEnd()]);
    case "stem": return { stem: [int(args[0], "the minimum"), args.length > 1 ? int(args[1], "the maximum") : int(args[0], "the maximum")] };
    case "loop":
      if (typeof args[0] === "number") {
        const lo = args[0], hi = args.length > 1 ? args[1] : lo;
        return new CharRun(new AnyChar(), lo, hi, `(loop ${lo} ${hi})`);
      }
      return M(args[0]);
    case "hairpin": {
      // Check the shape before recursing, so a wrong first argument is named
      // for what it is rather than reported as "not a motif".
      const head0 = Array.isArray(args[0]) ? args[0][0] : null;
      if (!(head0 instanceof Sym) || head0.name !== "stem") {
        throw new BiomotifError("hairpin: the first argument must be (stem min max)");
      }
      const stem = buildMotif(args[0], registry);
      const loop = typeof args[1] === "number"
        ? new CharRun(new AnyChar(), args[1], args[2] ?? args[1])
        : M(args[1]);
      return new Hairpin(stem.stem[0], stem.stem[1], loop, !!kw.wobble, kw.mismatches ?? 0);
    }
    case "pwm-from-sites":
      return Pwm.fromSites((args[0] || []).map((s) => str(s, "each site")),
        { threshold: kw.threshold ?? 0.8, pseudocount: kw.pseudocount ?? 0.5 });
    case "pwm": {
      const matrix = {};
      for (const row of args[0]) matrix[nameOf(row[0])] = row.slice(1);
      return new Pwm(matrix, kw.threshold ?? 0.8);
    }
    default:
      throw new BiomotifError(`unknown motif form: (${op} ...)`);
  }
}

function splitArgs(items) {
  const args = [], kw = {};
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a instanceof Sym && a.name.startsWith(":") && a.name.length > 1 && i + 1 < items.length) {
      kw[a.name.slice(1).replace(/-/g, "_")] = items[++i];
    } else args.push(a);
  }
  return { args, kw };
}

/* ------------------------------------------------------------ restriction */

const TYPE_IIS = /^([ACGTRYSWKMBDHVN]+)\((-?\d+)\/(-?\d+)\)$/i;

export function parseSite(spec) {
  const s = spec.trim().toUpperCase();
  const m = TYPE_IIS.exec(s);
  if (m) {
    const site = m[1];
    return { site, cutTop: site.length + parseInt(m[2], 10), cutBottom: site.length + parseInt(m[3], 10), kind: "IIS" };
  }
  const site = s.replace(/\^/g, "").replace(/_/g, "");
  if (!s.includes("^")) throw new BiomotifError(`restriction site ${spec} has no cut mark (^)`);
  const top = s.indexOf("^");
  const bottom = s.includes("_") ? s.replace("^", "").indexOf("_") : site.length - top;
  return { site, cutTop: top, cutBottom: bottom, kind: "II" };
}

export function overhang(info) {
  const d = info.cutBottom - info.cutTop;
  if (d === 0) return "blunt";
  return d > 0 ? `5' overhang of ${d}` : `3' overhang of ${-d}`;
}

export function digest(record, enzymes, { circular = false } = {}) {
  const n = record.seq.length;
  const sites = [];
  const cuts = new Set();
  for (const { name, info } of enzymes) {
    const pal = info.site === revcomp(info.site);
    const hits = search(new Iupac(info.site), record, { strand: pal ? "+" : "both", name });
    const seen = new Set();
    for (const h of hits) {
      const top = h.strand === "+" ? h.start + info.cutTop : h.end - info.cutBottom;
      const bottom = h.strand === "+" ? h.start + info.cutBottom : h.end - info.cutTop;
      const key = `${h.start}:${top}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!circular && (top < 0 || top > n)) continue;
      const topPos = circular ? ((top % n) + n) % n : top;
      sites.push({ enzyme: name, start: h.start, end: h.end, strand: h.strand, cutTop: topPos, cutBottom: bottom });
      cuts.add(topPos);
    }
  }
  const cutList = [...cuts].filter((c) => c >= 0 && c <= n).sort((a, b) => a - b);
  const fragments = [];
  if (circular) {
    if (!cutList.length) fragments.push([0, n, n]);
    else {
      for (let k = 0; k + 1 < cutList.length; k++) fragments.push([cutList[k], cutList[k + 1], cutList[k + 1] - cutList[k]]);
      const first = cutList[0], last = cutList[cutList.length - 1];
      fragments.push([last, first, n - last + first]);
    }
  } else {
    const bounds = [0, ...cutList.filter((c) => c > 0 && c < n), n];
    for (let k = 0; k + 1 < bounds.length; k++) fragments.push([bounds[k], bounds[k + 1], bounds[k + 1] - bounds[k]]);
  }
  sites.sort((a, b) => a.start - b.start || a.enzyme.localeCompare(b.enzyme));
  return { sites, cuts: cutList, fragments };
}

/** One concrete sequence the enzyme cuts. Expanding every ambiguity would
    explode for sites like CCANNNNNNNNNTGG, and one instance is all a
    documented example needs. */
function concreteSite(site) {
  return [...site].map((c) => (IUPAC_SITE[c] || c)[0]).join("");
}
const IUPAC_SITE = { A: "A", C: "C", G: "G", T: "T", U: "T", R: "A", Y: "C", S: "C", W: "A",
  K: "G", M: "A", B: "C", D: "A", H: "A", V: "A", N: "A" };

/* --------------------------------------------------------------- registry */

export class Registry {
  constructor() { this.entries = new Map(); }
  get(name) { return this.entries.get(name); }
  get size() { return this.entries.size; }
  all() { return [...this.entries.values()]; }
  categories() { return [...new Set(this.all().map((e) => e.category))].sort(); }
  find({ category = null, alphabet = null, text = null } = {}) {
    const t = text ? text.toLowerCase() : null;
    return this.all().filter((e) =>
      (!category || e.category === category) &&
      (!alphabet || e.alphabet === alphabet) &&
      (!t || e.name.toLowerCase().includes(t) || e.doc.toLowerCase().includes(t) ||
        e.category.includes(t) || (e.ref || "").toLowerCase().includes(t)));
  }
}

const PROTEIN_CATEGORIES = new Set(["protein", "targeting", "modification", "protease", "tag",
  "domain", "binding-site", "catalytic", "degradation", "linker"]);
const RNA_CATEGORIES = new Set(["rna", "rna-structure", "utr", "splicing-rna", "mirna",
  "riboswitch", "trna", "recoding", "stability", "localisation", "ires", "small-rna", "viral"]);

function defaultAlphabet(category) {
  if (PROTEIN_CATEGORIES.has(category)) return "protein";
  if (RNA_CATEGORIES.has(category)) return "rna";
  return "dna";
}

/** Whether a matcher's description can be read back as the same matcher. Most
    can; a weight matrix cannot, because its description is a summary. */
function roundTrips(matcher, registry) {
  try {
    return buildMotif(parse(matcher.describe()), registry).describe() === matcher.describe();
  } catch {
    return false;
  }
}

/** Read one .mtf source file into the registry. */
export function loadLibrarySource(source, text, registry) {
  const errors = [];
  for (const form of parseAll(text)) {
    if (!Array.isArray(form) || !(form[0] instanceof Sym)) continue;
    const kindOfForm = form[0].name;
    try {
      if (kindOfForm === "defmotif") {
        const name = nameOf(form[1]);
        let rest = form.slice(2);
        let doc = "";
        if (rest.length > 1 && typeof rest[0] === "string") doc = rest.shift();
        const { args, kw } = splitArgs(rest);
        if (!args.length) throw new BiomotifError("no motif given");
        const matcher = new Tagged(buildMotif(args[0], registry), name);
        const category = kw.category ? nameOf(kw.category) : "misc";
        registry.entries.set(name, {
          name, matcher, source,
          doc: doc.replace(/\s+/g, " ").trim(),
          ref: kw.ref || "",
          category,
          alphabet: kw.alphabet ? nameOf(kw.alphabet) : defaultAlphabet(category),
          example: kw.example || null,
          scan: kw.scan !== false,
          pattern: matcher.describe(),
          // What to put in the editor when this entry is picked. A matrix
          // describes itself as a summary, not as source — its real form is
          // four rows of numbers — so it is referred to by name instead.
          editorSource: roundTrips(matcher, registry) ? matcher.describe() : name,
          meta: null,
        });
      } else if (kindOfForm === "defenzyme") {
        const name = nameOf(form[1]);
        const info = parseSite(form[2]);
        const matcher = new Tagged(new Iupac(info.site), name);
        registry.entries.set(name, {
          name, matcher, source,
          doc: `Recognition site ${form[2]}, ${overhang(info)}.`,
          ref: "", category: "restriction", alphabet: "dna",
          example: concreteSite(info.site),
          scan: true, pattern: matcher.describe(), editorSource: matcher.describe(), meta: info,
        });
      }
    } catch (e) {
      errors.push(`${source}: ${nameOf(form[1])}: ${e.message}`);
    }
  }
  return errors;
}

/* --------------------------------------------------- sequence utilities */

const BASES = "TCAG";
const STANDARD = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
const VERT_MITO = "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG";
const BACTERIAL = STANDARD;

function buildCodonTable(aa) {
  const table = {};
  let i = 0;
  for (const a of BASES) for (const b of BASES) for (const c of BASES) table[a + b + c] = aa[i++];
  return table;
}
export const CODON_TABLES = { 1: buildCodonTable(STANDARD), 2: buildCodonTable(VERT_MITO), 11: buildCodonTable(BACTERIAL) };
export const TABLE_NAMES = { 1: "standard", 2: "vertebrate mitochondrial", 11: "bacterial and plastid" };
export const START_CODONS = { 1: ["ATG"], 2: ["ATT", "ATC", "ATA", "ATG", "GTG"], 11: ["ATG", "GTG", "TTG"] };

function ambiguousCodon(codon, table) {
  let options = [""];
  for (const c of codon) {
    const bases = IUPAC_LOCAL[c];
    if (!bases) return "X";
    options = options.flatMap((o) => [...bases].map((b) => o + b));
  }
  const aas = new Set(options.map((o) => table[o]));
  return aas.size === 1 ? [...aas][0] : "X";
}
const IUPAC_LOCAL = { A: "A", C: "C", G: "G", T: "T", U: "T", R: "AG", Y: "CT", S: "CG", W: "AT",
  K: "GT", M: "AC", B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT" };

export function translate(seq, { table = 1, frame = 0, toStop = false, startAsMet = false } = {}) {
  const tbl = CODON_TABLES[table] || CODON_TABLES[1];
  const s = seq.toUpperCase().replace(/U/g, "T");
  let out = "";
  for (let i = frame; i + 3 <= s.length; i += 3) {
    const codon = s.slice(i, i + 3);
    let aa = tbl[codon] ?? ambiguousCodon(codon, tbl);
    if (startAsMet && !out && (START_CODONS[table] || ["ATG"]).includes(codon)) aa = "M";
    if (aa === "*" && toStop) break;
    out += aa;
  }
  return out;
}

export function gcContent(seq) {
  const s = seq.toUpperCase();
  let n = 0, gc = 0;
  for (const c of s) {
    if ("ACGTU".includes(c)) n++;
    if ("GCS".includes(c)) gc++;
  }
  return n ? gc / n : 0;
}

export function meltingTemp(seq) {
  const s = seq.toUpperCase().replace(/U/g, "T");
  const n = s.length;
  if (!n) return 0;
  let at = 0, gc = 0;
  for (const c of s) { if ("AT".includes(c)) at++; else if ("GC".includes(c)) gc++; }
  if (n < 14) return 2 * at + 4 * gc;
  return 64.9 + (41 * (gc - 16.4)) / n;
}

export function orfs(seq, { minLength = 90, table = 11, bothStrands = true } = {}) {
  const tbl = CODON_TABLES[table] || CODON_TABLES[1];
  const starts = START_CODONS[table] || ["ATG"];
  const s = seq.toUpperCase().replace(/U/g, "T");
  const n = s.length;
  const out = [];
  const strands = bothStrands ? [["+", s], ["-", revcomp(s)]] : [["+", s]];
  for (const [strand, text] of strands) {
    for (let frame = 0; frame < 3; frame++) {
      let i = frame;
      while (i + 3 <= n) {
        if (starts.includes(text.slice(i, i + 3))) {
          let j = i + 3;
          while (j + 3 <= n && tbl[text.slice(j, j + 3)] !== "*") j += 3;
          if (j + 3 <= n) {
            const end = j + 3;
            if (end - i >= minLength) {
              const [fs, fe] = strand === "+" ? [i, end] : [n - end, n - i];
              out.push({ start: fs, end: fe, strand, frame,
                seq: text.slice(i, end),
                protein: translate(text.slice(i, end), { table, toStop: true, startAsMet: true }) });
            }
            i = end;
            continue;
          }
        }
        i += 3;
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}
