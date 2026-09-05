/* Sequence retrieval. Nothing here touches the network: these check the parts
   that decide what request to make and how a failure is explained. Whether a
   database actually answers is checked by hand, not in CI, because a test that
   depends on NCBI being up fails for reasons that are not our fault. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { BiomotifError } from "../src/engine.js";
import {
  CONNECT_HOSTS, SOURCES, detectSource, ensemblCoordinates, ensemblDescription,
  fetchSequence, uniprotDefline,
} from "../src/databases.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "web", "src", "databases.js"), "utf8");

test("an identifier is routed to the database that holds it", () => {
  assert.equal(detectSource("NM_000518"), "ncbi");
  assert.equal(detectSource("NC_000011.10"), "ncbi");
  assert.equal(detectSource("ENSG00000244734"), "ensembl");
  assert.equal(detectSource("ENST00000335295.4"), "ensembl");
  assert.equal(detectSource("11:5225464-5229395"), "ensembl");
  assert.equal(detectSource("chr11:5,225,464-5,229,395"), "ensembl");
  assert.equal(detectSource("P69905"), "uniprot");
  assert.equal(detectSource("HBB"), "ensembl", "a bare word is most likely a gene symbol");
});

test("free text is not an identifier, and says so", async () => {
  assert.equal(detectSource("hemoglobin beta human"), null);
  await assert.rejects(() => fetchSequence("hemoglobin beta human"),
    /does not look like an identifier/);
});

test("an empty query is refused before any request is made", async () => {
  await assert.rejects(() => fetchSequence("   "), BiomotifError);
});

test("every source is described for the interface", () => {
  for (const [key, s] of Object.entries(SOURCES)) {
    assert.ok(s.label, key);
    assert.ok(s.host && !s.host.includes("/"), key);
    assert.ok(s.note, key);
  }
});

test("the hosts the page may reach are exactly the four databases", () => {
  assert.deepEqual([...CONNECT_HOSTS].sort(), [
    "https://eutils.ncbi.nlm.nih.gov",
    "https://rest.ensembl.org",
    "https://rest.uniprot.org",
    "https://www.ebi.ac.uk",
  ]);
});

test("every host in the code is allowed by the deployed policy", () => {
  const headers = readFileSync(join(ROOT, "deploy", "security-headers.conf"), "utf8");
  const csp = headers.match(/Content-Security-Policy "([^"]+)"/)[1];
  const allowed = new Set(csp.match(/connect-src ([^;]+);/)[1].split(/\s+/));
  const used = new Set([...SRC.matchAll(/"(https:\/\/[a-z0-9.-]+)"/g)].map((m) => m[1]));
  for (const host of used) assert.ok(allowed.has(host), `${host} is fetched but not in connect-src`);
  assert.ok(!allowed.has("'self'"), "the page must not be able to post a sequence to its own origin");
  assert.ok(!allowed.has("*"));
});

test("NCBI requests identify themselves, as NCBI asks", () => {
  assert.match(SRC, /TOOL = "tool=biomotif"/);
  for (const stmt of SRC.match(/\$\{NCBI\}\/[\s\S]*?;/g) ?? []) {
    assert.ok(stmt.includes("${TOOL}"), stmt.slice(0, 80));
  }
});

test("a fetch has a size ceiling, with a way out in the message", () => {
  assert.match(SRC, /MAX_BASES/);
  assert.match(SRC, /Fetch a region instead/);
});

test("RNAcentral's absence is explained where someone would re-add it", () => {
  assert.match(SRC, /RNAcentral/);
  assert.match(SRC, /Access-Control-Allow-Origin/);
});

test("a failure names both the record and the database", () => {
  // The message template is what the interface shows; check it is specific.
  assert.match(SRC, /has no record for \$\{what\}/);
  assert.match(SRC, /rate limiting requests/);
  assert.match(SRC, /Could not reach \$\{where\}/);
});

test("a UniProt defline is split from the fields packed after it", () => {
  const { description, organism, gene } = uniprotDefline(
    "Hemoglobin subunit beta OS=Homo sapiens OX=9606 GN=HBB PE=1 SV=2");
  assert.equal(description, "Hemoglobin subunit beta");
  assert.equal(organism, "Homo sapiens");
  assert.equal(gene, "HBB");
  // A defline with no fields at all is all description.
  assert.equal(uniprotDefline("Something uncharacterised").description, "Something uncharacterised");
});

test("Ensembl's source credit is provenance, not description", () => {
  assert.equal(ensemblDescription("hemoglobin subunit beta [Source:HGNC Symbol;Acc:HGNC:4827]"),
    "hemoglobin subunit beta");
  assert.equal(ensemblDescription(null), "");
});

test("Ensembl coordinates are turned into a sentence, since that is all a region has", () => {
  assert.equal(ensemblCoordinates("chromosome:GRCh38:11:5225464:5229395:-1"),
    "chromosome 11:5,225,464-5,229,395 on the minus strand of GRCh38");
  assert.equal(ensemblCoordinates("chromosome:GRCh38:11:5225464:5225500:1"),
    "chromosome 11:5,225,464-5,225,500 on the plus strand of GRCh38");
  // Anything that is not a coordinate string is left for someone else to describe.
  assert.equal(ensemblCoordinates("Homo sapiens hemoglobin subunit beta (HBB), mRNA"), "");
});
