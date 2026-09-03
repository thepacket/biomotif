/* Writing a motif from a plain-English description.

   Two providers behind one interface, tried in order:

     1. window.claude, which the Claude artifact viewer injects. Nothing to set
        up and no key: the request runs on the viewer's own account.
     2. OpenRouter with a key the user supplies. This is what a self-hosted copy
        uses, and it is why the app still needs no server of its own.

   The key is held in sessionStorage, so it dies with the tab, and is sent only
   to openrouter.ai. Nothing here proxies it anywhere. */

import { BiomotifError } from "./engine.js";

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
    caveats: { type: "string", description: "one sentence on how often this would match by chance, or empty" },
    library: { type: "string", description: "an existing library motif name that already answers this, or empty" },
  },
  required: ["motif", "name", "explanation", "caveats", "library"],
  additionalProperties: false,
};

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

async function openrouterAsk(prompt, { signal } = {}) {
  const model = getModel();
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "motif_reply", strict: true, schema: REPLY_SCHEMA },
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
    data,
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
      async ask(prompt, { signal } = {}) {
        const data = await sample.json(prompt, { modelTier: "default", signal });
        return { data, meta: { provider: "claude", model: "claude" } };
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
