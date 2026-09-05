# Biomotif

**[biomotif.fly.dev](https://biomotif.fly.dev)**

A browser workbench for sequence patterns. Describe a motif as an expression,
find it in DNA, RNA or protein, and read the result — with a library of 523
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
npm test           # 190 tests
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

523 motifs in eight files, each with a docstring, a category and, where one
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
| `jaspar.mtf` | 36 measured weight matrices from JASPAR, generated — see below |

### Consensus and measurement

The library describes a binding site twice over, and the difference is the
point. `tata-box` is the consensus — `TATAWAWR`, one spelling with ambiguity
codes, the way a textbook writes it. `tbp-matrix` is the same site as JASPAR
measured it, a weight matrix in which every position carries its own score.
Run both on a promoter and the consensus reports several candidates while the
matrix picks one and says how well it scored.

There are 36 such matrices, one for each factor the library already named as a
consensus, plus a few from groups it barely reached — yeast, flies, worms,
plants. Each carries its JASPAR id and the paper behind it.

Their thresholds are calibrated rather than guessed. A blanket relative score is
meaningless across matrices of different widths: 0.85 makes a seven-position
matrix fire every few hundred bases and a thirty-three-position one almost
never. `tools/fetch-jaspar.mjs` samples random DNA for each matrix and sets the
threshold where chance would give about one match per 10,000 bases — then writes
into the docstring the rate it *actually* achieved, because a short matrix
cannot be that specific. Six positions distinguish at best one sequence in
4,096, and saying so is more useful than pretending otherwise.

Scanning skips 166 entries flagged `:scan #f`. Those are templates and
scaffolds — `pam-spcas9`, `umi-8` — that match almost anywhere and are meant to
be searched for by name. The `.mtf` files are parsed in the browser as they are,
so they remain the one source of truth; nothing in the build rewrites a motif.

The rail lists in name order throughout — unfiltered, by category and by search
— with digits compared by value, so `mirna-seed-mir21` files before
`mirna-seed-mir155`. Motifs the loaded sequence cannot match are faded where
they stand and marked *needs a protein* or *needs DNA or RNA*, rather than
sorted out of the way: a name stays where you looked it up, and reading a motif
is not the same as running it. Only the protein/nucleotide divide counts. An
RNA motif applies to DNA, because the engine reads U and T as the same base.

Add your own with `defmotif`, and it joins the library:

```lisp
(defmotif my-cassette
  "The barcode cassette our lab puts on every construct."
  (seq "GGTCTC" (gap 1 1) (named 'overhang (gap 4 4)) (named 'barcode (gap 8 8)))
  :category 'lab :alphabet 'dna :ref "internal, plate map 2026-03")
```

## What this means

Above the results is a pane that says, in plain English, what you are looking
at: what the sequence is, what the pattern looks for, what was found, and
whether finding that much means anything.

That last part is the one people get wrong, and it is computed rather than
asserted. The sequence is shuffled twenty times — same base composition,
scrambled order — and the pattern is run against each. If a pattern turns up as
often in the scrambled versions as in the real one, it is telling you about the
sequence's composition and nothing else:

| Pattern | Found | Expected by chance | |
|---|---|---|---|
| `loxp` | 1 | 0.0 | only in the real sequence |
| `t7-promoter` | 1 | 0.0 | only in the real sequence |
| `poly-a-signal` | 4 | 0.8 | over-represented |
| `e-box` | 17 | 17.9 | **noise** |

Seventeen E-box matches look like seventeen findings. They are not one. A
beginner has no way to know that, so the pane says it, and the verdict carries a
coloured rule so it reads at a glance. One pattern on a 2.7 kb plasmid costs
about 10 ms.

The shuffle draws from a seeded xorshift32 generator: seeded so that the same
sequence is always explained the same way, and xorshift because the decoys have
to be genuinely shuffled. An earlier linear congruential generator multiplied
its seed past the integers a JavaScript number holds exactly, losing the low
bits — 20,000 draws visited 12,889 distinct states — which quietly weakened
every estimate on this page.

A scan gets its own version of this. It reports how many *places* the matches
sit at rather than how many matches there are — several patterns routinely
describe one feature, so 53 matches can be 41 places — and it warns when a
pattern that acts on RNA has been found in DNA, which only means anything if
that stretch is transcribed, and only from the strand that is.

Nothing in the pane comes from a model — it is all computed, so it needs no key
and appears instantly. Library descriptions are quoted as their authors wrote
them, for readers who know the field; everything the pane composes around them
is written for readers who do not.

## Fetching sequences

The page retrieves sequences directly from the public databases, with no server
in between.

| Source | Reached by |
|---|---|
| NCBI Nucleotide | accession (`NM_000518`, `NC_000011`) or free-text search, with NCBI field syntax |
| Ensembl | gene symbol (`HBB`), stable ID (`ENSG…`, `ENST…`), or a region (`11:5225464-5229395`) |
| ENA | accession |
| UniProt | accession or search, for protein |

A search reports how many the database matched, not only how many it listed.
NCBI routinely matches tens of thousands, and twenty results that look like the
whole answer are worse than none. Twenty come back first, forty more each time
you ask, to a ceiling of two hundred — past which narrowing the search beats
scrolling it.

Every fetched record carries its description, so the pane can say what a
sequence is and not only what it is called. The four databases state that four
ways, and one of them does not state it at all: NCBI and ENA put a title on the
FASTA defline; UniProt buries one among `OS=`/`GN=`/`PE=` fields, which are
split off to keep the organism and gene; Ensembl labels sequence with
coordinates only, so the record is looked up separately for its description, and
a bare region — belonging to no gene — is described by its coordinates said in
words. A lookup that fails costs the description, not the sequence.

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

Every fetched position comes with the genome build it was read from — GRCh38,
GRCm39 — in the fetch status and in the explanation of the sequence, because a
position copied into another tool means nothing without it: the same HBB
region sits some 40 kb away on GRCh37.

The species field is free text, since Ensembl serves tens of thousands of
genomes across its divisions and no list of them belongs in a page. Focusing
the field loads Ensembl's vertebrate list into the completions; typing
`Homo sapiens` is read as `homo_sapiens`; and a lookup that fails is followed
by one cheap question — does this species exist at all? — so `homo_sapein` is
reported as a misspelt species, with the name meant, rather than as a gene
Ensembl has never heard of.

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

## Sharing and teaching

**Links.** The address bar always describes what is on screen: the motif, by
name when it is the library's, and where the sequence came from — which
example, or which record and how it was asked for. **Copy link** puts the whole
URL on the clipboard, so a promoter with a pattern loaded can be handed to a
class. A sequence you paste or open from a file is never in a link, and neither
is the assistant key. A link is typed by anyone, so what it may say is bounded:
unknown keys are dropped and its numbers are clamped.

**Walkthroughs.** Two lessons at the top of the page teach the tool one step at
a time. *A bacterial gene, from promoter to terminator* uses the built-in operon
and needs no connection: it finds the promoter, the ribosome binding sites and
the terminator, and on the way shows what a bad pattern looks like — `start-codon`
matches 125 times, and chance would give 119. *The human beta-globin promoter*
fetches HBB from Ensembl with its upstream region and finds the three textbook
boxes, including the TATA box the strict consensus misses because it begins
with a C. Each step says what to look for, and each step is a link
(`#lesson=operon/4`), so a class can be sent to a given point.

**The picture and the table point at each other.** Clicking a row in the table
scrolls the sequence to that match and flashes it — reading a position number
and finding it by eye is the part beginners struggle with — and clicking a
highlighted run picks out the matches it belongs to in the table. Rows are
reachable with Tab and Enter.

**A drawn gel.** Digest shows the pieces as they would look on an agarose gel:
each enzyme alone, then both, beside a 1 kb ladder, on a log scale, with a
band's darkness following the fragment's mass. It is drawn with attributes and
classes only, since the policy allows no inline style, and described in words
for anyone who cannot see it.

**A glossary.** The words the explanation cannot avoid — strand, consensus,
reading frame, weight matrix — carry a definition on hover or keyboard focus at
their first appearance in each passage.

**Offline.** The served build keeps its own three files in a service worker,
so a classroom without a connection still has the library, the examples and
both offline lessons. Nothing else is cached: a fetched sequence, an assistant
reply and the fonts pass straight through. The worker is served under a policy
of its own, because a worker's fetches answer to the policy its script came
with and the page's leaves out `'self'` on purpose.

## Performance

The matchers are generators, so backtracking is the generator protocol. On 1 Mb
of random DNA, median of five warmed runs, Node 24 on an Apple M3:

| Pattern | Throughput |
|---|---|
| Literal `GAATTC` | 7.7 Mb/s |
| IUPAC `TATAWAWR` | 6.4 Mb/s |
| Sigma-70 promoter, two fuzzy boxes and a gap | 2.0 Mb/s |
| Hairpin, stem 5 to 10 | 0.1 Mb/s |

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
web/src/      engine, motif builder, database clients, assistant, explanations, glossary,
              links, gel, walkthroughs, interface
web/test/     190 tests, run with `npm test`; dom.mjs is the small DOM the interface tests run in
library/      the eight .mtf files — the motif library itself
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
is wrong or a motif that is missing; only 108 of the 523 entries cite a paper,
so any of them may be mistaken.

## Licence

MIT — Copyright (c) 2026 Andre Paquette. See [LICENSE](LICENSE).

The motif library is a set of published consensus sequences, each defined in a
`.mtf` file with a docstring, and with a literature reference where one exists
— 108 of the 523 carry one. Some follow catalogues with their own
terms, which this licence does not override: restriction sites derive from
[REBASE](http://rebase.neb.com), Copyright (c) Dr. Richard J. Roberts, free for
academic use; many protein patterns are written in, and several taken from,
[PROSITE](https://prosite.expasy.org); plant elements draw on PLACE and
PlantCARE; the weight matrices come from [JASPAR](https://jaspar.elixir.no)
under CC BY 4.0. Sequences fetched at runtime come from NCBI, Ensembl, ENA and
UniProt under those services' terms. See
[CONTRIBUTING.md](CONTRIBUTING.md#attribution-of-bundled-data) for the detail.
