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
  assert.deepEqual(s.required.sort(), ["caveats", "explanation", "library", "motif", "name"]);
  for (const key of s.required) assert.equal(s.properties[key].type, "string", key);
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
