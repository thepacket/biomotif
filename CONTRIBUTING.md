# Contributing

Pull requests are welcome, and so are issues that never become one.

The most valuable contribution is **a motif that is wrong, or a motif that is
missing**. The library carries 523 definitions and only 108 of them cite a paper;
any of them may be mistaken, and a short pattern that matches by chance is easy
to mistake for a finding. If a consensus disagrees with the literature or with
your bench results, that is worth an issue even if you never touch the code.

## Getting it running

Node 20 or newer. There are no dependencies, and adding one needs a good reason
— the whole app is served as static files with no build chain beyond
`tools/build.mjs`. That includes the tests: the interface is tested against a
small DOM of the project's own, `web/test/dom.mjs`, which knows what `app.js`
uses and nothing more. It has no layout, so an interface test can check
structure, text and the requests made, never appearance.

```bash
npm test           # 204 tests
npm run audit      # report provenance and evidence coverage
npm run dist       # build web/dist
npm run serve      # serve it with the deployed security policy
```

`npm run serve` applies the same content security policy nginx sets, so a
change that the policy would block fails locally instead of in production.

## Adding a motif

Motifs live in `library/*.mtf` and are parsed in the browser exactly as
written; nothing in the build rewrites them. Pick the file for the organism or
molecule, and follow the shape of what is already there:

```lisp
(defmotif g-quadruplex
  "G-quadruplex forming sequence: four G-tracts separated by short loops.
   Common at telomeres, promoters and replication origins."
  (seq (run "G" 3 6) (gap 1 7) (run "G" 3 6) (gap 1 7) (run "G" 3 6) (gap 1 7) (run "G" 3 6))
  :category 'structure :alphabet 'dna :example "GGGTTAGGGTTAGGGTTAGGG"
  :ref "Huppert & Balasubramanian 2005, Nucleic Acids Res 33:2908")
```

Restriction enzymes are shorter, written the way REBASE writes a site:

```lisp
(defenzyme EcoRI "G^AATTC")
```

What each part is for:

- **The docstring** says what the element does biologically, not what the
  expression matches. Someone reading the library should learn something.
- **`:example`** is a sequence the motif must match. A test runs every example
  against its own motif, so a wrong pattern fails CI rather than sitting in the
  library looking plausible.
- **`:ref`** is the paper. Add one if you have it; leaving it off is better than
  guessing.
- **`:evidence`** may explicitly be `measured`, `catalogue`,
  `literature-backed` or `uncited`; otherwise Biomotif assigns the most
  conservative level supported by the source and reference.
- **`:taxon`**, **`:version`** and **`:reviewed`** record biological scope,
  source release and the ISO date on which a curator last checked the entry.
- **`:category`** and **`:alphabet`** (`dna`, `rna` or `protein`) drive the
  library filters and decide which sequences the motif is offered for.
- **`:scan #f`** marks a template — something like `pam-spcas9` or an N-run that
  matches almost anywhere. Scan skips these. If your motif would fire every few
  bases, it is a template.

Then rebuild and run the tests:

```bash
npm run index && npm run build && npm test
```

## Generated files must be rebuilt

`data/`, `docs/LIBRARY.md` and `web/biomotif.html` are generated, and CI fails
if they drift from their sources. Run `npm run data`, `npm run index` and
`npm run build` before committing, and include the results in the change.

## Changing the engine

Every expected value in `web/test/` is written from the biology, not captured
from a run, so a behaviour change fails rather than being rubber-stamped. Keep
it that way: if a change makes a test fail, decide whether the old answer or
the new one is right before touching the test.

The language has deliberate limits. There is no negation over a region, no
computed property such as GC content, and no backreference; the engine is a
regular language plus approximate matching, weight matrices and one
context-free construct for hairpins. Adding any of those is a design decision
rather than a patch, so please open an issue first — it will be a better
conversation than a review.

## Style

Match the surrounding code. Comments explain why something is the way it is,
not what the line does; several in this repo exist because the obvious version
was wrong first, and those are worth keeping.

## Attribution of bundled data

The motif library is a set of published consensus sequences, each defined in a
`.mtf` file with a docstring, and with a literature reference where one exists.
Several groups of them follow established catalogues, and those catalogues carry
their own terms, which this project's MIT licence does not override:

- Restriction enzyme sites and cut positions derive from
  [REBASE](http://rebase.neb.com), Copyright (c) Dr. Richard J. Roberts, free
  for academic use.
- Many protein patterns are written in, and several are taken from,
  [PROSITE](https://prosite.expasy.org) (Sigrist et al. 2013).
- Plant elements draw on [PLACE](https://www.dna.affrc.go.jp/PLACE/) (Higo et
  al. 1999) and PlantCARE (Lescot et al. 2002).
- The weight matrices in `library/jaspar.mtf` come from
  [JASPAR](https://jaspar.elixir.no) (Rauluseviciute et al. 2024), released
  under CC BY 4.0. That file is generated by `npm run jaspar` and should not
  be edited by hand; each entry carries its JASPAR id and PubMed reference.

If you redistribute this code, those terms continue to apply to that data. By
contributing you agree your work is released under the same MIT licence.

The example sequences in `data/` are synthetic and generated by
`tools/make-data.mjs`, with one exception: the protein records in
`data/proteins.fa` are drawn from real sequences — serum albumin, a protein
kinase, a zinc finger protein and a Ras GTPase — which are facts from the public
databases and carry no separate terms.

Sequences the app fetches at runtime come from NCBI, Ensembl, ENA and UniProt
and are subject to those services' own terms of use. Nothing is bundled from
them.
