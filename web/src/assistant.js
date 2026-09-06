/* Writing a motif from a plain-English description.

   Two providers behind one interface, tried in order:

     1. window.claude, which the Claude artifact viewer injects. Nothing to set
        up and no key: the request runs on the viewer's own account.
     2. OpenRouter with a key the user supplies. This is what a self-hosted copy
        uses, and it is why the app still needs no server of its own.

   The key is held in sessionStorage, so it dies with the tab, and is sent only
   to openrouter.ai. Nothing here proxies it anywhere. */

import { BiomotifError, Record, parse, search } from "./engine.js";
import { buildMotif } from "./library.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_HOST = "https://openrouter.ai";

const KEY_STORAGE = "biomotif-openrouter-key";
const MODEL_STORAGE = "biomotif-openrouter-model";
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

/** A few that handle a small structured task well, as a starting point. The
    field is free text, so any OpenRouter model id works. */
export const SUGGESTED_MODELS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
];

function sessionGet(key) {
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}
function sessionSet(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* private mode, or storage refused: the field simply will not stick */ }
}

export const getApiKey = () => sessionGet(KEY_STORAGE);
export const setApiKey = (v) => sessionSet(KEY_STORAGE, v.trim());
export const getModel = () => sessionGet(MODEL_STORAGE) || DEFAULT_MODEL;
export const setModel = (v) => sessionSet(MODEL_STORAGE, v.trim() === DEFAULT_MODEL ? "" : v.trim());

/* --------------------------------------------------------------- schema */

/** The shape every provider is asked to answer in. */
export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    motif: { type: "string", description: "the motif as one s-expression" },
    name: { type: "string", description: "a short kebab-case name for it" },
    explanation: { type: "string", description: "two sentences: what it matches and why it is written that way" },
    assumptions: { type: "array", items: { type: "string" },
      description: "explicit choices made where the request was ambiguous" },
    positive_examples: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" },
      description: "two short sequences that should match the motif" },
    negative_examples: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" },
      description: "two short near-misses that should not match the motif" },
    library: { type: "string", description: "an existing library motif name that already answers this, or empty" },
  },
  required: ["motif", "name", "explanation", "assumptions", "positive_examples", "negative_examples", "library"],
  additionalProperties: false,
};

/** Regenerating examples is a much smaller task than writing a motif. Keeping
    its contract separate prevents the provider from receiving the grammar,
    library context, explanation and assumptions all over again. */
export const EXAMPLES_SCHEMA = {
  type: "object",
  properties: {
    positive_examples: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    negative_examples: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
  },
  required: ["positive_examples", "negative_examples"],
  additionalProperties: false,
};

export function examplePrompt(motif, kind = "dna") {
  const nucleotide = kind === "dna" || kind === "rna";
  return `Return only four short test sequences for this already-written Biomotif expression:
${motif}

The alphabet is ${kind}. Do not rewrite or explain the expression. Each positive sequence must
contain a match somewhere. Each negative sequence must contain no match anywhere.${nucleotide ? ` Nucleotide
sequences are scanned on both strands, so negatives must avoid both the expression and its
reverse-complement matches.` : ""}

Reply with JSON only:
{"positive_examples":["<first match>","<second match>"],
 "negative_examples":["<first non-match>","<second non-match>"]}`;
}

/** Providers occasionally return a structurally valid object with values of
    the wrong scalar type. Normalising at the boundary keeps the review UI from
    trusting those values, and gives older providers a graceful empty default. */
export function normalizeReply(value) {
  const data = value && typeof value === "object" ? value : {};
  const strings = (xs) => Array.isArray(xs) ? xs.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
  return {
    motif: typeof data.motif === "string" ? data.motif.trim() : "",
    name: typeof data.name === "string" ? data.name.trim() : "",
    explanation: typeof data.explanation === "string" ? data.explanation.trim() : "",
    assumptions: strings(data.assumptions),
    positive_examples: strings(data.positive_examples),
    negative_examples: strings(data.negative_examples),
    library: typeof data.library === "string" ? data.library.trim() : "",
  };
}

/** Compile a generated draft and execute the examples the model claimed define
    its boundary. These checks are deterministic and local. Construction or
    execution errors block use; model-authored example disagreements are only
    warnings, because they say nothing conclusive about expression validity. */
export function verifyDraft(data, registry, kind = "dna") {
  const checks = [];
  let matcher = null;
  try {
    matcher = buildMotif(parse(data.motif), registry);
    checks.push({ ok: true, severity: "pass", blocking: false, text: "The expression compiles locally." });
  } catch (err) {
    checks.push({ ok: false, severity: "error", blocking: true, text: `Does not compile: ${err.message}` });
    return { matcher: null, checks, usable: false, examplesConsistent: false };
  }

  const nucleotide = kind === "dna" || kind === "rna";
  const scope = nucleotide ? "on either strand" : "in the protein sequence";
  try {
    for (const seq of data.positive_examples) {
      const ok = search(matcher, new Record("positive example", seq, kind)).length > 0;
      checks.push({ ok, severity: ok ? "pass" : "warning", blocking: false,
        text: `${ok ? "Contains a match" : "Contains no match"} ${scope}: positive example ${seq}.` });
    }
    for (const seq of data.negative_examples) {
      const ok = search(matcher, new Record("negative example", seq, kind)).length === 0;
      checks.push({ ok, severity: ok ? "pass" : "warning", blocking: false,
        text: `${ok ? "Contains no match" : "Unexpectedly contains a match"} ${scope}: negative example ${seq}.` });
    }
    if (data.positive_examples.length < 2 || data.negative_examples.length < 2) {
      checks.push({ ok: false, severity: "warning", blocking: false,
        text: "The model did not provide enough examples to test the intended boundary." });
    }
  } catch (err) {
    checks.push({ ok: false, severity: "error", blocking: true,
      text: `The expression could not be executed locally: ${err.message}` });
  }
  const blocking = checks.some((check) => check.blocking);
  const examplesConsistent = !blocking && checks.every((check) => check.ok);
  return { matcher, checks, usable: !blocking, examplesConsistent };
}

/* ----------------------------------------------------------- OpenRouter */

function headers() {
  const h = {
    "content-type": "application/json",
    "X-OpenRouter-Title": "Biomotif",
    Authorization: `Bearer ${getApiKey()}`,
  };
  if (location.protocol.startsWith("http")) h["HTTP-Referer"] = location.origin;
  return h;
}

function formatError(status, json) {
  const message = json?.error?.message || json?.message || "";
  if (status === 401) return "OpenRouter did not accept that key. Check it in Assistant settings.";
  if (status === 402) return "That OpenRouter account is out of credit.";
  if (status === 429) return "OpenRouter is rate limiting requests. Wait a moment and try again.";
  if (status === 404) return `OpenRouter has no model called ${getModel()}. Pick another in Assistant settings.`;
  return message ? `OpenRouter: ${message}` : `OpenRouter returned ${status}.`;
}

async function openrouterAsk(prompt, {
  signal, schema = REPLY_SCHEMA, schemaName = "motif_reply", maxCompletionTokens = 1200,
} = {}) {
  const model = getModel();
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: maxCompletionTokens,
    reasoning: { effort: "none", exclude: true },
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  };
  let response;
  try {
    response = await fetch(ENDPOINT, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new BiomotifError("Could not reach OpenRouter. Check the connection and try again.");
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) throw new BiomotifError(formatError(response.status, json));

  const choice = json?.choices?.[0];
  // A provider failure can arrive as HTTP 200 with the error inside the choice.
  if (choice?.error) throw new BiomotifError(formatError(response.status, choice));
  const raw = choice?.message?.content;
  const content = typeof raw === "string" ? raw
    : Array.isArray(raw) ? raw.map((p) => p?.text ?? "").join("") : "";
  if (!content.trim()) {
    throw new BiomotifError(`${json?.model ?? model} returned nothing. Try another model in Assistant settings.`);
  }
  if (choice?.finish_reason === "length") {
    throw new BiomotifError("The reply was cut off. Ask for something shorter.");
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch {
    // Not every model honours response_format; salvage the object if one is there.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new BiomotifError(`${json?.model ?? model} did not answer with a motif. Try another model.`);
    try { data = JSON.parse(match[0]); }
    catch { throw new BiomotifError(`${json?.model ?? model} did not answer with a motif. Try another model.`); }
  }

  const usage = json?.usage ?? {};
  return {
    data: normalizeReply(data),
    meta: {
      provider: "openrouter",
      model: json?.model ?? model,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      cost: typeof usage.cost === "number" ? usage.cost : null,
    },
  };
}

/** Model ids, for the datalist. Never throws: the field is free text anyway. */
export async function fetchModels() {
  try {
    const res = await fetch(MODELS_URL);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []).map((m) => String(m.id)).sort();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ the ladder */

/** Resolve a provider, or null when neither is available.
    Shape: {kind, label, needsKey, ask(prompt, opts) -> {data, meta}} */
export async function resolveProvider() {
  let sample = null;
  try {
    sample = await window.claude?.use?.("sample");
  } catch { /* declined, or unavailable: fall through to OpenRouter */ }

  if (sample) {
    return {
      kind: "claude",
      label: "Claude, on your account",
      needsKey: false,
      async ask(prompt, { signal, maxCompletionTokens = 1200 } = {}) {
        const data = await sample.json(prompt, { modelTier: "default", signal, maxTokens: maxCompletionTokens });
        return { data: normalizeReply(data), meta: { provider: "claude", model: "claude" } };
      },
    };
  }
  return {
    kind: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    ask: openrouterAsk,
  };
}
