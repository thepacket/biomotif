/* A plain-language account of what is on screen.

   Written for someone who does not already know the biology: what the loaded
   sequence is, what the motif looks for, what was found, and — the part people
   get wrong — whether finding that much means anything.

   All of it is computed, none of it is asked of a model, so it works with no
   key and appears instantly. */

import { Record, search } from "./engine.js";
import { gcContent } from "./library.js";

const n = (x) => x.toLocaleString();
const plural = (count, one, many) => `${n(count)} ${count === 1 ? one : many}`;

/* ------------------------------------------------------- chance correction */

/** Shuffling keeps the base composition and destroys the arrangement, so the
    hits that survive are the ones composition alone explains. It works for any
    motif, however complex, which a closed-form probability would not. */
const SHUFFLE_TRIALS = 20;
const SHUFFLE_LIMIT = 200_000;   // beyond this the wait stops being worth it

function shuffled(seq, rand) {
  const a = [...seq];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("");
}

export function expectedByChance(matcher, record, { trials = SHUFFLE_TRIALS } = {}) {
  if (record.seq.length > SHUFFLE_LIMIT) return null;
  let s = 1234567;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const decoy = new Record("shuffled", shuffled(record.seq, rand), record.type);
    try { total += search(matcher, decoy).length; } catch { return null; }
  }
  return total / trials;
}

/** What the comparison means, in a sentence someone can act on. */
function verdict(observed, expected) {
  if (expected === null) return null;
  if (observed === 0) {
    return expected < 0.5
      ? { tone: "none", text: "Nothing found — and a sequence like this would not usually contain one by accident either, so its absence is meaningful." }
      : { tone: "none", text: `Nothing found, though chance alone would put about ${expected.toFixed(1)} here. Its absence is not surprising.` };
  }
  if (expected < 0.05) {
    return { tone: "strong", text: "Scrambling this sequence never produces this pattern, so finding it here is very unlikely to be an accident. Treat it as real." };
  }
  const ratio = observed / expected;
  if (ratio >= 5) return { tone: "strong", text: `That is about ${ratio.toFixed(0)} times more than chance would give (${expected.toFixed(1)}). Strongly over-represented, so worth taking seriously.` };
  if (ratio >= 2) return { tone: "some", text: `Chance alone would give about ${expected.toFixed(1)}, so there are more here than expected. Suggestive, but not proof on its own.` };
  if (ratio >= 0.7) return { tone: "noise", text: `Chance alone would give about ${expected.toFixed(1)} — near enough the same. A sequence of this composition contains this pattern anyway, so these matches probably mean nothing on their own.` };
  return { tone: "noise", text: `Chance alone would give about ${expected.toFixed(1)}, more than were actually found. These are not evidence of anything.` };
}

/* ------------------------------------------------------------- the pieces */

function describeSequence(record, origin) {
  const unit = record.type === "protein" ? "amino acids long" : "bases long";
  const kind = { dna: "a DNA sequence", rna: "an RNA sequence", protein: "a protein" }[record.type];
  const bits = [`**${record.name}** is ${kind}, ${n(record.length)} ${unit}.`];
  if (record.type !== "protein") {
    const gc = gcContent(record.seq);
    const lean = gc > 0.6 ? " That is GC-rich, which is common in bacterial genomes with high GC and in promoter regions."
      : gc < 0.4 ? " That is AT-rich, which is common in regulatory regions and in some genomes overall."
      : "";
    bits.push(`Its bases are ${(gc * 100).toFixed(0)}% G or C.${lean}`);
    bits.push("DNA has two strands that read in opposite directions, so a pattern is looked for on both unless you say otherwise.");
  } else {
    bits.push("Proteins have a single direction, so there is only one way to read them.");
  }
  if (origin) bits.push(origin);
  return bits.join(" ");
}

function describeMotif(entry, matcher, source, kind) {
  const bits = [];
  if (entry) {
    // The docstring is quoted from the library as written, for people who know
    // the field. Everything after it here is written for people who do not.
    bits.push(`**${entry.name}** — ${entry.doc}`);
  } else {
    bits.push("**Your own pattern.** It is not one of the library's, so there is no published description of it.");
  }
  const [lo, hi] = matcher.span();
  const unit = kind === "protein" ? "amino acids" : "bases";
  if (hi === Infinity) bits.push(`A match runs ${lo} ${unit} or more.`);
  else if (lo === hi) bits.push(`A match is always ${lo} ${unit} long.`);
  else bits.push(`A match can be anywhere from ${lo} to ${hi} ${unit} long, because parts of it are allowed to vary in length.`);
  if (/fuzzy/.test(source)) bits.push("It allows a few letters to differ, because a real site in a real genome rarely matches the textbook version exactly.");
  if (/hairpin/.test(source)) bits.push("It also checks that the two halves of the stem actually pair with each other, so it is looking for a shape and not only a sequence.");
  if (/named/.test(source)) bits.push("Parts of it are labelled, so the table below reports each part separately.");
  return bits.join(" ");
}

function describeFindings(hits, record) {
  const anywhere = record.type === "protein"
    ? "No matches anywhere in this protein."
    : "No matches anywhere in this sequence, on either strand.";
  if (!hits.length) return anywhere;
  const fwd = hits.filter((h) => h.strand === "+").length;
  const rev = hits.length - fwd;
  const bits = [`Found ${plural(hits.length, "match", "matches")}`];
  if (record.type !== "protein" && rev) {
    bits.push(`, ${n(fwd)} reading forwards and ${n(rev)} on the opposite strand`);
  }
  bits.push(".");
  if (hits.length === 1) {
    bits.push(` It begins at position ${n(hits[0].absStart + 1)}.`);
  } else {
    const per = (hits.length / record.length) * 1000;
    bits.push(` That is about ${per.toFixed(1)} per thousand ${record.type === "protein" ? "residues" : "bases"}.`);
  }
  return bits.join("");
}

/* ------------------------------------------------------------------ front */

/** Build the description for the current state. `mode` distinguishes a single
    motif from the whole-library scan and the other buttons, which need
    different things said about them. */
export function describeState({ record, entry, matcher, source, hits, mode = "motif", origin = null }) {
  if (!record) return [{ heading: "Nothing loaded", body: "Fetch a sequence or pick an example above to begin." }];

  const sections = [{ heading: "The sequence", body: describeSequence(record, origin) }];

  if (mode === "scan") {
    const names = [...new Set(hits.map((h) => h.motif))];
    sections.push({
      heading: "What was done",
      body: "Every applicable pattern in the library was run against this sequence at once. " +
        "Patterns too short or too loose to mean anything were left out, as were restriction enzyme sites, " +
        "which have their own button.",
    });
    sections.push({
      heading: "What was found",
      body: hits.length
        ? `${plural(hits.length, "match", "matches")} from ${plural(names.length, "different pattern", "different patterns")}. ` +
          "Treat this as a list of things to look at rather than a list of findings: short patterns turn up by accident, " +
          "so run one on its own to see whether it appears more often than chance would explain."
        : "Nothing matched, which for a short sequence is entirely normal.",
    });
    return sections;
  }

  if (mode === "orfs") {
    sections.push({
      heading: "What was done",
      body: "The sequence was read in all six possible ways — three starting points on each strand — looking for stretches " +
        "that could encode a protein: a start signal, then whole three-letter codes, then a stop signal, with no stop in between. " +
        "Stretches shorter than 50 codes were ignored as too short to be a real gene.",
    });
    sections.push({
      heading: "What was found",
      body: hits.length
        ? `${plural(hits.length, "reading frame", "reading frames")}. Long ones are more likely to be genuine genes; a short one ` +
          "can easily occur by accident. The bacterial genetic code was used, which treats GTG and TTG as start signals as well as ATG."
        : "None long enough to report. That does not mean the sequence has no genes — only none of at least 50 codes with a clean start and stop.",
    });
    return sections;
  }

  if (mode === "digest") {
    sections.push({
      heading: "What was done",
      body: "Restriction enzymes are proteins that cut DNA wherever a specific short sequence appears. " +
        "Cutting with two of them turns a sequence into pieces of predictable size, which is how people check in the lab " +
        "that a piece of DNA is what they think it is.",
    });
    sections.push({
      heading: "What was found",
      body: "The cut positions and the resulting piece sizes are below. Pieces of similar size look the same on a gel, " +
        "so a useful pair of enzymes gives pieces that differ clearly in length.",
    });
    return sections;
  }

  if (matcher) {
    sections.push({ heading: "What is being looked for", body: describeMotif(entry, matcher, source, record.type) });
    const findings = { heading: "What was found", body: describeFindings(hits, record) };
    const expected = expectedByChance(matcher, record);
    const call = verdict(hits.length, expected);
    if (call) {
      findings.body += ` ${call.text}`;
      findings.tone = call.tone;
    } else if (record.seq.length > SHUFFLE_LIMIT) {
      findings.body += " This sequence is too long to check how many of these would turn up by chance.";
    }
    sections.push(findings);
    if (entry?.ref) sections.push({ heading: "Where this comes from", body: entry.ref, muted: true });
  }
  return sections;
}
