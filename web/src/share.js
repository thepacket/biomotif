/* A link to what is on screen.

   The state that fits in a link is the state that came from somewhere public:
   which motif, which example, which database record and how it was asked
   for. A sequence someone pasted or opened from a file is never put in a
   link — it never leaves the browser, and the README promises as much — so a
   link to a pasted sequence carries the motif and nothing else. The
   assistant key is not state at all.

   It lives in the fragment rather than the query string, so nothing here is
   sent to the server or written into its logs. */

const KEYS = ["motif", "demo", "fetch", "source", "species", "upstream", "circular", "lesson"];

/** The fragment for a state, without the leading "#". Empty when there is
    nothing worth linking to. */
export function encodeState(state) {
  const params = new URLSearchParams();
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "" && v !== false && v !== 0) params.set(k, String(v)); };
  put("motif", state.motif?.trim());
  if (state.demo) put("demo", state.demo);
  else if (state.fetch) {
    put("fetch", state.fetch.trim());
    if (state.source && state.source !== "auto") put("source", state.source);
    if (state.species && state.species !== "homo_sapiens") put("species", state.species);
    put("upstream", Number(state.upstream) || 0);
  }
  put("circular", !!state.circular);
  put("lesson", state.lesson);
  return params.toString().replace(/%28/g, "(").replace(/%29/g, ")").replace(/%27/g, "'").replace(/%22/g, '"');
}

/** The state a fragment describes, or null when it describes nothing. Unknown
    keys are ignored and values are bounded, since a link is typed by anyone. */
export function decodeState(fragment) {
  const text = (fragment ?? "").replace(/^#/, "");
  if (!text) return null;
  let params;
  try { params = new URLSearchParams(text); } catch { return null; }
  const out = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v === null) continue;
    if (k === "upstream") { const n = Math.min(Math.max(0, Math.round(Number(v)) || 0), 100000); if (n) out.upstream = n; }
    else if (k === "circular") { if (v === "true" || v === "1") out.circular = true; }
    else if (v.length <= 4000) out[k] = v;
  }
  if (out.demo && out.fetch) delete out.fetch;   // one or the other; the example wins, it needs no network
  return Object.keys(out).length ? out : null;
}

/** The whole link, for the clipboard. */
export function shareUrl(state, base = location.href) {
  const frag = encodeState(state);
  const url = base.split("#")[0];
  return frag ? `${url}#${frag}` : url;
}
