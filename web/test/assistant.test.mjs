/* The assistant. Nothing here reaches a model: these check the provider ladder,
   how the key is held, and that a failure is explained rather than raw. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "web", "src", "assistant.js"), "utf8");

/** sessionStorage and window do not exist in Node, so stand them up before the
    module is imported: it reads them at load. */
function stubBrowser({ claude = undefined } = {}) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  globalThis.location = { protocol: "https:", origin: "https://biomotif.fly.dev" };
  globalThis.window = { claude };
  return store;
}

stubBrowser();
const A = await import("../src/assistant.js");

test("the key lives in sessionStorage and nowhere else", () => {
  A.setApiKey("  sk-or-v1-secret  ");
  assert.equal(A.getApiKey(), "sk-or-v1-secret", "trimmed");
  A.setApiKey("");
  assert.equal(A.getApiKey(), "", "cleared");
  assert.ok(SRC.includes("sessionStorage"));
  assert.ok(!SRC.includes("localStorage"), "a key must not outlive the tab");
});

test("storage that refuses does not break the page", () => {
  const real = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() { throw new Error("private mode"); },
    setItem() { throw new Error("private mode"); },
    removeItem() { throw new Error("private mode"); },
  };
  assert.doesNotThrow(() => A.setApiKey("x"));
  assert.equal(A.getApiKey(), "");
  globalThis.sessionStorage = real;
});

test("the model defaults, and only a real choice is stored", () => {
  assert.equal(A.getModel(), A.DEFAULT_MODEL);
  A.setModel("anthropic/claude-opus-5");
  assert.equal(A.getModel(), "anthropic/claude-opus-5");
  A.setModel(A.DEFAULT_MODEL);
  assert.equal(A.getModel(), A.DEFAULT_MODEL);
  assert.ok(A.SUGGESTED_MODELS.includes(A.DEFAULT_MODEL));
});

test("the ladder prefers the viewer's own Claude when it is there", async () => {
  stubBrowser({ claude: { use: async (name) => (name === "sample" ? Object.assign(async () => {}, { json: async () => ({}) }) : null) } });
  const p = await A.resolveProvider();
  assert.equal(p.kind, "claude");
  assert.equal(p.needsKey, false, "no key, and nothing to set up");
});

test("without it, the ladder falls to OpenRouter and asks for a key", async () => {
  stubBrowser();
  const p = await A.resolveProvider();
  assert.equal(p.kind, "openrouter");
  assert.equal(p.needsKey, true);
});

test("a viewer who declines Claude still gets OpenRouter", async () => {
  stubBrowser({ claude: { use: async () => { throw new Error("not_granted"); } } });
  const p = await A.resolveProvider();
  assert.equal(p.kind, "openrouter");
});

test("the reply schema is strict, so the answer parses", () => {
  const s = A.REPLY_SCHEMA;
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required.sort(), ["assumptions", "explanation", "library", "motif", "name", "negative_examples", "positive_examples"]);
  for (const key of ["motif", "name", "explanation", "library"]) assert.equal(s.properties[key].type, "string", key);
  for (const key of ["assumptions", "positive_examples", "negative_examples"]) {
    assert.equal(s.properties[key].type, "array", key);
    assert.equal(s.properties[key].items.type, "string", key);
  }
});

test("example regeneration has a minimal schema and prompt", () => {
  const s = A.EXAMPLES_SCHEMA;
  assert.deepEqual(s.required.sort(), ["negative_examples", "positive_examples"]);
  assert.equal(Object.keys(s.properties).length, 2);
  const prompt = A.examplePrompt('(seq "TGTGA" (gap 60 100) "TTGACA")', "dna");
  assert.match(prompt, /both strands/);
  assert.ok(!/library|assumption|explanation|THE LANGUAGE/i.test(prompt));
});

test("OpenRouter replies have bounded output and reasoning disabled", async () => {
  stubBrowser();
  A.setApiKey("test-key");
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content:
      '{"positive_examples":["TATA","ATATA"],"negative_examples":["CCCC","GGGG"]}' } }], usage: {} }) };
  };
  try {
    const provider = await A.resolveProvider();
    await provider.ask("small request", { schema: A.EXAMPLES_SCHEMA, schemaName: "motif_examples", maxCompletionTokens: 400 });
    await provider.ask("normal request");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(bodies[0].max_completion_tokens, 400);
  assert.equal(bodies[1].max_completion_tokens, 1200);
  assert.deepEqual(bodies[0].reasoning, { effort: "none", exclude: true });
  assert.equal(bodies[0].response_format.json_schema.name, "motif_examples");
  assert.deepEqual(bodies[0].response_format.json_schema.schema, A.EXAMPLES_SCHEMA);
});

test("assistant replies are normalized before the interface trusts them", () => {
  assert.deepEqual(A.normalizeReply({ motif: "  (iupac \"TATA\") ", assumptions: [" choice ", 4],
    positive_examples: ["TATA"], negative_examples: null }), {
    motif: '(iupac "TATA")', name: "", explanation: "", assumptions: ["choice"],
    positive_examples: ["TATA"], negative_examples: [], library: "",
  });
});

test("a compiling draft remains usable when the model writes a bad example", async () => {
  const { Registry } = await import("../src/library.js");
  const good = A.normalizeReply({ motif: '(iupac "TATA")', name: "tata", explanation: "test",
    assumptions: [], positive_examples: ["TATA", "CCTATAGG"],
    negative_examples: ["TACA", "CCCC"], library: "" });
  const review = A.verifyDraft(good, new Registry(), "dna");
  assert.equal(review.usable, true);
  assert.equal(review.examplesConsistent, true);

  const inconsistent = { ...good, negative_examples: ["TATA", "CCCC"] };
  const warned = A.verifyDraft(inconsistent, new Registry(), "dna");
  assert.equal(warned.usable, true, "an AI-authored example must not veto a valid expression");
  assert.equal(warned.examplesConsistent, false);
  assert.ok(warned.checks.some((c) => c.severity === "warning" && /Unexpectedly contains/.test(c.text)));

  const incomplete = A.verifyDraft({ ...good, positive_examples: ["TATA"] }, new Registry(), "dna");
  assert.equal(incomplete.usable, true, "a missing AI-authored example is also only a warning");
  assert.ok(incomplete.checks.some((c) => c.severity === "warning" && /enough examples/.test(c.text)));
});

test("only an expression that cannot compile or execute is blocked", async () => {
  const { Registry } = await import("../src/library.js");
  const base = A.normalizeReply({ name: "draft", explanation: "test", assumptions: [],
    positive_examples: ["TATA", "CCTATAGG"], negative_examples: ["TACA", "CCCC"], library: "" });
  const syntax = A.verifyDraft({ ...base, motif: '(iupac "TATA"' }, new Registry(), "dna");
  assert.equal(syntax.usable, false);
  assert.ok(syntax.checks.some((c) => c.blocking && c.severity === "error"));

  const runtime = A.verifyDraft({ ...base, motif: '(fuzzy 1 (gap 2 4))' }, new Registry(), "dna");
  assert.equal(runtime.usable, false);
  assert.ok(runtime.checks.some((c) => c.blocking && /executed/.test(c.text)));
});

test("a nucleotide negative is checked for contained matches on both strands", async () => {
  const { Registry } = await import("../src/library.js");
  const draft = A.normalizeReply({ motif: '"AGTC"', name: "strand-check", explanation: "test",
    assumptions: [], positive_examples: ["AGTC", "TTAGTCAA"],
    negative_examples: ["GACT", "CCCC"], library: "" });
  const review = A.verifyDraft(draft, new Registry(), "dna");
  assert.equal(review.usable, true);
  assert.equal(review.examplesConsistent, false);
  assert.ok(review.checks.some((c) => /either strand/.test(c.text) && c.severity === "warning"));
});

test("every OpenRouter failure is explained in the reader's terms", () => {
  for (const phrase of [
    "did not accept that key", "out of credit", "rate limiting requests",
    "has no model called", "Could not reach OpenRouter", "reply was cut off",
  ]) assert.ok(SRC.includes(phrase), phrase);
  assert.ok(SRC.includes("choice?.error"), "a provider failure can arrive as HTTP 200");
});

test("a model that ignores response_format is salvaged, not just failed", () => {
  assert.ok(SRC.includes("response_format"));
  assert.ok(SRC.includes("Not every model honours response_format"));
});

test("requests carry the attribution OpenRouter asks for", () => {
  assert.ok(SRC.includes("X-OpenRouter-Title"));
  assert.ok(SRC.includes("HTTP-Referer"));
});

test("the key is sent to openrouter.ai and nowhere else", () => {
  const hosts = [...SRC.matchAll(/"(https:\/\/[a-z0-9.\-/]+)"/g)].map((m) => new URL(m[1]).origin);
  assert.deepEqual([...new Set(hosts)], ["https://openrouter.ai"]);
  const csp = readFileSync(join(ROOT, "deploy", "security-headers.conf"), "utf8")
    .match(/Content-Security-Policy "([^"]+)"/)[1];
  assert.ok(csp.match(/connect-src ([^;]+);/)[1].split(/\s+/).includes("https://openrouter.ai"));
});

test("the assistant module reaches the bundle", async () => {
  const { MODULES } = await import("../../tools/build.mjs");
  assert.ok(MODULES.includes("assistant.js"));
  assert.ok(MODULES.indexOf("assistant.js") < MODULES.indexOf("app.js"),
    "app.js uses it, so it must be concatenated first");
});

test("generated source is reviewed before it can replace the current motif", () => {
  const app = readFileSync(join(ROOT, "web", "src", "app.js"), "utf8");
  assert.ok(app.includes("reviewAssistantDraft"));
  assert.ok(app.includes("Use this motif"));
  assert.ok(app.includes("Regenerate test examples"));
  assert.match(app, /const context = current \? "" : assistantLibraryContext/,
    "refining an existing expression must not resend library context");
  assert.match(app, /use\.disabled = !review\.usable/);
  const askBody = app.slice(app.indexOf("async function ask()"), app.indexOf("/* ----------------------------------------------------------------- export */"));
  assert.ok(!/if \(data\.motif\)[\s\S]*setMotifSource/.test(askBody), "a reply must not apply itself");
});

/* ------------------------------------------------------------- examples */

test("there are at least fifty example requests, none repeated", async () => {
  const { PROMPT_GROUPS, PROMPT_COUNT } = await import("../src/prompts.js");
  const all = PROMPT_GROUPS.flatMap((g) => g.prompts);
  assert.ok(all.length >= 50, `only ${all.length} examples`);
  assert.equal(PROMPT_COUNT, all.length);
  assert.equal(new Set(all).size, all.length, "an example is repeated");
});

test("every example group is well formed and names its alphabet", async () => {
  const { PROMPT_GROUPS } = await import("../src/prompts.js");
  for (const g of PROMPT_GROUPS) {
    assert.ok(g.group && g.group === g.group.trim(), JSON.stringify(g.group));
    assert.ok(["dna", "rna", "protein"].includes(g.alphabet), `${g.group}: ${g.alphabet}`);
    assert.ok(g.prompts.length >= 5, `${g.group} has too few to be worth a heading`);
    for (const p of g.prompts) {
      assert.ok(p.length > 20 && p.length < 120, `${p.length} chars: ${p}`);
      assert.ok(p[0] === p[0].toUpperCase(), `should read as a sentence: ${p}`);
      assert.ok(!p.endsWith("."), `no full stop, they are requests: ${p}`);
    }
  }
});

test("an example asks for more than a motif the library already has", async () => {
  /* A single named motif needs no assistant: you click it in the library list.
     Every example must therefore add something — a second element, a distance,
     a bound, a mismatch budget, a narrowed alternative. This is the property
     that broke once already: the first set of examples was written out of the
     library's own subject matter, so the assistant's honest answer to nearly
     all of them was "you already have this". */
  const { PROMPT_GROUPS } = await import("../src/prompts.js");
  const asksForMore = new RegExp([
    "\\d+ to \\d+",                                              // an explicit range
    "\\b(within|apart|inside|followed|preceded|upstream|downstream|before|after|then",
    "between|either side|exactly|at least|allowing|whose|rather than|in that order",
    "twice|second|two |three |four |pair|tandem|purely|mismatch|shorter|longer|copies",
    "encode|starts with|ends in|repeat of|run of|every third|consecutive|all acidic)\\b",
  ].join("|"), "i");
  const bare = PROMPT_GROUPS.flatMap((g) => g.prompts).filter((p) => !asksForMore.test(p));
  assert.deepEqual(bare, [], "these read as a plain library lookup, not a request worth asking a model");
});

test("the examples cover every alphabet and reach the whole language", async () => {
  const { PROMPT_GROUPS } = await import("../src/prompts.js");
  const alphabets = new Set(PROMPT_GROUPS.map((g) => g.alphabet));
  assert.deepEqual([...alphabets].sort(), ["dna", "protein", "rna"]);
  const text = PROMPT_GROUPS.flatMap((g) => g.prompts).join(" ").toLowerCase();
  // Each of these is a distinct capability; an example set that never asks for
  // one of them is not exercising the language.
  for (const capability of ["mismatch", "hairpin", "wobble", "upstream", "pam",
                            "c-terminus", "spacer", "repeat", "capturing", "pyrimidine"]) {
    assert.ok(text.includes(capability), `no example asks for anything involving "${capability}"`);
  }
});

test("the examples module reaches the bundle", async () => {
  const { MODULES } = await import("../../tools/build.mjs");
  assert.ok(MODULES.includes("prompts.js"));
  assert.ok(MODULES.indexOf("prompts.js") < MODULES.indexOf("app.js"));
});
