/* Retrieving sequences from the public nucleotide databases.
   Every endpoint here was checked to send Access-Control-Allow-Origin, because
   the page has no server to proxy through: a database that refuses
   cross-origin requests simply cannot be reached from a browser. RNAcentral is
   the notable absence for that reason. */

import { BiomotifError, parseFasta } from "./engine.js";

const NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ENSEMBL = "https://rest.ensembl.org";
const ENA = "https://www.ebi.ac.uk/ena/browser/api";
const UNIPROT = "https://rest.uniprot.org";

// NCBI asks that automated requests identify themselves.
const TOOL = "tool=biomotif";

export const SOURCES = {
  ncbi: { label: "NCBI Nucleotide", host: "eutils.ncbi.nlm.nih.gov", searchable: true,
          note: "GenBank and RefSeq. Accessions like NM_000518, NC_000011 or a free-text search." },
  ensembl: { label: "Ensembl", host: "rest.ensembl.org", searchable: false,
             note: "Genes by symbol or stable ID, and genomic regions. The only source that can add upstream sequence." },
  ena: { label: "ENA", host: "www.ebi.ac.uk", searchable: false,
         note: "European Nucleotide Archive, by accession." },
  uniprot: { label: "UniProt", host: "rest.uniprot.org", searchable: true,
             note: "Protein sequences, by accession or search." },
};

/** Sequences beyond this are refused: the browser holds the whole string, and
    the structural matchers are far too slow to be useful at that size. */
const MAX_BASES = 12_000_000;

const RE = {
  refseq: /^(?:N[CGMRTWZ]|X[MRP]|[ANY]P|Z[PG])_\d+(?:\.\d+)?$/i,
  genbank: /^[A-Z]{1,3}\d{5,8}(?:\.\d+)?$/i,
  ensembl: /^ENS[A-Z]{0,4}[GTP]\d{6,}(?:\.\d+)?$/i,
  region: /^(?:chr)?([\w.]+)[:\s]([\d,]+)\s*(?:\.\.|-|–)\s*([\d,]+)\s*(?::([+-]?1))?$/i,
  uniprot: /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i,
  symbol: /^[A-Za-z][A-Za-z0-9._-]{0,20}$/,
};

/** Guess which database an identifier belongs to. Returns null when the text
    looks like a search rather than an identifier. */
export function detectSource(query) {
  const q = query.trim();
  if (!q) return null;
  if (RE.region.test(q)) return "ensembl";
  if (RE.ensembl.test(q)) return "ensembl";
  if (RE.refseq.test(q)) return "ncbi";
  if (RE.uniprot.test(q)) return "uniprot";
  if (RE.genbank.test(q)) return "ncbi";
  if (RE.symbol.test(q)) return "ensembl";     // a bare word is most likely a gene symbol
  return null;
}

async function get(url, { signal, accept = "text/plain", what = "that identifier", where = "the database" } = {}) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: accept } });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new BiomotifError(`Could not reach ${where}. Check the connection and try again.`);
  }
  if (res.status === 429) {
    const wait = res.headers.get("retry-after");
    throw new BiomotifError(`${where} is rate limiting requests${wait ? `; try again in ${wait} s` : ", so wait a moment"}.`);
  }
  // Every one of these databases answers an unknown or malformed identifier
  // with 400 as readily as 404, so the two mean the same thing to a reader.
  if (res.status === 404 || res.status === 400) {
    throw new BiomotifError(`${where} has no record for ${what}. Check the spelling, or use Search by name.`);
  }
  if (res.status >= 500) throw new BiomotifError(`${where} is having trouble (${res.status}). Try again shortly.`);
  if (!res.ok) throw new BiomotifError(`${where} returned ${res.status} for ${what}.`);
  return res;
}

function guard(records) {
  const total = records.reduce((n, r) => n + r.seq.length, 0);
  if (total > MAX_BASES) {
    throw new BiomotifError(
      `That record is ${(total / 1e6).toFixed(1)} Mb, past the ${MAX_BASES / 1e6} Mb this page will hold. ` +
      "Fetch a region instead, for example 11:5225464-5229395.");
  }
  if (!records.length || !records.some((r) => r.seq)) {
    throw new BiomotifError("The database returned no sequence for that identifier.");
  }
  return records;
}

/* --------------------------------------------------------- what a record is

   Every database states what a record is, but none of them state it the same
   way, and one of them does not state it at all. These turn each convention
   into the same plain sentence, so a fetched sequence can say what it is
   instead of only what it is called. */

/** A UniProt defline carries the description and then a run of key=value
    fields: "Hemoglobin subunit beta OS=Homo sapiens OX=9606 GN=HBB PE=1 SV=2".
    Only the part before the first key is the description. */
export function uniprotDefline(text) {
  const cut = text.search(/\s(?:OS|OX|GN|PE|SV)=/);
  const description = (cut === -1 ? text : text.slice(0, cut)).trim();
  const organism = /\sOS=(.+?)(?=\s(?:OX|GN|PE|SV)=|$)/.exec(text)?.[1]?.trim() ?? "";
  const gene = /\sGN=(\S+)/.exec(text)?.[1] ?? "";
  return { description, organism, gene };
}

/** Ensembl descriptions end in a source credit — "haemoglobin subunit beta
    [Source:HGNC Symbol;Acc:HGNC:4827]" — which is provenance, not description. */
export function ensemblDescription(text) {
  return (text ?? "").replace(/\s*\[Source:[^\]]*\]\s*$/, "").trim();
}

/** Ensembl labels sequence with coordinates and nothing else:
    "chromosome:GRCh38:11:5225464:5229395:-1". Said in words those coordinates
    are the only description a bare region has. */
export function ensemblCoordinates(text) {
  const m = /^(\w+):([^:\s]+):([^:\s]+):(\d+):(\d+):(-?1)$/.exec((text ?? "").trim());
  if (!m) return "";
  const [, kind, assembly, name, from, to, strand] = m;
  return `${kind} ${name}:${Number(from).toLocaleString()}-${Number(to).toLocaleString()} ` +
         `on the ${strand === "-1" ? "minus" : "plus"} strand of ${assembly}`;
}

/** Give every record in a set the same description, when it has none of its own. */
function describeRecords(records, description) {
  if (!description) return records;
  for (const r of records) r.description = description;
  return records;
}

/* ------------------------------------------------------------------- NCBI */

async function ncbiFetch(id, { signal }) {
  const url = `${NCBI}/efetch.fcgi?db=nuccore&id=${encodeURIComponent(id)}&rettype=fasta&retmode=text&${TOOL}`;
  const text = await (await get(url, { signal, what: id, where: "NCBI" })).text();
  if (/^\s*$/.test(text) || text.startsWith("Error")) {
    throw new BiomotifError(`NCBI has no nucleotide record for ${id}.`);
  }
  return guard(parseFasta(text));
}

export async function ncbiSearch(term, { signal, limit = 20 } = {}) {
  limit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.round(limit)), 200) : 20;
  const esearch = `${NCBI}/esearch.fcgi?db=nuccore&term=${encodeURIComponent(term)}` +
                  `&retmode=json&retmax=${limit}&${TOOL}`;
  const found = await (await get(esearch, { signal, accept: "application/json", what: `“${term}”`, where: "NCBI" })).json();
  const ids = found?.esearchresult?.idlist ?? [];
  // NCBI reports how many records matched, which is routinely thousands more
  // than were asked for. Losing that number makes a truncated list look complete.
  const total = Number(found?.esearchresult?.count ?? ids.length);
  if (!ids.length) return { results: [], total: 0 };
  const esummary = `${NCBI}/esummary.fcgi?db=nuccore&id=${ids.join(",")}&retmode=json&${TOOL}`;
  const summary = await (await get(esummary, { signal, accept: "application/json", where: "NCBI" })).json();
  const result = summary?.result ?? {};
  const results = (result.uids ?? []).map((uid) => {
    const r = result[uid] ?? {};
    return {
      source: "ncbi",
      id: r.accessionversion || r.caption || uid,
      label: r.accessionversion || r.caption || uid,
      description: r.title || "",
      organism: r.organism || "",
      length: r.slen ?? null,
      moltype: r.moltype || "",
    };
  });
  return { results, total };
}

/* ---------------------------------------------------------------- Ensembl */

async function ensemblLookup(symbol, species, { signal }) {
  const url = `${ENSEMBL}/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}` +
              "?content-type=application/json";
  return (await get(url, { signal, accept: "application/json", what: symbol, where: `Ensembl (${species.replace(/_/g, " ")})` })).json();
}

/* Ensembl returns sequence labelled with coordinates and no description, so
   when the query was already an Ensembl id there is nothing to say about the
   record until it is looked up separately. The sequence is the thing that was
   asked for, so a lookup that fails costs the description and not the fetch. */
async function ensemblLookupId(id, { signal }) {
  try {
    const url = `${ENSEMBL}/lookup/id/${encodeURIComponent(id)}?content-type=application/json`;
    return await (await get(url, { signal, accept: "application/json", what: id, where: "Ensembl" })).json();
  } catch (err) {
    if (err.name === "AbortError") throw err;
    return null;
  }
}

async function ensemblFetch(query, { signal, species = "homo_sapiens", upstream = 0 }) {
  const region = RE.region.exec(query.trim());
  if (region) {
    const [, chrom, from, to, strand] = region;
    const a = from.replace(/,/g, ""), b = to.replace(/,/g, "");
    const url = `${ENSEMBL}/sequence/region/${encodeURIComponent(species)}/` +
                `${chrom}:${a}..${b}${strand ? `:${strand}` : ""}?content-type=text/x-fasta`;
    const records = guard(parseFasta(await (await get(url, { signal, what: query.trim(), where: "Ensembl" })).text()));
    // A bare region belongs to no gene, so its coordinates are all there is to say.
    for (const r of records) {
      const said = ensemblCoordinates(r.description) || ensemblCoordinates(r.name);
      if (said && !r.description) r.name = `${chrom}:${Number(a).toLocaleString()}-${Number(b).toLocaleString()}`;
      r.description = said || r.description;
    }
    return { records, info: null };
  }

  let id = query.trim();
  let info = null;
  if (!RE.ensembl.test(id)) {
    info = await ensemblLookup(id, species, { signal });
    if (!info?.id) throw new BiomotifError(`Ensembl has no gene called ${id} in ${species.replace(/_/g, " ")}.`);
    id = info.id;
  }
  const expand = upstream > 0 ? `;expand_5prime=${Math.min(upstream, 100000)}` : "";
  const url = `${ENSEMBL}/sequence/id/${encodeURIComponent(id)}?content-type=text/x-fasta;type=genomic${expand}`;
  const records = guard(parseFasta(await (await get(url, { signal, what: id, where: "Ensembl" })).text()));
  info = info ?? await ensemblLookupId(id, { signal });
  const said = ensemblDescription(info?.description);
  const where = ensemblCoordinates(records[0]?.description);
  describeRecords(records, [info?.display_name, said, where].filter(Boolean).join(", "));
  return { records, info };
}

/* -------------------------------------------------------------------- ENA */

async function enaFetch(accession, { signal }) {
  const url = `${ENA}/fasta/${encodeURIComponent(accession)}`;
  const text = await (await get(url, { signal, what: accession, where: "ENA" })).text();
  if (!text.trim().startsWith(">")) throw new BiomotifError(`ENA has no record for ${accession}.`);
  return guard(parseFasta(text));
}

/* ---------------------------------------------------------------- UniProt */

async function uniprotFetch(accession, { signal }) {
  const url = `${UNIPROT}/uniprotkb/${encodeURIComponent(accession)}.fasta`;
  const text = await (await get(url, { signal, what: accession, where: "UniProt" })).text();
  if (!text.trim().startsWith(">")) throw new BiomotifError(`UniProt has no entry for ${accession}.`);
  const records = guard(parseFasta(text, "protein"));
  for (const r of records) {
    const { description, organism, gene } = uniprotDefline(r.description);
    r.description = [description, gene && `gene ${gene}`, organism].filter(Boolean).join(", ");
  }
  return records;
}

export async function uniprotSearch(term, { signal, limit = 20 } = {}) {
  limit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.round(limit)), 200) : 20;
  const url = `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(term)}` +
              `&format=json&size=${limit}&fields=accession,id,protein_name,organism_name,length`;
  const response = await get(url, { signal, accept: "application/json", what: `“${term}”`, where: "UniProt" });
  const total = Number(response.headers.get("x-total-results") ?? NaN);
  const data = await response.json();
  const results = (data.results ?? []).map((r) => ({
    source: "uniprot",
    id: r.primaryAccession,
    label: r.primaryAccession,
    description: r.proteinDescription?.recommendedName?.fullName?.value || r.uniProtkbId || "",
    organism: r.organism?.scientificName || "",
    length: r.sequence?.length ?? null,
    moltype: "protein",
  }));
  return { results, total: Number.isFinite(total) ? total : results.length };
}

/* ------------------------------------------------------------------ front */

/** Fetch by identifier. Returns {records, info, source}. */
export async function fetchSequence(query, { source = "auto", species = "homo_sapiens",
                                             upstream = 0, signal } = {}) {
  const q = query.trim();
  if (!q) throw new BiomotifError("Enter an accession, a gene symbol or a region.");
  const chosen = source === "auto" ? detectSource(q) : source;
  if (!chosen) throw new BiomotifError(`${q} does not look like an identifier. Use Search to look it up by name.`);

  if (chosen === "ensembl") {
    const { records, info } = await ensemblFetch(q, { signal, species, upstream });
    return { records, info, source: chosen };
  }
  if (chosen === "ncbi") return { records: await ncbiFetch(q, { signal }), info: null, source: chosen };
  if (chosen === "ena") return { records: await enaFetch(q, { signal }), info: null, source: chosen };
  if (chosen === "uniprot") return { records: await uniprotFetch(q, { signal }), info: null, source: chosen };
  throw new BiomotifError(`Unknown source ${chosen}.`);
}

/** Look a sequence up by name. Only NCBI and UniProt offer free-text search.
    Returns {results, total}: `total` is how many the database matched, which is
    usually far more than were asked for. */
export async function searchDatabase(term, { source = "ncbi", signal, limit = 20 } = {}) {
  if (!term.trim()) return { results: [], total: 0 };
  if (source === "uniprot") return uniprotSearch(term, { signal, limit });
  return ncbiSearch(term, { signal, limit });
}

export const CONNECT_HOSTS = Object.values(SOURCES).map((s) => `https://${s.host}`);
