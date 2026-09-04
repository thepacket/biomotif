# Biomotif

**[biomotif.fly.dev](https://biomotif.fly.dev)**

A browser workbench for sequence patterns. Describe a motif as an expression,
find it in DNA, RNA or protein, and read the result — with a library of 487
documented motifs and live retrieval from the public databases.

Everything runs in the page. There is no server component: the deployment is
static files, and sequences you paste or open never leave the browser.

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

A pattern is an expression rather than a string, which buys three things a
regular expression cannot give you. Named parts come back as bindings, so you
learn which piece matched what. A hairpin is checked for real base pairing, not
just the right letters. And a pattern can be built by code, so a peptide can be
turned into every DNA motif that could encode it.

## Running it

No install and no dependencies — Node 20 or newer is used only to build.

```bash
npm test           # 126 tests
npm run dist       # build web/dist
npm run serve      # serve it with the deployed security policy
```

`npm run build` writes `web/biomotif.html`, the whole tool as one file.

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
| `(pwm-from-sites '("TATAAA" …) :threshold 0.8)` | a position weight matrix |
| `at-start` / `at-end` | sequence boundaries |

Under the editor is what the motif will do: how many characters a match can
span, and which strands are searched. The canonical form appears there too, but
only when it differs from what you typed — `tata-box` expands to
`(iupac "TATAWAWR")`, `(opt m)` to `(repeat m 0 1)` — so an expression that is
already canonical, which includes every library pattern, is not echoed back at
you.

## The library

487 motifs in seven files, each with a docstring, a category and, where one
exists, a literature reference. The full catalogue is in
[docs/LIBRARY.md](docs/LIBRARY.md).

| File | What is in it |
|---|---|
| `prokaryote.mtf` | sigma factor promoters, ribosome binding sites, terminators, operators, chromosome landmarks |
| `eukaryote.mtf` | core promoter elements, splicing signals, poly(A) sites, transcription factor sites, telomeres, repeats, G-quadruplexes |
| `plant.mtf` | PLACE and PlantCARE elements: hormone, light, stress, defence, seed and circadian |
| `rna.mtf` | structure, stability, localisation, modification, microRNA targets, riboswitches, tRNA features |
| `protein.mtf` | modification sites, targeting signals, structural and catalytic motifs, protease cleavage sites |
| `tags.mtf` | affinity tags, linkers, phage promoters, recombinase sites, CRISPR components, cloning standards, sequencing adapters |
| `restriction.mtf` | 162 restriction enzymes with cut positions and overhangs |

Scanning skips 166 entries flagged `:scan #f`. Those are templates and
scaffolds — `pam-spcas9`, `umi-8` — that match almost anywhere and are meant to
be searched for by name. The `.mtf` files are parsed in the browser as they are,
so they remain the one source of truth; nothing in the build rewrites a motif.

Add your own with `defmotif`, and it joins the library:

```lisp
(defmotif my-cassette
  "The barcode cassette our lab puts on every construct."
  (seq "GGTCTC" (gap 1 1) (named 'overhang (gap 4 4)) (named 'barcode (gap 8 8)))
  :category 'lab :alphabet 'dna :ref "internal, plate map 2026-03")
```

## Fetching sequences

The page retrieves sequences directly from the public databases, with no server
in between.

| Source | Reached by |
|---|---|
| NCBI Nucleotide | accession (`NM_000518`, `NC_000011`) or free-text search, with NCBI field syntax |
| Ensembl | gene symbol (`HBB`), stable ID (`ENSG…`, `ENST…`), or a region (`11:5225464-5229395`) |
| ENA | accession |
| UniProt | accession or search, for protein |

Ensembl matters most here, because it can return a gene **with its upstream
sequence**. Fetching the canonical HBB transcript with 200 bases of upstream and
searching it recovers the textbook human beta-globin promoter:

| Element | Motif | Position |
|---|---|---|
| CACCC box, the KLF1 site | `(iupac "CCACACCC")` | −93 |
| CCAAT box | `(iupac "CCAAT")` | −76 |
| TATA box | `(fuzzy 1 (iupac "TATAWAWR"))` | −32, reading `CATAAAAG` |

The strict Bucher consensus `TATAWAWR` finds nothing there: HBB's real TATA box
is a natural variant with a C in the first position. It is a built-in example.

RNAcentral is absent for a specific reason — it sends no
`Access-Control-Allow-Origin` header, so a browser cannot call it and there is
no server here to proxy through. Every other endpoint was checked before being
added, and a test fails if a host is fetched that the policy does not allow.

**What the page sends, and what it does not.** A request goes out only when you
press Fetch or Search, and carries only what is in that box: an accession, a
gene symbol, a region, a search term. A sequence you paste or open from a file
is never sent anywhere — matching runs in the page, and `connect-src` lists
those four databases, `openrouter.ai` for the assistant, and not `'self'`, so
the page cannot post it back to its own origin either. The assistant is the one
thing that sends text you typed, and only what is in the ask box. That said, `connect-src` restricts where a request may go,
not what it may contain; the guarantee is the short host list together with the
code, not the policy by itself.

## The assistant

Describe a motif in English and have the expression written for you. Two
providers, tried in order:

1. **`window.claude`**, which the Claude artifact viewer injects. Nothing to set
   up and no key: the request runs on the viewer's own account.
2. **[OpenRouter](https://openrouter.ai)** with a key you supply, which is what
   the Fly deployment and any self-hosted copy use.

The key is typed into Assistant settings, held in that tab's `sessionStorage`,
and sent only to `openrouter.ai` — there is no server here to send it to, and it
is never written into a link. Closing the tab forgets it. The model defaults to
`anthropic/claude-sonnet-5` and is a free-text field, so any OpenRouter model id
works; the catalogue loads into a datalist for completion. Each reply is
followed by what the turn cost — `model · 1,180 in · 96 out · $0.0042`.

**Example requests** sits under the ask box: 72 questions grouped by subject,
with the groups that fit the loaded sequence first. Clicking one fills the box
rather than sending it, so you can edit before spending a request.

They are deliberately things the library does *not* already contain. A single
named motif needs no assistant — you click it in the list on the left. What
needs writing is the composition: two elements a set distance apart, a library
motif with an extra constraint, a pattern specific to one lab's constructs. A
test enforces this, because the first set of examples got it wrong: they were
written out of the library's own subject matter, so the assistant's honest reply
to nearly all of them was "you already have this".

The reply is constrained to a JSON schema where the model supports it, and
salvaged from the surrounding text where it does not. It always arrives as motif
source you can read and edit, so a generated pattern is auditable rather than
opaque, and it tells you when the library already has what you asked for.

This is why the app still needs no server. A proxy holding one shared key would
work for visitors with nothing to set up, but it would end the static deployment
and put the bill behind a public URL.

Nothing else on the page depends on the assistant.

## Performance

The matchers are generators, so backtracking is the generator protocol. On 1 Mb
of random DNA:

| Pattern | Throughput |
|---|---|
| Literal `GAATTC` | 10.3 Mb/s |
| IUPAC `TATAWAWR` | 10.0 Mb/s |
| Sigma-70 promoter, two fuzzy boxes and a gap | 8.1 Mb/s |
| Hairpin, stem 5 to 10 | 0.2 Mb/s |

Fast enough for plasmids, genes, promoter sets and bacterial genomes. Not fast
enough for a vertebrate genome, and a fetch above 12 Mb is refused rather than
left to crawl.

## Deploying

The repo carries a [fly.io](https://fly.io) configuration. There is no server
component, so a deployment is a static build served by nginx: no secrets, no
environment variables, no volumes, no database. The whole tool, including the
motif library, is built into the image.

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

Fly starts two machines on a first deploy, for zero-downtime deploys rather than
for load. One is plenty for a static page:

```bash
fly scale count 1
```

The machine sleeps when idle (`auto_stop_machines = 'suspend'` with
`min_machines_running = 0`), so an unvisited deployment costs nothing and the
first request after an idle period pays about a second of wake-up.

To check the image locally:

```bash
docker build -t biomotif . && docker run --rm -p 8080:80 biomotif
```

## Layout

```
web/src/      engine, motif builder, database clients, assistant, interface
web/test/     126 tests, run with `npm test`
library/      the seven .mtf files — the motif library itself
data/         example sequences, generated by tools/make-data.mjs
tools/        build, data and index generators, and a local server
deploy/       nginx config and the content security policy
docs/         the full motif catalogue, generated
```

The example sequences are synthetic and reproducible: random background at a
chosen GC content with real consensus elements planted at known positions, so
every demo has a known right answer. CI rebuilds them and fails if they drift.

## Contributing

Pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md), which has
the recipe for adding a motif. The most valuable contribution is a motif that
is wrong or a motif that is missing; only 72 of the 487 entries cite a paper,
so any of them may be mistaken.

## Licence

MIT — Copyright (c) 2026 Andre Paquette. See [LICENSE](LICENSE).

The motif library is a set of published consensus sequences, each defined in a
`.mtf` file with a docstring, and with a literature reference where one exists
— 72 of the 487 carry one. Some follow catalogues with their own
terms, which this licence does not override: restriction sites derive from
[REBASE](http://rebase.neb.com), Copyright (c) Dr. Richard J. Roberts, free for
academic use; many protein patterns are written in, and several taken from,
[PROSITE](https://prosite.expasy.org); plant elements draw on PLACE and
PlantCARE. Sequences fetched at runtime come from NCBI, Ensembl, ENA and
UniProt under those services' terms. See
[CONTRIBUTING.md](CONTRIBUTING.md#attribution-of-bundled-data) for the detail.
