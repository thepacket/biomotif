# Biomotif

**[biomotif.fly.dev](https://biomotif.fly.dev)**

A small Lisp for pattern matching over DNA, RNA and protein sequences, with a
library of nearly 500 documented biological motifs.

Motifs are s-expressions, so they are values you can name, compose, generate
from data and inspect. That is the whole idea: a regular expression cannot
tell you *which* part of it matched *what*, cannot check that a stem actually
base-pairs with its partner, and cannot be built by a program from a codon
table. All of that falls out for free when the pattern is a list.

```lisp
;; a bacterial promoter: two boxes, each allowed one mismatch, 15-19 bases apart
(seq (named 'box35 (fuzzy 1 (iupac "TTGACA")))
     (named 'spacer (gap 15 19))
     (named 'box10 (fuzzy 1 (iupac "TATAAT"))))
```

```
sigma70-promoter  operon  120-149  +  TTGACAATAGATGCAGAAGTGCTTATAAT
   box35=TTGACA  spacer=ATAGATGCAGAAGTGCT  box10=TATAAT  mismatches=0
```

## Install

```bash
pip install biomotif
```

or from a checkout:

```bash
pip install -e '.[dev]'
```

Python 3.10 or newer. No dependencies.

## Try it

```bash
biomotif repl
biomotif library --category crispr
biomotif describe loxp
biomotif find EcoRI data/plasmid.fa
biomotif digest data/plasmid.fa EcoRI HindIII --circular
biomotif scan data/promoters.fa --category core-promoter
biomotif run examples/01-tour.mtf
```

An expression works anywhere a motif name does:

```bash
biomotif find '(seq "TATA" (gap 20 30) (iupac "YYANWYY"))' data/promoters.fa
```

## The motif language

| Form | Matches |
|---|---|
| `"GAATTC"` | that literal, on either strand, U and T alike |
| `(iupac "TATAWAWR")` | a nucleotide consensus with ambiguity codes |
| `(prosite "N-{P}-[ST]-{P}")` | a protein pattern in PROSITE syntax |
| `(seq a b c)` | the parts one after another |
| `(alt a b c)` | any one of them |
| `(gap 15 19)` | 15 to 19 of anything |
| `(run "CT" 8 20)` | a run of 8 to 20 pyrimidines |
| `(repeat m 3 6)` | m repeated 3 to 6 times |
| `(opt m)` | m or nothing |
| `(any-of "AT")` / `(none-of "P")` | one character in or out of a set |
| `(named 'label m)` | m, captured under that label |
| `(fuzzy 2 m)` | a fixed-width m with up to 2 mismatches |
| `(edit 1 "GAATTC")` | up to one substitution, insertion or deletion |
| `(hairpin (stem 5 10) (loop 3 8) :wobble #t)` | a stem-loop whose stem really pairs |
| `(pwm-from-sites sites :threshold 0.8)` | a position weight matrix |
| `(custom 20 40 predicate)` | any substring your function accepts |
| `at-start` / `at-end` | sequence boundaries |
| `(regex "...")` | the escape hatch |

Searching returns match objects, not strings:

```lisp
(define hits (find-all sigma70-promoter genome :strand '+))
(match-start (first hits))          ; 120
(binding (first hits) 'box35)       ; "TTGACA"
(match-extra (first hits) 'mismatches) ; 0
```

`collapse` reduces the many offsets at which one real site is found to one
match per cluster. `show-matches` prints a table, `show-track` draws the hits
under the sequence.

## The library

Nearly 500 motifs in seven files, each with a docstring, a category and, where
one exists, a literature reference.

| File | What is in it |
|---|---|
| `prokaryote.mtf` | sigma factor promoters, ribosome binding sites, terminators, operators, nucleoid and chromosome landmarks |
| `eukaryote.mtf` | core promoter elements, splicing signals, poly(A) sites, transcription factor sites, telomeres, repeats, G-quadruplexes |
| `plant.mtf` | PLACE and PlantCARE elements: hormone, light, stress, defence, seed and circadian |
| `rna.mtf` | structure, stability, localisation, modification, microRNA targets, riboswitches, tRNA features |
| `protein.mtf` | modification sites, targeting signals, structural and catalytic motifs, protease cleavage sites |
| `tags.mtf` | affinity tags, linkers, phage promoters, recombinase sites, CRISPR components, cloning standards, sequencing adapters |
| `restriction.mtf` | 162 restriction enzymes with cut positions and overhangs |

```lisp
(use-library 'all)          ; or 'restriction, 'rna, ...
(library :category 'crispr) ; what is in a category
(describe 'loxp)            ; docstring, pattern, reference, source file
(scan record)               ; every motif that fits the sequence's alphabet
```

`scan` skips 166 entries flagged `:scan #f`. Those are templates and
scaffolds, such as `pam-spcas9` or `umi-8`, which match almost anywhere and
are meant to be searched for by name. Pass `:all #t` to include them.

Add your own with `defmotif`, and it joins the library:

```lisp
(defmotif my-cassette
  "The barcode cassette our lab puts on every construct."
  (seq "GGTCTC" (gap 1 1) (named 'overhang (gap 4 4)) (named 'barcode (gap 8 8)))
  :category 'lab :alphabet 'dna :ref "internal, plate map 2026-03")
```

## Examples

Twelve worked scripts in `examples/`, each runnable against the data in `data/`.

| Script | What it shows |
|---|---|
| `01-tour.mtf` | the language and every combinator |
| `02-operon.mtf` | annotating a bacterial operon end to end |
| `03-cloning.mtf` | unique cutters, digests, insert checks, primer design |
| `04-crispr.mtf` | finding, scoring and ordering guide RNAs |
| `05-gene-structure.mtf` | deriving exons and introns from splice signals, then splicing |
| `06-rna.mtf` | AU-rich elements, iron responsive elements, hairpins, m6A |
| `07-protein.mtf` | targeting signals, catalytic order, in-silico digestion |
| `08-pwm.mtf` | building a weight matrix and comparing it with a consensus |
| `09-plant.mtf` | a cis-element census across a promoter set |
| `10-orfs.mtf` | reading frames, genetic codes, codon usage |
| `11-custom.mtf` | motif generators, back-translation, custom matchers, macros |
| `12-pipeline.mtf` | a full pipeline from FASTA to a results table |

The data is synthetic and reproducible. `tools/make_data.py` regenerates it
from seeded random background with real consensus elements planted at known
positions, so every example has a known right answer.

## The language

A small Scheme-flavoured Lisp: `define`, `lambda`, `let`, `let*`, named `let`,
`cond`, `and`, `or`, `when`, `unless`, `do`, `while`, `set!`, `defmacro`,
quasiquotation, proper tail calls, keyword and optional arguments, docstrings.
Around 250 builtins for lists, strings, hash tables, higher-order functions and
sequence work. The prelude adds `->>`, `->`, `dolist`, `dotimes`, `push!`,
`inc!` and `assert`.

```lisp
(->> (read-fasta "genome.fa")
     (mapcat (lambda (r) (windows r 500 250)))
     (filter (lambda (w) (> (gc w) 0.6)))
     (mapcat (lambda (w) (find-all g-quadruplex w)))
     (collapse)
     (write-tsv "hits.tsv" :header '(sequence motif start end strand match)))
```

## Tests

```bash
python -m pytest
```

457 tests: the reader and evaluator, sequence operations, every combinator,
every library entry loading and matching its own documented example, all
twelve examples running, and every CLI subcommand.

## What this is not

It is not an aligner, a genome browser or a motif discovery tool. It finds
patterns you can describe and helps you describe them well. Short patterns
match by chance, and the library says so in the docstrings; `07-protein.mtf`
shows how to compare a count against a shuffled background before believing it.

## License

MIT.

## Layout

```
biomotif/lisp/      reader, evaluator, core builtins
biomotif/seq/       alphabets, translation, alignment, FASTA and FASTQ
biomotif/motifs/    combinators, search, PROSITE, PWMs, restriction, registry
biomotif/lib/       the prelude and the seven library files
biobiomotif/bindings.py  the Lisp names for everything above
examples/        twelve worked scripts
data/            synthetic sequences with known answers
tools/           regenerate the data and the library index
docs/LIBRARY.md  the full catalogue, generated
```

## The web app

`web/biomotif.html` is the whole tool in one file: no install, no Python, no
server. It carries the same 487-motif library, parsed from the same `.mtf`
files at load, and adds an assistant that writes motifs from a plain-English
description.

```bash
python tools/build_web.py     # rebuilds web/biomotif.html from web/src/ and biomotif/lib/
open web/biomotif.html
```

The browser engine is a separate implementation of the same semantics, not a
port of the interpreter: a motif is built directly from its s-expression, so
there are no environments, lambdas or macros to carry.

`tools/build_web.py` produces two builds from the same source. With no
arguments it writes `web/biomotif.html`, one self-contained file. With
`--dist` it writes `index.html` beside a fingerprinted stylesheet and bundle,
which is what the deployment serves — the split exists so the deployed page
needs no `unsafe-inline` in its content security policy.

Both engines are held to the same answers. Every one of the 487 motifs is run
against the same sequences in Python and in JavaScript and must return the
same hits, in the same order, with the same spans.

| 1 Mb of random DNA | Python | JavaScript |
|---|---|---|
| Literal `GAATTC` | 7.8 Mb/s | 10.3 Mb/s |
| IUPAC `TATAWAWR` | 5.2 Mb/s | 10.0 Mb/s |
| Sigma-70 promoter | 1.6 Mb/s | 8.1 Mb/s |
| Hairpin, stem 5 to 10 | 0.03 Mb/s | 0.2 Mb/s |

Fast enough for plasmids, genes, promoter sets and bacterial genomes. Not fast
enough for a vertebrate genome, in either language.

Writing a motif from a plain-English description needs Claude. That works in
the hosted Artifact, which reaches it through the viewer's own account; a
self-hosted copy says so and offers the library and the reference instead.
Nothing else on the page depends on it.

## Deploying

The repo carries a [fly.io](https://fly.io) configuration. There is no server
component, so a deployment is a static build served by nginx: no secrets, no
environment variables, no volumes, no database. The whole tool, including the
487-motif library, is built into the image.

Install [flyctl](https://fly.io/docs/flyctl/install/) and sign in:

```bash
fly auth login
```

Claim the app name — this reserves it and starts nothing, so it costs nothing:

```bash
fly apps create biomotif
```

If the name is taken it fails immediately; pick another and change `app` in
[fly.toml](fly.toml) to match. Then, from the repo root:

```bash
fly deploy
```

That builds the Dockerfile on Fly's remote builder — Docker does not need to be
running locally. Every later deploy is the same command. The app is then at
`https://<app>.fly.dev`.

Fly starts two machines on a first deploy, for zero-downtime deploys rather
than for load. One is plenty for a static page:

```bash
fly scale count 1
```

The machine sleeps when idle (`auto_stop_machines = 'suspend'` with
`min_machines_running = 0`), so an unvisited deployment costs nothing and the
first request after an idle period pays about a second of wake-up. Set
`min_machines_running = 1` if that matters.

**A sequence cannot leave the browser.** `connect-src` is `'none'` in
[deploy/security-headers.conf](deploy/security-headers.conf), so the page is
not permitted to open a network connection at all: sequences are read from a
local file or pasted in, and every search runs in the page. The only third
party is Google Fonts, allowed for the stylesheet and the font files and
nothing else. Every face has a real fallback stack, so blocking those costs
typography alone.

To check the image locally before deploying:

```bash
docker build -t biomotif . && docker run --rm -p 8080:80 biomotif
```

Or serve the build directly, which needs no Docker:

```bash
python tools/build_web.py --dist web/dist && python -m http.server -d web/dist 8080
```
