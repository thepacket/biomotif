/* Biomotif engine: s-expression reader, motif combinators, search.
   No dependencies. The matchers are generators, so backtracking is the
   generator protocol: Seq asks an earlier part for its next alternative
   whenever a later part fails. */

/* ------------------------------------------------------------------ reader */

export class Sym {
  constructor(name) { this.name = name; }
  toString() { return this.name; }
}
const SYMS = new Map();
export function sym(name) {
  let s = SYMS.get(name);
  if (!s) { s = new Sym(name); SYMS.set(name, s); }
  return s;
}
export const isSym = (x, name) => x instanceof Sym && (name === undefined || x.name === name);

const TOKEN = /\s*(?:(;[^\n]*)|(['`])|("(?:\\.|[^\\"])*")|([^\s()'`";]+)|([()]))/y;

export function tokenize(src) {
  const out = [];
  let pos = 0, line = 1;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) {
      if (!src.slice(pos).trim()) break;
      throw new BiomotifError(`line ${line}: cannot read ${JSON.stringify(src.slice(pos, pos + 20))}`);
    }
    line += (src.slice(pos, m.index + m[0].length).match(/\n/g) || []).length;
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) continue;            // comment
    out.push([m[2] ?? m[3] ?? m[4] ?? m[5], line]);
  }
  return out;
}

export class BiomotifError extends Error {}

function unescape(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && i + 1 < body.length) {
      const c = body[++i];
      out += c === "n" ? "\n" : c === "t" ? "\t" : c;
    } else out += body[i];
  }
  return out;
}

function atom(tok) {
  // Library docstrings run across several lines, so raw newlines are legal here.
  if (tok[0] === '"') return unescape(tok.slice(1, -1));
  if (/^[+-]?\d+$/.test(tok)) return parseInt(tok, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return parseFloat(tok);
  if (tok === "#t") return true;
  if (tok === "#f") return false;
  return sym(tok);
}

class Reader {
  constructor(src) { this.toks = tokenize(src); this.i = 0; }
  peek() { return this.i < this.toks.length ? this.toks[this.i] : null; }
  next() { return this.i < this.toks.length ? this.toks[this.i++] : null; }
  read() {
    const t = this.next();
    if (!t) throw new BiomotifError("unexpected end of input");
    const [tok, line] = t;
    if (tok === "(") {
      const items = [];
      for (;;) {
        const nxt = this.peek();
        if (!nxt) throw new BiomotifError(`line ${line}: missing ')'`);
        if (nxt[0] === ")") { this.next(); return items; }
        items.push(this.read());
      }
    }
    if (tok === ")") throw new BiomotifError(`line ${line}: unexpected ')'`);
    if (tok === "'" || tok === "`") return [sym("quote"), this.read()];
    return atom(tok);
  }
}

export function parse(src) {
  const r = new Reader(src);
  const form = r.read();
  if (r.peek()) throw new BiomotifError("more than one expression");
  return form;
}

export function parseAll(src) {
  const r = new Reader(src);
  const forms = [];
  while (r.peek()) forms.push(r.read());
  return forms;
}

export function balanced(src) {
  let depth = 0;
  try {
    for (const [tok] of tokenize(src)) {
      if (tok === "(") depth++;
      else if (tok === ")") depth--;
    }
  } catch { return false; }
  return depth === 0;
}

/* -------------------------------------------------------------- alphabets */

export const IUPAC = {
  A: "A", C: "C", G: "G", T: "T", U: "T",
  R: "AG", Y: "CT", S: "CG", W: "AT", K: "GT", M: "AC",
  B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT",
};
export const AMINO = "ACDEFGHIKLMNPQRSTVWY";

const COMP_DNA = { A: "T", C: "G", G: "C", T: "A", U: "A", R: "Y", Y: "R", S: "S", W: "W",
                   K: "M", M: "K", B: "V", D: "H", H: "D", V: "B", N: "N", "-": "-" };

export function complement(seq) {
  const rna = /U/i.test(seq) && !/T/i.test(seq);
  let out = "";
  for (const ch of seq) {
    const up = ch.toUpperCase();
    let c = COMP_DNA[up] ?? "N";
    if (rna && c === "T") c = "U";
    out += ch === up ? c : c.toLowerCase();
  }
  return out;
}
export const revcomp = (seq) => [...complement(seq)].reverse().join("");
export const transcribe = (seq) => seq.replace(/T/g, "U").replace(/t/g, "u");

export function normalize(seq, kind) {
  const s = seq.toUpperCase();
  return (kind === "dna" || kind === "rna") ? s.replace(/U/g, "T") : s;
}

export function guessType(seq) {
  const s = seq.toUpperCase().replace(/[\s\-*.]/g, "");
  if (!s) return "dna";
  const letters = new Set(s);
  let nuc = 0;
  for (const c of s) if ("ACGTUN".includes(c)) nuc++;
  if (nuc / s.length > 0.9) return (letters.has("U") && !letters.has("T")) ? "rna" : "dna";
  return "protein";
}

export function expandIupac(pattern) {
  let out = [""];
  for (const c of pattern.toUpperCase()) {
    const bases = IUPAC[c] ?? c;
    const next = [];
    for (const r of out) for (const b of bases) next.push(r + b);
    out = next;
    if (out.length > 4096) break;
  }
  return out;
}

export function toIupac(bases) {
  const key = [...new Set([...bases].map((b) => (b === "U" ? "T" : b)))].sort().join("");
  for (const [code, members] of Object.entries(IUPAC)) {
    if (code !== "U" && [...members].sort().join("") === key) return code;
  }
  return "N";
}

/* -------------------------------------------------------------- matchers */

const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';

export class Matcher {
  * matchAt() {}
  describe() { return "#<matcher>"; }
  firstSet() { return null; }
  /** How many characters a match can span, as [min, max]; max may be Infinity.
      This describes a motif for the reader; the matcher never consults it. */
  span() { return [0, Infinity]; }
}

export class Literal extends Matcher {
  constructor(text) {
    super();
    if (typeof text !== "string") throw new BiomotifError(`literal needs a string, got ${text}`);
    this.text = text;
    this.nuc = text.toUpperCase().replace(/U/g, "T");
    this.prot = text.toUpperCase();
  }
  pattern(ctx) { return ctx.nuc ? this.nuc : this.prot; }
  * matchAt(ctx, i, binds) {
    const p = this.pattern(ctx);
    if (ctx.seq.startsWith(p, i)) yield [i + p.length, binds];
  }
  firstSet(ctx) { const p = this.pattern(ctx); return p ? new Set([p[0]]) : null; }
  span() { return [this.text.length, this.text.length]; }
  describe() { return q(this.text); }
}

export class Iupac extends Matcher {
  constructor(text) {
    super();
    this.text = text;
    this.sets = [...text.toUpperCase()].map((c) => {
      const bases = IUPAC[c];
      if (!bases) throw new BiomotifError(`iupac: ${JSON.stringify(c)} is not a nucleotide code in ${q(text)}`);
      return new Set(bases);
    });
  }
  * matchAt(ctx, i, binds) {
    const n = this.sets.length;
    if (i + n > ctx.seq.length) return;
    for (let k = 0; k < n; k++) if (!this.sets[k].has(ctx.seq[i + k])) return;
    yield [i + n, binds];
  }
  firstSet() { return this.sets.length ? new Set(this.sets[0]) : null; }
  span() { return [this.sets.length, this.sets.length]; }
  describe() { return `(iupac ${q(this.text)})`; }
}

export class AnyOf extends Matcher {
  constructor(chars) {
    super();
    this.chars = chars;
    this.nuc = new Set(chars.toUpperCase().replace(/U/g, "T"));
    this.prot = new Set(chars.toUpperCase());
  }
  set(ctx) { return ctx.nuc ? this.nuc : this.prot; }
  accepts(ctx, c) { return this.set(ctx).has(c); }
  * matchAt(ctx, i, binds) { if (i < ctx.seq.length && this.set(ctx).has(ctx.seq[i])) yield [i + 1, binds]; }
  firstSet(ctx) { return new Set(this.set(ctx)); }
  span() { return [1, 1]; }
  describe() { return `(any-of ${q(this.chars)})`; }
}

export class NoneOf extends Matcher {
  constructor(chars) {
    super();
    this.chars = chars;
    this.nuc = new Set(chars.toUpperCase().replace(/U/g, "T"));
    this.prot = new Set(chars.toUpperCase());
  }
  set(ctx) { return ctx.nuc ? this.nuc : this.prot; }
  accepts(ctx, c) { return !this.set(ctx).has(c); }
  * matchAt(ctx, i, binds) { if (i < ctx.seq.length && !this.set(ctx).has(ctx.seq[i])) yield [i + 1, binds]; }
  span() { return [1, 1]; }
  describe() { return `(none-of ${q(this.chars)})`; }
}

export class AnyChar extends Matcher {
  accepts() { return true; }
  * matchAt(ctx, i, binds) { if (i < ctx.seq.length) yield [i + 1, binds]; }
  span() { return [1, 1]; }
  describe() { return "any"; }
}

export class Seq extends Matcher {
  constructor(parts) { super(); this.parts = parts.map(coerce); }
  * matchAt(ctx, i, binds) {
    const parts = this.parts;
    if (!parts.length) { yield [i, binds]; return; }
    const stack = [parts[0].matchAt(ctx, i, binds)];
    while (stack.length) {
      const k = stack.length - 1;
      const step = stack[k].next();
      if (step.done) { stack.pop(); continue; }
      const [j, b] = step.value;
      if (k + 1 === parts.length) yield [j, b];
      else stack.push(parts[k + 1].matchAt(ctx, j, b));
    }
  }
  firstSet(ctx) { return this.parts.length ? this.parts[0].firstSet(ctx) : null; }
  span() {
    return this.parts.reduce(([lo, hi], p) => {
      const [a, b] = p.span();
      return [lo + a, hi + b];
    }, [0, 0]);
  }
  describe() { return "(seq " + this.parts.map((p) => p.describe()).join(" ") + ")"; }
}

export class Alt extends Matcher {
  constructor(parts) { super(); this.parts = parts.map(coerce); }
  * matchAt(ctx, i, binds) { for (const p of this.parts) yield* p.matchAt(ctx, i, binds); }
  firstSet(ctx) {
    const out = new Set();
    for (const p of this.parts) {
      const fs = p.firstSet(ctx);
      if (!fs) return null;
      for (const c of fs) out.add(c);
    }
    return out;
  }
  span() {
    const w = this.parts.map((p) => p.span());
    return [Math.min(...w.map((x) => x[0])), Math.max(...w.map((x) => x[1]))];
  }
  describe() { return "(alt " + this.parts.map((p) => p.describe()).join(" ") + ")"; }
}

export class Repeat extends Matcher {
  constructor(inner, min = 0, max = null) {
    super();
    this.inner = coerce(inner);
    this.min = min;
    this.max = max;
    if (max !== null && max < min) throw new BiomotifError("repeat: max is smaller than min");
  }
  static advance(gen, pos) {
    for (;;) {
      const step = gen.next();
      if (step.done) return null;
      if (step.value[0] !== pos) return step.value;   // skip zero-width, it would loop
    }
  }
  * matchAt(ctx, i, binds) {
    const max = this.max === null ? Infinity : this.max;
    const stack = [];
    let pos = i, b = binds;
    for (;;) {
      if (stack.length < max) {
        const gen = this.inner.matchAt(ctx, pos, b);
        const nxt = Repeat.advance(gen, pos);
        if (nxt) { stack.push([gen, pos, b]); [pos, b] = nxt; continue; }
      }
      if (stack.length >= this.min) yield [pos, b];
      let resumed = false;
      while (stack.length) {
        const [gen, ppos, pb] = stack[stack.length - 1];
        const nxt = Repeat.advance(gen, ppos);
        if (nxt) { [pos, b] = nxt; resumed = true; break; }
        stack.pop();
        pos = ppos; b = pb;
        if (stack.length >= this.min) yield [pos, b];
      }
      if (!resumed) return;
    }
  }
  firstSet(ctx) { return this.min > 0 ? this.inner.firstSet(ctx) : null; }
  span() {
    const [a, b] = this.inner.span();
    return [a * this.min, this.max === null ? Infinity : b * this.max];
  }
  describe() {
    const mx = this.max === null ? "" : ` ${this.max}`;
    return `(repeat ${this.inner.describe()} ${this.min}${mx})`;
  }
}

/** Fast path for repeating a single-character class: (gap 20 35), (run "AT" 4 8). */
export class CharRun extends Matcher {
  constructor(cls, min = 0, max = null, label = null) {
    super(); this.cls = cls; this.min = min; this.max = max; this.label = label;
  }
  * matchAt(ctx, i, binds) {
    const seq = ctx.seq;
    const limit = this.max === null ? seq.length - i : Math.min(this.max, seq.length - i);
    let count = 0;
    while (count < limit && this.cls.accepts(ctx, seq[i + count])) count++;
    for (let k = count; k >= this.min; k--) yield [i + k, binds];
  }
  firstSet(ctx) { return this.min > 0 ? this.cls.firstSet(ctx) : null; }
  span() { return [this.min, this.max === null ? Infinity : this.max]; }
  describe() {
    if (this.label) return this.label;
    const mx = this.max === null ? "" : ` ${this.max}`;
    return `(repeat ${this.cls.describe()} ${this.min}${mx})`;
  }
}

export class Named extends Matcher {
  constructor(label, inner) { super(); this.label = label; this.inner = coerce(inner); }
  * matchAt(ctx, i, binds) {
    for (const [j, b] of this.inner.matchAt(ctx, i, binds)) {
      yield [j, { ...b, [this.label]: [i, j] }];
    }
  }
  firstSet(ctx) { return this.inner.firstSet(ctx); }
  span() { return this.inner.span(); }
  describe() { return `(named '${this.label} ${this.inner.describe()})`; }
}

function positionSets(m, ctx) {
  if (m instanceof Literal) return [...m.pattern(ctx)].map((c) => new Set([c]));
  if (m instanceof Iupac) return m.sets;
  if (m instanceof AnyOf) return [m.set(ctx)];
  if (m instanceof AnyChar) return [null];
  if (m instanceof Tagged || m instanceof Named) return positionSets(m.inner, ctx);
  if (m instanceof Seq) {
    const out = [];
    for (const p of m.parts) {
      const ps = positionSets(p, ctx);
      if (!ps) return null;
      out.push(...ps);
    }
    return out;
  }
  if (m instanceof CharRun && m.max === m.min && (m.cls instanceof AnyOf || m.cls instanceof AnyChar)) {
    const one = positionSets(m.cls, ctx);
    return one ? Array(m.min).fill(one[0]) : null;
  }
  return null;
}

export class Fuzzy extends Matcher {
  constructor(k, inner) { super(); this.k = k; this.inner = coerce(inner); this.cache = new Map(); }
  sets(ctx) {
    if (!this.cache.has(ctx.nuc)) {
      const ps = positionSets(this.inner, ctx);
      if (!ps) throw new BiomotifError("fuzzy needs a fixed-width motif (a literal, iupac, any-of, or a seq of those)");
      this.cache.set(ctx.nuc, ps);
    }
    return this.cache.get(ctx.nuc);
  }
  * matchAt(ctx, i, binds) {
    const sets = this.sets(ctx);
    const n = sets.length;
    if (i + n > ctx.seq.length) return;
    let errors = 0;
    for (let p = 0; p < n; p++) {
      if (sets[p] && !sets[p].has(ctx.seq[i + p])) {
        if (++errors > this.k) return;
      }
    }
    yield [i + n, { ...binds, $mismatches: (binds.$mismatches || 0) + errors }];
  }
  span() { return this.inner.span(); }
  describe() { return `(fuzzy ${this.k} ${this.inner.describe()})`; }
}

export class Edit extends Matcher {
  constructor(k, text) { super(); this.k = k; this.lit = new Literal(text); }
  * matchAt(ctx, i, binds) {
    const p = this.lit.pattern(ctx);
    const window = ctx.seq.slice(i, i + p.length + this.k);
    let prev = Array.from({ length: window.length + 1 }, (_, c) => c);
    for (let r = 1; r <= p.length; r++) {
      const cur = [r];
      for (let c = 1; c <= window.length; c++) {
        const cost = p[r - 1] === window[c - 1] ? 0 : 1;
        cur.push(Math.min(prev[c] + 1, cur[c - 1] + 1, prev[c - 1] + cost));
      }
      prev = cur;
    }
    const ends = [];
    for (let c = 1; c <= window.length; c++) if (prev[c] <= this.k) ends.push([prev[c], c]);
    ends.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const seen = new Set();
    for (const [d, c] of ends) {
      if (seen.has(c)) continue;
      seen.add(c);
      yield [i + c, { ...binds, $edits: (binds.$edits || 0) + d }];
    }
  }
  span() { const n = this.lit.text.length; return [Math.max(0, n - this.k), n + this.k]; }
  describe() { return `(edit ${this.k} ${q(this.lit.text)})`; }
}

const PAIRS = new Set(["AT", "TA", "GC", "CG"]);
const WOBBLE = new Set(["GT", "TG"]);

export class Hairpin extends Matcher {
  constructor(stemMin, stemMax, loop, wobble = false, mismatches = 0) {
    super();
    this.stemMin = stemMin; this.stemMax = stemMax;
    this.loop = coerce(loop); this.wobble = wobble; this.mismatches = mismatches;
  }
  pairs(a, b) {
    let errors = 0;
    for (let k = 0; k < a.length; k++) {
      const p = a[k] + b[b.length - 1 - k];
      if (!PAIRS.has(p) && !(this.wobble && WOBBLE.has(p))) {
        if (++errors > this.mismatches) return false;
      }
    }
    return true;
  }
  * matchAt(ctx, i, binds) {
    const seq = ctx.seq, n = seq.length;
    for (let L = this.stemMax; L >= this.stemMin; L--) {
      if (i + 2 * L > n) continue;
      const stem = seq.slice(i, i + L);
      for (const [j, b] of this.loop.matchAt(ctx, i + L, binds)) {
        if (j + L > n) continue;
        if (this.pairs(stem, seq.slice(j, j + L))) {
          yield [j + L, { ...b, stem5: [i, i + L], loop: [i + L, j], stem3: [j, j + L] }];
        }
      }
    }
  }
  span() {
    const [a, b] = this.loop.span();
    return [2 * this.stemMin + a, 2 * this.stemMax + b];
  }
  describe() {
    const extra = (this.wobble ? " :wobble #t" : "") + (this.mismatches ? ` :mismatches ${this.mismatches}` : "");
    return `(hairpin (stem ${this.stemMin} ${this.stemMax}) ${this.loop.describe()}${extra})`;
  }
}

export class Pwm extends Matcher {
  constructor(matrix, threshold = 0.8, counts = null) {
    super();
    this.matrix = {};
    for (const [k, v] of Object.entries(matrix)) this.matrix[k.toUpperCase().replace("U", "T")] = v.slice();
    this.letters = Object.keys(this.matrix).sort();
    this.width = this.matrix[this.letters[0]].length;
    for (const l of this.letters) {
      if (this.matrix[l].length !== this.width) throw new BiomotifError("pwm: rows differ in length");
    }
    this.threshold = threshold;
    this.counts = counts;
    this.maxScore = 0; this.minScore = 0;
    for (let p = 0; p < this.width; p++) {
      const col = this.letters.map((l) => this.matrix[l][p]);
      this.maxScore += Math.max(...col);
      this.minScore += Math.min(...col);
    }
  }
  static fromSites(sites, { threshold = 0.8, pseudocount = 0.5, alphabet = "ACGT" } = {}) {
    const clean = sites.map((s) => s.toUpperCase().replace(/U/g, "T"));
    const width = clean[0].length;
    if (clean.some((s) => s.length !== width)) throw new BiomotifError("pwm: all sites must be the same length");
    const counts = {};
    for (const l of alphabet) counts[l] = Array(width).fill(0);
    for (const s of clean) for (let p = 0; p < width; p++) if (counts[s[p]]) counts[s[p]][p]++;
    const bg = 1 / alphabet.length;
    const matrix = {};
    for (const l of alphabet) {
      matrix[l] = Array.from({ length: width }, (_, p) => {
        let total = pseudocount * alphabet.length;
        for (const x of alphabet) total += counts[x][p];
        return Math.log2(((counts[l][p] + pseudocount) / total) / bg);
      });
    }
    return new Pwm(matrix, threshold, counts);
  }
  score(s) {
    let total = 0;
    for (let p = 0; p < s.length; p++) {
      const row = this.matrix[s[p]];
      total += row ? row[p] : this.minScore / this.width;
    }
    return total;
  }
  relative(score) {
    const span = this.maxScore - this.minScore;
    return span ? (score - this.minScore) / span : 1;
  }
  consensus() {
    let out = "";
    for (let p = 0; p < this.width; p++) {
      out += this.letters.reduce((a, b) => (this.matrix[a][p] >= this.matrix[b][p] ? a : b));
    }
    return out;
  }
  * matchAt(ctx, i, binds) {
    if (i + this.width > ctx.seq.length) return;
    const sc = this.score(ctx.seq.slice(i, i + this.width));
    const rel = this.relative(sc);
    if (rel >= this.threshold) {
      yield [i + this.width, { ...binds, $score: Math.round(sc * 1000) / 1000, $relative: Math.round(rel * 1000) / 1000 }];
    }
  }
  span() { return [this.width, this.width]; }
  describe() { return `(pwm ${this.consensus()} :width ${this.width} :threshold ${this.threshold})`; }
}

export class AtStart extends Matcher {
  * matchAt(ctx, i, binds) { if (i === 0) yield [i, binds]; }
  span() { return [0, 0]; }
  describe() { return "at-start"; }
}
export class AtEnd extends Matcher {
  * matchAt(ctx, i, binds) { if (i === ctx.seq.length) yield [i, binds]; }
  span() { return [0, 0]; }
  describe() { return "at-end"; }
}

export class Regex extends Matcher {
  constructor(pattern) { super(); this.pattern = pattern; this.re = new RegExp(pattern, "iy"); }
  * matchAt(ctx, i, binds) {
    this.re.lastIndex = i;
    const m = this.re.exec(ctx.seq);
    if (m) yield [i + m[0].length, binds];
  }
  describe() { return `(regex ${q(this.pattern)})`; }
}

/** Wraps a matcher with a library name without changing how it matches. */
export class Tagged extends Matcher {
  constructor(inner, name) { super(); this.inner = coerce(inner); this.name = name; }
  matchAt(ctx, i, binds) { return this.inner.matchAt(ctx, i, binds); }
  firstSet(ctx) { return this.inner.firstSet(ctx); }
  span() { return this.inner.span(); }
  describe() { return this.inner.describe(); }
}

export function coerce(x) {
  if (x instanceof Matcher) return x;
  if (typeof x === "string") return new Literal(x);
  if (Array.isArray(x)) return new Seq(x);
  throw new BiomotifError(`not a motif: ${x}`);
}

/* --------------------------------------------------------------- PROSITE */

const PROSITE_ELEM = /^(<)?(\[[A-Z]+\]|\{[A-Z]+\}|[A-Zx])(?:\((\d+)(?:,(\d+))?\))?(>)?$/;

export function prosite(pattern) {
  const text = pattern.trim().replace(/\.$/, "").replace(/\s+/g, "");
  const parts = [];
  for (const raw of text.split("-")) {
    const m = PROSITE_ELEM.exec(raw);
    if (!m) throw new BiomotifError(`prosite: cannot read element ${q(raw)} in ${q(pattern)}`);
    const [, start, elem, lo, hi, end] = m;
    if (start) parts.push(new AtStart());
    let cls;
    if (elem === "x") cls = new AnyChar();
    else if (elem.startsWith("[")) cls = new AnyOf(elem.slice(1, -1));
    else if (elem.startsWith("{")) cls = new NoneOf(elem.slice(1, -1));
    else cls = new Literal(elem);
    if (lo !== undefined) {
      const a = parseInt(lo, 10), b = hi === undefined ? a : parseInt(hi, 10);
      if (cls instanceof Literal) parts.push(new Repeat(cls, a, b));
      else parts.push(new CharRun(cls, a, b, elem === "x" ? `(gap ${a} ${b})` : null));
    } else parts.push(cls);
    if (end) parts.push(new AtEnd());
  }
  const s = new Seq(parts);
  s.describe = () => `(prosite ${q(pattern)})`;
  return s;
}

/* ---------------------------------------------------------------- records */

export class Record {
  constructor(name, seq, type = null, { offset = 0, description = "" } = {}) {
    this.name = name;
    this.seq = seq;
    this.type = type || guessType(seq);
    this.offset = offset;
    this.description = description;
  }
  get length() { return this.seq.length; }
  sub(start, end, name = null) {
    return new Record(name ?? `${this.name}:${this.offset + start}-${this.offset + end}`,
      this.seq.slice(start, end), this.type,
      { offset: this.offset + start, description: this.description });
  }
}

export function parseFasta(text, type = null) {
  const records = [];
  let name = null, desc = "", chunks = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith(">")) {
      if (name !== null) records.push(new Record(name, chunks.join(""), type, { description: desc }));
      const header = line.slice(1).trim();
      const sp = header.indexOf(" ");
      name = sp === -1 ? header : header.slice(0, sp);
      desc = sp === -1 ? "" : header.slice(sp + 1);
      chunks = [];
    } else chunks.push(line.replace(/\s/g, ""));
  }
  if (name !== null) records.push(new Record(name, chunks.join(""), type, { description: desc }));
  if (!records.length && text.trim()) {
    // A bare sequence with no header is still a sequence.
    const seq = text.replace(/[^A-Za-z*\-]/g, "");
    if (seq) records.push(new Record("sequence", seq, type));
  }
  return records;
}

export function formatFasta(records, width = 70) {
  return records.map((r) => {
    const lines = [`>${r.name}${r.description ? " " + r.description : ""}`];
    for (let i = 0; i < r.seq.length; i += width) lines.push(r.seq.slice(i, i + width));
    return lines.join("\n");
  }).join("\n") + "\n";
}

/* ----------------------------------------------------------------- search */

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class Match {
  constructor(motif, start, end, strand, seq, bindings, record, score, extra) {
    this.motif = motif; this.start = start; this.end = end; this.strand = strand;
    this.seq = seq; this.bindings = bindings; this.record = record;
    this.score = score; this.extra = extra || {};
  }
  get absStart() { return this.start + (this.record ? this.record.offset : 0); }
  get absEnd() { return this.end + (this.record ? this.record.offset : 0); }
  get length() { return this.end - this.start; }
}

function makeMatch(name, ctx, i, j, binds, strand, n, record, original) {
  const [start, end] = strand === "+" ? [i, j] : [n - j, n - i];
  const bindings = {};
  let score = null;
  const extra = {};
  for (const [k, v] of Object.entries(binds)) {
    if (k.startsWith("$")) {
      if (k === "$score") score = v; else extra[k.slice(1)] = v;
      continue;
    }
    const [a, b] = v;
    bindings[k] = strand === "+" ? [a, b, original.slice(a, b)] : [n - b, n - a, ctx.seq.slice(a, b)];
  }
  const text = strand === "+" ? original.slice(start, end) : ctx.seq.slice(i, j);
  return new Match(name, start, end, strand, text, bindings, record, score, extra);
}

export function search(matcher, target, { strand = "both", overlap = true, limit = null, name = null } = {}) {
  const m = coerce(matcher);
  const record = target instanceof Record ? target : null;
  const raw = record ? record.seq : target;
  const kind = record ? record.type : guessType(raw);
  const text = normalize(raw, kind);
  const n = text.length;
  const nuc = kind === "dna" || kind === "rna";
  const label = name ?? (m instanceof Tagged ? m.name : m.describe());
  const strands = !nuc ? ["+"] : (strand === "both" ? ["+", "-"] : [strand]);
  const results = [];
  const seen = new Set();
  for (const s of strands) {
    const seq = s === "+" ? text : revcomp(text);
    const ctx = { seq, kind, nuc };
    const fs = m.firstSet(ctx);
    let i = 0;
    while (i <= n) {
      if (fs) {
        while (i < n && !fs.has(seq[i])) i++;
        if (i >= n) break;
      }
      let found = null;
      for (const step of m.matchAt(ctx, i, {})) {
        if (step[0] > i) { found = step; break; }
      }
      if (!found) { i++; continue; }
      const [j, b] = found;
      const hit = makeMatch(label, ctx, i, j, b, s, n, record, text);
      const key = `${hit.start}:${hit.end}:${hit.seq}`;
      // A palindromic motif matches the same span on both strands. One site, one row.
      if (!(s === "-" && seen.has(key))) { results.push(hit); seen.add(key); }
      if (limit !== null && results.length >= limit) return results;
      i = overlap ? i + 1 : j;
    }
  }
  // Plain byte order, not localeCompare: locale rules can sort "-" before "+".
  results.sort((a, b) => a.start - b.start || cmp(a.strand, b.strand));
  return results;
}

export function matchesFull(matcher, text, kind = null) {
  const m = coerce(matcher);
  const k = kind || guessType(text);
  const ctx = { seq: normalize(text, k), kind: k, nuc: k === "dna" || k === "rna" };
  for (const [j] of m.matchAt(ctx, 0, {})) if (j === ctx.seq.length) return true;
  return false;
}

/** Overlapping hits of one motif are usually one site found at several offsets. */
export function collapse(matches, key = "longest") {
  const kept = [];
  const sorted = [...matches].sort((a, b) =>
    cmp(a.motif, b.motif) || cmp(a.strand, b.strand) ||
    a.absStart - b.absStart || b.length - a.length);
  for (const m of sorted) {
    const clash = kept.find((k) => k.motif === m.motif && k.strand === m.strand &&
      k.absStart < m.absEnd && m.absStart < k.absEnd);
    if (!clash) kept.push(m);
    else if ((key === "longest" && m.length > clash.length) ||
             (key === "best" && (m.score || 0) > (clash.score || 0))) {
      kept[kept.indexOf(clash)] = m;
    }
  }
  kept.sort((a, b) => a.absStart - b.absStart || cmp(a.motif, b.motif));
  return kept;
}
