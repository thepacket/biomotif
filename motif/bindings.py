"""Lisp bindings for sequences, motifs, the library, searching and digests."""

from __future__ import annotations

import os

from .lisp.printer import to_string
from .lisp.types import Builtin, Lambda, LispError, Symbol, truthy
from .motifs import combinators as C
from .motifs import registry as R
from .motifs.prosite import prosite
from .motifs.restriction import digest as _digest, overhang, parse_site
from .motifs.search import Match, matches_at, matches_full, search
from .seq import alphabet as A
from .seq import io as IO
from .seq import ops as O
from .seq.record import Record

LIB_DIR = os.path.join(os.path.dirname(__file__), "lib")
LIBRARIES = ["prokaryote", "eukaryote", "plant", "restriction", "rna", "protein", "tags"]


def _name(x) -> str:
    if isinstance(x, Symbol):
        return x.name[1:] if x.is_keyword else x.name
    if isinstance(x, str):
        return x
    return to_string(x, False)


def _text(x) -> str:
    """The sequence text of a record or string."""
    if isinstance(x, Record):
        return x.seq
    if isinstance(x, str):
        return x
    if isinstance(x, Match):
        return x.seq
    raise LispError(f"expected a sequence or record, got {to_string(x)}")


def _records(target) -> list:
    if isinstance(target, list):
        out = []
        for t in target:
            out.extend(_records(t))
        return out
    if isinstance(target, Record):
        return [target]
    if isinstance(target, str):
        return [Record("seq", target)]
    if isinstance(target, Match):
        return [Record(f"{target.motif}@{target.abs_start}", target.seq)]
    raise LispError(f"expected a sequence, record or list of records, got {to_string(target)}")


def _motif(x) -> C.Matcher:
    if isinstance(x, Symbol) and not x.is_keyword:
        return R.get(x.name).matcher
    try:
        return C.coerce(x)
    except ValueError as e:
        raise LispError(str(e)) from None


def _kind(x, default=None) -> str:
    if x is None:
        return default
    return _name(x)


def _enzyme(x):
    name = _name(x)
    entry = R.REGISTRY.get(name)
    if entry is None or "site" not in entry.meta:
        if isinstance(x, str) and ("^" in x or "(" in x):
            return name, parse_site(x)
        raise LispError(f"{name} is not a registered restriction enzyme (try (use-library 'restriction))")
    return name, entry.meta


def install(interp):
    B = interp.builtin

    def call(f, *args):
        return interp.apply(f, args)

    # ---- records ---------------------------------------------------------------
    B("make-record", lambda name, seq, type=None, description="": Record(name, seq, _kind(type), description=description),
      "(make-record name seq :type 'dna|'rna|'protein) -> record", kw=True)
    B("record?", lambda x: isinstance(x, Record))
    B("record-name", lambda r: r.name)
    B("record-seq", lambda r: _text(r))
    B("record-type", lambda r: Symbol(r.type))
    B("record-length", lambda r: len(_text(r)))
    B("record-offset", lambda r: r.offset)
    B("record-description", lambda r: r.description)
    B("record-annot", lambda r, key, default=None: r.annotations.get(_name(key), default))
    B("record-annot-set!", lambda r, key, v: r.annotations.__setitem__(_name(key), v))
    B("sub-record", lambda r, a, b, name=None: r.sub(a, b, name))
    B("record-rename", lambda r, name: Record(name, r.seq, r.type, r.annotations, r.offset, r.description))
    B("seq-type", lambda s: Symbol(A.guess_type(_text(s))))
    B("seq-length", lambda s: len(_text(s)))

    def windows(target, size, step=None, min_size=None):
        step = step or size
        out = []
        for rec in _records(target):
            n = len(rec.seq)
            for i in range(0, max(1, n - (min_size or size) + 1), step):
                sub = rec.sub(i, min(i + size, n))
                if len(sub.seq) >= (min_size or size):
                    out.append(sub)
        return out

    B("windows", windows, "(windows target size [step] :min-size n) -> sub-records with offsets", kw=True)

    # ---- fasta ------------------------------------------------------------------
    B("read-fasta", lambda path, type=None: IO.read_fasta(_resolve(interp, path), _kind(type)),
      "(read-fasta path :type 'dna) -> list of records", kw=True)
    B("parse-fasta", lambda text, type=None: IO.parse_fasta(text, _kind(type)), kw=True)
    B("write-fasta", lambda path, records: IO.write_fasta(path, _records(records)))
    B("format-fasta", lambda records: IO.format_fasta(_records(records)))
    B("read-fastq", lambda path: IO.read_fastq(_resolve(interp, path)))

    # ---- sequence operations -----------------------------------------------------
    B("revcomp", lambda s: A.revcomp(_text(s)))
    B("reverse-complement", lambda s: A.revcomp(_text(s)))
    B("complement", lambda s: A.complement(_text(s)))
    B("transcribe", lambda s: A.transcribe(_text(s)))
    B("reverse-transcribe", lambda s: A.reverse_transcribe(_text(s)))
    B("translate", lambda s, table=1, frame=0, to_stop=False, start_as_met=False:
      O.translate(_text(s), table, frame, truthy(to_stop), truthy(start_as_met)),
      "(translate seq :table 1 :frame 0 :to-stop #t) -> protein string", kw=True)

    def frames(s, table=1):
        text = _text(s)
        out = []
        for strand, t in (("+", text), ("-", A.revcomp(text))):
            for f in range(3):
                out.append([[Symbol("frame"), f],
                            [Symbol("strand"), Symbol(strand)],
                            [Symbol("protein"), O.translate(t, table, f)]])
        return out

    B("six-frames", frames, "(six-frames seq :table 1) -> six alists with keys frame, strand and protein", kw=True)
    B("gc", lambda s: O.gc_content(_text(s)))
    B("gc-content", lambda s: O.gc_content(_text(s)))
    B("gc-skew", lambda s: O.gc_skew(_text(s)))
    B("kmers", lambda s, k: O.kmers(_text(s), k))
    B("kmer-counts", lambda s, k: O.kmer_counts(_text(s), k), "(kmer-counts seq k) -> table kmer -> count")
    B("tm", lambda s, method="auto": O.melting_temp(_text(s), _name(method)),
      "(tm primer :method 'wallace|'basic|'auto) -> melting temperature in C", kw=True)
    B("molecular-weight", lambda s, type=None: O.molecular_weight(_text(s), _kind(type, A.guess_type(_text(s)))), kw=True)
    B("hamming", lambda a, b: O.hamming(_text(a), _text(b)))
    B("edit-distance", lambda a, b: O.edit_distance(_text(a), _text(b)))

    def align(a, b, mode="global", match=2, mismatch=-1, gap=-2):
        score, x, y, sa, sb = O.align(_text(a), _text(b), _name(mode), match, mismatch, gap)
        return [score, x, y, sa, sb]

    B("align", align, "(align a b :mode 'global|'local :match 2 :mismatch -1 :gap -2) -> (score aligned-a aligned-b start-a start-b)", kw=True)
    B("palindrome?", lambda s: O.is_palindrome(_text(s)))
    B("expand-iupac", lambda s: A.expand_iupac(s))
    B("iupac->regex", lambda s: A.iupac_regex(s))
    B("iupac-code", lambda bases: A.to_iupac(set(bases)))
    B("codon-table", lambda table=1: dict(O.codon_table(table)))
    B("codons", lambda s, frame=0: [t[i:i + 3] for t in [_text(s).upper()] for i in range(frame, len(t) - 2, 3)], kw=True)
    B("all-codons", lambda: [a + b + c for a in "TCAG" for b in "TCAG" for c in "TCAG"])
    B("stop-codons", lambda table=1: list(O.STOP_CODONS[table]), kw=True)
    B("start-codons", lambda table=1: list(O.START_CODONS.get(table, ["ATG"])), kw=True)
    B("amino-acids", lambda: list(A.AMINO_ACIDS))
    B("count-bases", lambda s: {c: _text(s).upper().count(c) for c in sorted(set(_text(s).upper()))})

    # ---- synthetic data -------------------------------------------------------------
    def random_dna(n, seed=None, gc=0.5, alphabet="ACGT"):
        rng = interp.rng
        if seed is not None:
            rng.seed(seed)
        if alphabet == "ACGT":
            weights = [(1 - gc) / 2, gc / 2, gc / 2, (1 - gc) / 2]
            return "".join(rng.choices("ACGT", weights, k=n))
        return "".join(rng.choices(alphabet, k=n))

    B("random-dna", random_dna, "(random-dna n :seed 1 :gc 0.5) -> random sequence", kw=True)
    B("random-rna", lambda n, seed=None, gc=0.5: random_dna(n, seed, gc).replace("T", "U"), kw=True)
    B("random-protein", lambda n, seed=None: random_dna(n, seed, alphabet=A.AMINO_ACIDS), kw=True)

    def plant(seq, pos, insert):
        text = _text(seq)
        ins = _text(insert)
        if pos < 0 or pos + len(ins) > len(text):
            raise LispError(f"plant: position {pos} does not fit a {len(ins)}-mer in a {len(text)}-mer")
        out = text[:pos] + ins + text[pos + len(ins):]
        return Record(seq.name, out, seq.type, seq.annotations, seq.offset, seq.description) if isinstance(seq, Record) else out

    B("plant", plant, "(plant seq pos insert) -> seq with insert overwriting the bases at pos")

    def mutate(seq, rate, seed=None):
        rng = interp.rng
        if seed is not None:
            rng.seed(seed)
        text = _text(seq)
        letters = "ACGT" if A.guess_type(text) != "protein" else A.AMINO_ACIDS
        out = []
        for c in text:
            if rng.random() < rate:
                out.append(rng.choice([l for l in letters if l != c.upper()]))
            else:
                out.append(c)
        return "".join(out)

    B("mutate", mutate, "(mutate seq rate :seed n) -> copy with random substitutions", kw=True)

    # ---- combinators ------------------------------------------------------------------
    def wrap(fn, name):
        def f(*a, **k):
            try:
                return fn(*a, **k)
            except ValueError as e:
                raise LispError(f"{name}: {e}") from None
        return f

    B("seq", lambda *parts: C.Seq(list(parts)), "(seq m1 m2 ...) -> the motifs one after another")
    B("alt", lambda *parts: C.Alt([p for part in parts for p in (part if isinstance(part, list) else [part])]),
      "(alt m1 m2 ...) -> any one of the motifs; lists are spliced")
    B("any-of", wrap(C.AnyOf, "any-of"), '(any-of "AT") -> one character from the set')
    B("none-of", wrap(C.NoneOf, "none-of"), '(none-of "P") -> one character not in the set')
    interp.define("any", C.Any())
    B("any", lambda: C.Any())
    B("iupac", wrap(C.Iupac, "iupac"), '(iupac "TATAWAW") -> nucleotide pattern with ambiguity codes')
    B("dna", wrap(C.Iupac, "dna"))
    B("rna", wrap(C.Iupac, "rna"))
    B("prosite", wrap(prosite, "prosite"), '(prosite "N-{P}-[ST]-{P}") -> protein pattern in PROSITE syntax')
    B("protein", wrap(prosite, "protein"))
    B("regex", wrap(C.Regex, "regex"))
    B("literal", wrap(C.Literal, "literal"))

    def repeat(m, min=0, max=None):
        inner = _motif(m)
        if isinstance(inner, (C.AnyOf, C.NoneOf, C.Any)):
            return C.CharRun(inner, min, max)
        return C.Repeat(inner, min, max)

    B("repeat", wrap(repeat, "repeat"), "(repeat m min [max]) -> m repeated; max omitted = unbounded")
    B("opt", lambda m: repeat(m, 0, 1), "(opt m) -> m or nothing")
    B("exactly", lambda m, n: repeat(m, n, n))
    B("gap", lambda min, max=None: C.CharRun(C.Any(), min, max if max is not None else min, f"(gap {min} {max if max is not None else min})"),
      "(gap min [max]) -> any min..max characters")
    B("run", lambda chars, min=1, max=None: C.CharRun(C.AnyOf(chars), min, max, f'(run "{chars}" {min} {max if max is not None else ""})'.replace(" )", ")")),
      '(run "T" 4 8) -> a run of 4 to 8 characters from the set')
    B("named", lambda label, m: C.Named(_name(label), _motif(m)), "(named 'label m) -> m, captured under label")
    B("fuzzy", wrap(lambda k, m: C.Fuzzy(k, _motif(m)), "fuzzy"), "(fuzzy k m) -> fixed-width m with up to k mismatches")
    B("edit", wrap(C.Edit, "edit"), '(edit k "literal") -> literal with up to k substitutions/insertions/deletions')
    B("stem", lambda a, b=None: [Symbol("stem"), a, b if b is not None else a])

    def loop(a, b=None):
        if isinstance(a, int):
            return C.CharRun(C.Any(), a, b if b is not None else a, f"(loop {a} {b if b is not None else a})")
        return _motif(a)

    B("loop", loop, "(loop min max) or (loop motif) -> the loop part of a hairpin")

    def hairpin(stem, loop_m, wobble=False, mismatches=0):
        if not (isinstance(stem, list) and stem and stem[0] is Symbol("stem")):
            raise LispError("hairpin: first argument must be (stem min max)")
        return C.Hairpin(stem[1], stem[2], loop_m if isinstance(loop_m, C.Matcher) else loop(loop_m),
                         truthy(wobble), mismatches)

    B("hairpin", hairpin, "(hairpin (stem min max) (loop min max) :wobble #t :mismatches 1) -> stem-loop", kw=True)
    B("custom", lambda min, max, fn: C.Custom(min, max, lambda s: truthy(call(fn, s))),
      "(custom min max predicate) -> matches a substring of min..max characters satisfying predicate")
    interp.define("at-start", C.AtStart())
    interp.define("at-end", C.AtEnd())
    B("n-terminal", lambda m: C.Seq([C.AtStart(), _motif(m)]))
    B("c-terminal", lambda m: C.Seq([_motif(m), C.AtEnd()]))
    B("revcomp-motif", lambda s: C.Literal(A.revcomp(s)))
    B("motif?", lambda x: isinstance(x, C.Matcher))
    B("describe-motif", lambda m: _motif(m).describe())
    B("motif-name", lambda m: _motif(m).name or False)

    # ---- PWMs ---------------------------------------------------------------------------
    def pwm(matrix, threshold=0.8, name=None):
        rows = {}
        for row in matrix:
            rows[_name(row[0])] = [float(x) for x in row[1:]]
        return C.Pwm(rows, threshold, name)

    B("pwm", wrap(pwm, "pwm"), "(pwm '((A ...) (C ...) (G ...) (T ...)) :threshold 0.8) -> weight matrix motif", kw=True)
    B("pwm-from-sites", wrap(lambda sites, threshold=0.8, pseudocount=0.5, name=None:
                             C.Pwm.from_sites([_text(s) for s in sites], pseudocount, None, threshold, name=name), "pwm-from-sites"),
      "(pwm-from-sites '(\"TATAAA\" ...) :threshold 0.8 :pseudocount 0.5)", kw=True)
    B("pwm-consensus", lambda p: p.consensus())
    B("pwm-width", lambda p: p.width)
    B("pwm-score", lambda p, s: p.score(A.normalize(_text(s))))
    B("pwm-relative-score", lambda p, s: p.relative(p.score(A.normalize(_text(s)))))
    B("pwm-matrix", lambda p: [[Symbol(l)] + [round(x, 3) for x in p.matrix[l]] for l in p.letters])
    B("pwm-counts", lambda p: [[Symbol(l)] + p.counts[l] for l in sorted(p.counts)] if p.counts else [])

    # ---- searching ------------------------------------------------------------------------
    def find_all(motif, target, strand="both", overlap=True, limit=None):
        m = _motif(motif)
        out = []
        for rec in _records(target):
            out.extend(search(m, rec, _name(strand), truthy(overlap), limit=limit))
            if limit is not None and len(out) >= limit:
                return out[:limit]
        return out

    B("find-all", find_all, "(find-all motif target :strand 'both|'+|'- :overlap #t :limit n) -> matches", kw=True)
    B("search", find_all, kw=True)
    B("find-first", lambda motif, target, strand="both": (find_all(motif, target, strand, True, 1) or [False])[0], kw=True)
    B("count-matches", lambda motif, target, strand="both": len(find_all(motif, target, strand)), kw=True)
    B("contains?", lambda motif, target, strand="both": bool(find_all(motif, target, strand, True, 1)), kw=True)
    B("matches?", lambda motif, text: matches_full(_motif(motif), _text(text)), "(matches? motif string) -> whole string matches")
    B("matches-prefix?", lambda motif, text: matches_at(_motif(motif), _text(text)))

    # match accessors
    B("match?", lambda x: isinstance(x, Match))
    B("match-start", lambda m: m.abs_start, "0-based start, in the coordinates of the record's parent")
    B("match-end", lambda m: m.abs_end, "exclusive end")
    B("match-position", lambda m: m.abs_start + 1, "1-based start, as in GenBank")
    B("match-strand", lambda m: Symbol(m.strand))
    B("match-seq", lambda m: m.seq)
    B("match-length", lambda m: len(m))
    B("match-motif", lambda m: m.motif)
    B("match-record", lambda m: m.record if m.record is not None else False)
    B("match-record-name", lambda m: m.record.name if m.record is not None else "")
    B("match-score", lambda m: m.score if m.score is not None else False)
    B("match-extra", lambda m, key, default=None: m.extra.get(_name(key), default))
    B("binding", lambda m, label, default="": m.bindings.get(_name(label), (0, 0, default))[2],
      "(binding match 'label) -> the captured text")
    B("binding-span", lambda m, label: list(m.bindings[_name(label)][:2]) if _name(label) in m.bindings else False)
    B("bindings", lambda m: [[Symbol(k), v[2]] for k, v in m.bindings.items()])
    B("match->alist", lambda m: [[Symbol("motif"), m.motif], [Symbol("record"), m.record.name if m.record else ""],
                                 [Symbol("start"), m.abs_start], [Symbol("end"), m.abs_end],
                                 [Symbol("strand"), Symbol(m.strand)], [Symbol("seq"), m.seq]]
                                + ([[Symbol("score"), m.score]] if m.score is not None else [])
                                + [[Symbol(k), v[2]] for k, v in m.bindings.items()])
    B("match-context", lambda m, flank=10: _context(m, flank), "(match-context m 10) -> the match with 10 bases on each side")
    B("match-overlaps?", lambda a, b: a.abs_start < b.abs_end and b.abs_start < a.abs_end)

    def show_matches(matches, out=None):
        matches = matches if isinstance(matches, list) else [matches]
        if not matches:
            _print(interp, "  (no matches)\n")
            return None
        w_name = max(len(m.motif) for m in matches)
        w_rec = max(len(m.record.name) if m.record else 0 for m in matches)
        for m in matches:
            rec = (m.record.name.ljust(w_rec) + "  ") if w_rec else ""
            extra = ""
            if m.score is not None:
                extra += f"  score={m.score}"
            for k, v in m.extra.items():
                extra += f"  {k}={v}"
            for k, v in m.bindings.items():
                extra += f"  {k}={_short(v[2])}"
            _print(interp, f"  {m.motif.ljust(w_name)}  {rec}{m.abs_start:>7}-{m.abs_end:<7} "
                           f"{m.strand}  {_short(m.seq)}{extra}\n")
        return None

    B("show-matches", show_matches, "(show-matches matches) -> print a table of matches")

    def collapse(matches, key="longest"):
        """Overlapping matches of the same motif on the same strand are usually one
        site found at several offsets. Keep one representative of each cluster."""
        best_first = sorted(matches, key=lambda m: (m.record.name if m.record else "", m.motif,
                                                    m.strand, m.abs_start,
                                                    -len(m) if _name(key) == "longest" else len(m)))
        kept: list = []
        for m in best_first:
            clash = next((k for k in kept
                          if k.motif == m.motif and k.strand == m.strand
                          and _same_record(k.record, m.record)
                          and k.abs_start < m.abs_end and m.abs_start < k.abs_end), None)
            if clash is None:
                kept.append(m)
            elif (_name(key) == "longest" and len(m) > len(clash)) or \
                 (_name(key) == "shortest" and len(m) < len(clash)) or \
                 (_name(key) == "best" and (m.score or 0) > (clash.score or 0)):
                kept[kept.index(clash)] = m
        kept.sort(key=lambda m: (m.record.name if m.record else "", m.abs_start, m.motif))
        return kept

    B("collapse", collapse,
      "(collapse matches :key 'longest|'shortest|'best) -> one match per overlapping cluster", kw=True)

    def show_track(target, matches, width=60, label=True):
        for rec in _records(target):
            lo, hi = rec.offset, rec.offset + len(rec.seq)
            mine = [m for m in matches
                    if _same_record(m.record, rec) and m.abs_end > lo and m.abs_start < hi]
            text = rec.seq
            _print(interp, f"> {rec.name} ({len(text)} {'aa' if rec.type == 'protein' else 'bp'})\n")
            for i in range(0, len(text), width):
                chunk = text[i:i + width]
                pos = rec.offset + i
                _print(interp, f"{pos + 1:>8} {chunk}\n")
                lanes: list[list] = []
                for m in sorted(mine, key=lambda m: m.abs_start):
                    a, b = m.abs_start - pos, m.abs_end - pos
                    if b <= 0 or a >= len(chunk):
                        continue
                    a, b = max(a, 0), min(b, len(chunk))
                    placed = False
                    for lane in lanes:
                        if all(not (a < lb and la < b) for la, lb, _ in lane):
                            lane.append((a, b, m)); placed = True; break
                    if not placed:
                        lanes.append([(a, b, m)])
                for lane in lanes:
                    line = [" "] * len(chunk)
                    for a, b, m in lane:
                        mark = "<" if m.strand == "-" else ">"
                        for k in range(a, b):
                            line[k] = mark
                        if label:
                            tag = m.motif[: b - a]
                            for k, ch in enumerate(tag):
                                line[a + k] = ch
                    _print(interp, " " * 9 + "".join(line).rstrip() + "\n")
        return None

    B("show-track", show_track, "(show-track record matches :width 60) -> ASCII track of matches under the sequence", kw=True)

    def write_tsv(path, rows, header=None):
        with open(path, "w", encoding="utf-8") as f:
            if header:
                f.write("\t".join(to_string(h, False) for h in header) + "\n")
            for row in rows:
                if isinstance(row, Match):
                    row = [row.record.name if row.record else "", row.motif, row.abs_start, row.abs_end, row.strand, row.seq]
                f.write("\t".join(to_string(c, False) for c in row) + "\n")
        return path

    B("write-tsv", write_tsv, "(write-tsv path rows :header '(...)) -- rows may be matches or lists", kw=True)
    B("read-tsv", lambda path: [line.split("\t") for line in open(_resolve(interp, path), encoding="utf-8").read().splitlines() if line])

    # ---- ORFs, CpG islands ------------------------------------------------------------------
    def orfs(target, min_length=90, table=1, strand="both", starts=None, longest_only=True):
        out = []
        for rec in _records(target):
            for o in O.orfs(rec.seq, min_length, table, starts, _name(strand) == "both", truthy(longest_only)):
                m = Match("orf", o["start"], o["end"], o["strand"], o["seq"], {}, rec)
                m.extra = {"frame": o["frame"], "protein": o["protein"]}
                out.append(m)
        out.sort(key=lambda m: (m.record.name if m.record else "", m.start))
        return out

    B("orfs", orfs, "(orfs target :min-length 90 :table 11 :strand 'both) -> matches with 'protein and 'frame extras", kw=True)
    B("orf-protein", lambda m: m.extra.get("protein", ""))

    def cpg_islands(target, window=200, min_gc=0.5, min_ratio=0.6, step=1):
        out = []
        for rec in _records(target):
            s = rec.seq.upper()
            n = len(s)
            islands = []
            for i in range(0, n - window + 1, step):
                w = s[i:i + window]
                c, g, cg = w.count("C"), w.count("G"), w.count("CG")
                gc = (c + g) / window
                ratio = (cg * window) / (c * g) if c and g else 0.0
                if gc >= min_gc and ratio >= min_ratio:
                    if islands and i <= islands[-1][1]:
                        islands[-1][1] = i + window
                    else:
                        islands.append([i, i + window])
            for a, b in islands:
                w = s[a:b]
                c, g, cg = w.count("C"), w.count("G"), w.count("CG")
                m = Match("cpg-island", a, b, "+", w, {}, rec)
                m.extra = {"gc": round((c + g) / len(w), 3), "obs_exp": round((cg * len(w)) / (c * g), 3) if c and g else 0.0}
                out.append(m)
        return out

    B("cpg-islands", cpg_islands, "(cpg-islands target :window 200 :min-gc 0.5 :min-ratio 0.6) -> Gardiner-Garden islands", kw=True)

    # ---- library -----------------------------------------------------------------------------
    def register_motif(name, *args, ref="", category="misc", alphabet=None, example=None, cut=None,
                       source=None, scan=True):
        args = list(args)
        doc = ""
        if len(args) > 1 and isinstance(args[0], str):
            doc = args.pop(0)
        if not args:
            raise LispError(f"defmotif {_name(name)}: expected a docstring and a motif")
        m = _motif(args[0])
        docs = [doc]
        alpha = _name(alphabet) if alphabet is not None else _default_alphabet(_name(category))
        meta = {}
        if cut is not None:
            meta = parse_site(cut)
        return R.register(_name(name), m, doc=" ".join(docs), ref=ref, category=_name(category), alphabet=alpha,
                          example=example, meta=meta, scan=truthy(scan),
                          source=os.path.basename(interp.current_file or "") or None)

    B("register-motif", register_motif, "(register-motif 'name \"doc\" motif :ref \"...\" :category 'cat :alphabet 'dna :example \"...\")", kw=True)

    def register_enzyme(name, site, ref="", doc=""):
        info = parse_site(site)
        entry_doc = doc or f"Recognition site {site}, {overhang(info)}."
        # The example must be a concrete sequence: an ambiguous site like GT^MKAC
        # does not match itself, so show one sequence the enzyme actually cuts.
        example = A.expand_iupac(info["site"])[0]
        return R.register(_name(name), C.Iupac(info["site"]), doc=entry_doc, ref=ref, category="restriction",
                          alphabet="dna", example=example, meta=info,
                          source=os.path.basename(interp.current_file or "") or None)

    B("register-enzyme", register_enzyme, "(register-enzyme 'EcoRI \"G^AATTC\")", kw=True)
    B("enzyme-site", lambda e: _enzyme(e)[1]["site"])
    B("enzyme-overhang", lambda e: overhang(_enzyme(e)[1]))
    B("enzyme-cut", lambda e: [_enzyme(e)[1]["cut_top"], _enzyme(e)[1]["cut_bottom"]])
    B("library-motif", lambda name: R.get(_name(name)).matcher)
    B("motif-doc", lambda name: R.get(_name(name)).doc)
    B("motif-ref", lambda name: R.get(_name(name)).ref)
    B("motif-category", lambda name: Symbol(R.get(_name(name)).category))
    B("motif-alphabet", lambda name: Symbol(R.get(_name(name)).alphabet))
    B("motif-example", lambda name: R.get(_name(name)).example or False)
    B("motif-registered?", lambda name: _name(name) in R.REGISTRY)

    def library(category=None, alphabet=None, search=None):
        return [Symbol(e.name) for e in R.entries(_kind(category), _kind(alphabet), search)]

    B("library", library, "(library :category 'promoter :alphabet 'protein :search \"kinase\") -> motif names", kw=True)
    B("library-categories", lambda: [Symbol(c) for c in R.categories()])
    B("library-count", lambda: len(R.REGISTRY))

    def describe(name):
        e = R.get(_name(name))
        _print(interp, f"{e.name}  [{e.category}, {e.alphabet}]\n")
        if e.doc:
            for line in _wrap(e.doc):
                _print(interp, f"  {line}\n")
        _print(interp, f"  pattern: {e.matcher.describe()}\n")
        if e.meta.get("site"):
            _print(interp, f"  site: {e.meta['site']}  cut: top {e.meta['cut_top']}, bottom {e.meta['cut_bottom']} ({overhang(e.meta)})\n")
        if e.example:
            _print(interp, f"  example: {e.example}\n")
        if e.ref:
            _print(interp, f"  ref: {e.ref}\n")
        if not e.scan:
            _print(interp, "  a template: too degenerate to scan with, search for it by name\n")
        if e.source:
            _print(interp, f"  defined in: {e.source}\n")
        return None

    B("describe", describe, "(describe 'motif-name) -> print what the library knows about it")

    def use_library(*names):
        loaded = []
        for n in names:
            n = _name(n)
            targets = LIBRARIES if n == "all" else [n]
            for t in targets:
                path = os.path.join(LIB_DIR, f"{t}.mtf")
                if not os.path.exists(path):
                    raise LispError(f"no library named {t!r}; available: {', '.join(LIBRARIES)} or all")
                interp.load_file(path, once=True)
                loaded.append(Symbol(t))
        return loaded

    B("use-library", use_library, "(use-library 'restriction 'rna ...) or (use-library 'all)")
    B("libraries", lambda: [Symbol(n) for n in LIBRARIES])

    def scan(target, category=None, alphabet=None, strand="both", exclude=None, all=False):
        out = []
        excluded = {_name(x) for x in (exclude or [])}
        for rec in _records(target):
            rec_alpha = "protein" if rec.type == "protein" else "nucleotide"
            for e in R.entries(_kind(category), _kind(alphabet)):
                if e.category in excluded or e.name in excluded:
                    continue
                # Templates and scaffolds match nearly everywhere; skip unless asked.
                if not e.scan and not truthy(all):
                    continue
                e_alpha = "protein" if e.alphabet == "protein" else "nucleotide"
                if e_alpha != rec_alpha:
                    continue
                out.extend(search(e.matcher, rec, _name(strand)))
        out.sort(key=lambda m: (m.record.name if m.record else "", m.start, m.motif))
        return out

    B("scan", scan,
      "(scan target :category 'promoter :exclude '(restriction) :all #t) -> matches of every "
      "library motif that fits the alphabet. Motifs registered with :scan #f are templates "
      "that match almost anywhere; they are skipped unless :all is given.",
      kw=True)
    B("motif-scannable?", lambda name: R.get(_name(name)).scan)
    B("library-templates", lambda: [Symbol(e.name) for e in R.REGISTRY.values() if not e.scan],
      "(library-templates) -> motifs that scan skips because they match almost anywhere")

    # ---- digests -----------------------------------------------------------------------------------
    def digest(target, *enzymes, circular=False):
        recs = _records(target)
        if len(recs) != 1:
            raise LispError("digest: give one sequence or record")
        names = [_name(n) for e in enzymes for n in (e if isinstance(e, list) else [e])]
        result = _digest(recs[0], [_enzyme(e) for e in names], truthy(circular))
        t = {}
        t[Symbol("sites")] = [{Symbol(k): (Symbol(v) if k == "strand" else v) for k, v in s.items()} for s in result["sites"]]
        t[Symbol("cuts")] = result["cuts"]
        t[Symbol("fragments")] = [list(f) for f in result["fragments"]]
        t[Symbol("enzymes")] = names
        t[Symbol("length")] = len(recs[0].seq)
        return t

    B("digest", digest, "(digest target 'EcoRI 'BamHI :circular #t) -> table with sites, cuts and fragments", kw=True)
    B("fragment-sizes", lambda d: sorted((f[2] for f in d[Symbol("fragments")]), reverse=True))
    B("digest-sites", lambda d: d[Symbol("sites")])
    B("digest-cuts", lambda d: d[Symbol("cuts")])
    B("digest-fragments", lambda d: d[Symbol("fragments")])

    def show_digest(d):
        names = ", ".join(d[Symbol("enzymes")])
        _print(interp, f"  digest with {names} ({d[Symbol('length')]} bp)\n")
        for s in d[Symbol("sites")]:
            _print(interp, f"    {s[Symbol('enzyme')]:<8} site {s[Symbol('start')] + 1:>6}  cut after {s[Symbol('cut_top')]:>6}  {s[Symbol('strand')]}\n")
        sizes = sorted((f[2] for f in d[Symbol("fragments")]), reverse=True)
        _print(interp, "    fragments: " + ", ".join(str(x) for x in sizes) + " bp\n")
        return None

    B("show-digest", show_digest)


def _default_alphabet(category: str) -> str:
    if category in ("protein", "targeting", "modification", "protease", "tag", "domain", "binding-site"):
        return "protein"
    if category in ("rna", "rna-structure", "utr", "splicing-rna", "mirna"):
        return "rna"
    return "dna"


def _short(text: str, width: int = 64) -> str:
    """Long matches are unreadable in a table; show the ends and the length."""
    if len(text) <= width:
        return text
    half = (width - 12) // 2
    return f"{text[:half]}...{text[-half:]} [{len(text)}]"


def _same_record(a, b) -> bool:
    """True when a match belongs to this record, or to the parent it was cut from."""
    if a is None or a is b:
        return True
    return a.name == b.name or a.name.startswith(b.name + ":") or b.name.startswith(a.name + ":")


def _wrap(doc: str, width: int = 86) -> list[str]:
    """Collapse the whitespace of a docstring and re-wrap it."""
    import textwrap
    return textwrap.wrap(" ".join(doc.split()), width) or [""]


def _context(m: Match, flank: int) -> str:
    if m.record is None:
        return m.seq
    s = m.record.seq
    a, b = max(0, m.start - flank), min(len(s), m.end + flank)
    return s[a:m.start].lower() + s[m.start:m.end].upper() + s[m.end:b].lower()


def _print(interp, text: str):
    if interp.output is not None:
        interp.output(text)
    else:
        import sys
        sys.stdout.write(text)


def _resolve(interp, path):
    if os.path.isabs(path) or os.path.exists(path) or interp.current_file is None:
        return path
    candidate = os.path.join(os.path.dirname(interp.current_file), path)
    if os.path.exists(candidate):
        return candidate
    # examples refer to ../data
    up = os.path.join(os.path.dirname(os.path.dirname(interp.current_file)), path)
    return up if os.path.exists(up) else path
