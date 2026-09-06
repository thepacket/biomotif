/* Scientific interchange formats. Pure functions live outside the interface
   controller so coordinate conventions can be tested without a browser. */

function detailOf(hit) {
  return {
    ...(hit.score != null ? { score: hit.score } : {}),
    ...hit.extra,
    ...Object.fromEntries(Object.entries(hit.bindings).map(([key, value]) => [key, value[2]])),
  };
}

export function resultsTsv(hits) {
  const rows = [["sequence", "motif", "start", "end", "length", "strand", "match", "detail"].join("\t")];
  for (const hit of hits) {
    const detail = Object.entries(detailOf(hit)).map(([key, value]) => `${key}=${value}`).join(";");
    rows.push([hit.record?.name || "", hit.motif, hit.absStart + 1, hit.absEnd, hit.length,
      hit.strand, hit.seq, detail].join("\t"));
  }
  return rows.join("\n") + "\n";
}

export function resultsBed(hits) {
  const rows = ["track name=biomotif description=\"Biomotif matches; BED coordinates are 0-based, end-exclusive\""];
  for (const hit of hits) rows.push([hit.record?.name || "sequence", hit.absStart, hit.absEnd,
    hit.motif, hit.score ?? 0, hit.strand].join("\t"));
  return rows.join("\n") + "\n";
}

export function resultsGff3(hits) {
  const rows = ["##gff-version 3", "# Biomotif coordinates are 1-based and end-inclusive"];
  const attr = (text) => encodeURIComponent(String(text)).replace(/%20/g, "+");
  for (const hit of hits) rows.push([hit.record?.name || "sequence", "Biomotif", "sequence_motif",
    hit.absStart + 1, hit.absEnd, hit.score ?? ".", hit.strand, ".",
    `Name=${attr(hit.motif)};matched_sequence=${attr(hit.seq)}`].join("\t"));
  return rows.join("\n") + "\n";
}

export function resultsJson(hits, { record = null, origin = null, mode = "motif", motif = "",
  libraryEntry = null, provenance = null } = {}) {
  return JSON.stringify({
    format: "biomotif-analysis", version: 1,
    coordinateConvention: "UI/GFF: 1-based end-inclusive; internal/BED: 0-based end-exclusive",
    sequence: record ? { name: record.name, description: record.description, type: record.type,
      length: record.length, offset: record.offset, origin } : null,
    analysis: { mode, motif, libraryEntry, provenance },
    matches: hits.map((hit) => ({ sequence: hit.record?.name || "", motif: hit.motif,
      start: hit.absStart + 1, end: hit.absEnd, length: hit.length, strand: hit.strand,
      match: hit.seq, score: hit.score, detail: detailOf(hit) })),
  }, null, 2) + "\n";
}

export function formatResults(format, hits, context = {}) {
  if (format === "bed") return { data: resultsBed(hits), ext: "bed", label: "BED" };
  if (format === "gff3") return { data: resultsGff3(hits), ext: "gff3", label: "GFF3" };
  if (format === "json") return { data: resultsJson(hits, context), ext: "json", label: "JSON report" };
  return { data: resultsTsv(hits), ext: "tsv", label: "TSV" };
}
