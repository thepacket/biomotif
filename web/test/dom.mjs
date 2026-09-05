/* A small DOM for testing the interface without a browser or a dependency.

   It knows what app.js uses and nothing more: elements with attributes,
   classes and children; querySelector with ids, classes, tags and attribute
   tests, joined by descendant space; events that bubble; and an innerHTML
   setter that parses the markup the app writes, so the sequence picture and
   the gel can be inspected. Layout is a fiction — every box is 0 by 0 — so
   what these tests can check is structure and text, never appearance. */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);

function decode(text) {
  return text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

class Node {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode; }
  get ownerDocument() { return document; }
}

class Text extends Node {
  constructor(data) { super(); this.data = String(data); this.nodeType = 3; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeName() { return "#text"; }
}

class Fragment extends Node {
  constructor() { super(); this.nodeType = 11; }
  appendChild(n) { adopt(this, n); return n; }
}

function adopt(parent, n) {
  if (n instanceof Fragment) { for (const c of [...n.childNodes]) adopt(parent, c); return; }
  if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
  n.parentNode = parent;
  parent.childNodes.push(n);
}

class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el.attrs.get("class") || "").split(/\s+/).filter(Boolean); }
  set list(v) { this.el.attrs.set("class", v.join(" ")); }
  add(...names) { this.list = [...new Set([...this.list, ...names.filter(Boolean)])]; }
  remove(...names) { this.list = this.list.filter((c) => !names.includes(c)); }
  contains(name) { return this.list.includes(name); }
  toggle(name, force) { const on = force ?? !this.contains(name); if (on) this.add(name); else this.remove(name); return on; }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.classList = new ClassList(this);
    this._value = undefined;
    this.checked = false;
    this.files = [];
    // Every box is empty: there is no layout here.
    this.offsetHeight = 0; this.scrollHeight = 0; this.clientHeight = 0;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? this.attrs.get("data-" + camelToKebab(k)) : undefined),
      set: (_, k, v) => { this.attrs.set("data-" + camelToKebab(k), String(v)); return true; },
      has: (_, k) => this.attrs.has("data-" + camelToKebab(k)),
    });
  }
  get nodeName() { return this.tagName; }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get id() { return this.attrs.get("id") || ""; }
  set id(v) { this.attrs.set("id", v); }
  get className() { return this.attrs.get("class") || ""; }
  set className(v) { this.attrs.set("class", v); }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(v) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
  get disabled() { return this.attrs.has("disabled"); }
  set disabled(v) { if (v) this.attrs.set("disabled", ""); else this.attrs.delete("disabled"); }
  get open() { return this.attrs.has("open"); }
  set open(v) { if (v) this.attrs.set("open", ""); else this.attrs.delete("open"); }
  get title() { return this.attrs.get("title") || ""; }
  set title(v) { this.attrs.set("title", v); }
  get type() { return this.attrs.get("type") || ""; }
  set type(v) { this.attrs.set("type", v); }
  get label() { return this.attrs.get("label") || ""; }
  set label(v) { this.attrs.set("label", v); }
  get href() { return this.attrs.get("href") || ""; }
  set href(v) { this.attrs.set("href", v); }
  get target() { return this.attrs.get("target") || ""; }
  set target(v) { this.attrs.set("target", v); }
  get rel() { return this.attrs.get("rel") || ""; }
  set rel(v) { this.attrs.set("rel", v); }
  get tabIndex() { return Number(this.attrs.get("tabindex") ?? -1); }
  set tabIndex(v) { this.attrs.set("tabindex", String(v)); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.localName === "textarea") return this.textContent;
    if (this.localName === "select") {
      const options = this.querySelectorAll("option");
      return (options.find((o) => o.hasAttribute("selected")) ?? options[0])?.getAttribute("value") ?? "";
    }
    return this.attrs.get("value") || "";
  }
  set value(v) { this._value = String(v); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  appendChild(n) { adopt(this, n); return n; }
  removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v !== "") this.appendChild(new Text(v)); }
  set innerHTML(html) { this.textContent = ""; parseInto(this, String(html)); }
  get innerHTML() { return serialize(this); }
  get outerHTML() { return serializeOne(this); }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
  scrollIntoView() {}
  focus() { document.activeElement = this; this.dispatchEvent(new Event("focus")); }
  blur() {}
  click() { this.dispatchEvent(new Event("click", { bubbles: true })); }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) l.splice(l.indexOf(fn), 1); }
  dispatchEvent(e) {
    e.target = e.target ?? this;
    for (let n = this; n; n = n.parentNode) {
      e.currentTarget = n;
      for (const fn of [...(n.listeners?.get(e.type) ?? [])]) fn.call(n, e);
      if (!e.bubbles || e.stopped) break;
    }
    return !e.defaultPrevented;
  }
  matches(selector) { return selector.split(",").some((s) => matchesPath(this, s.trim().split(/\s+/), null)); }
  closest(selector) { for (let n = this; n instanceof Element; n = n.parentNode) if (n.matches(selector)) return n; return null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const out = [];
    for (const s of selector.split(",")) {
      const parts = s.trim().split(/\s+/);
      walk(this, (el) => { if (matchesPath(el, parts, this) && !out.includes(el)) out.push(el); });
    }
    return out;
  }
}

function camelToKebab(k) { return k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()); }

function walk(root, fn) { for (const c of root.childNodes) if (c instanceof Element) { fn(c); walk(c, fn); } }

/* One compound selector: tag, #id, .class, [attr], [attr=v], [attr*=v]. */
function matchesCompound(el, compound) {
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]/g;
  let m, any = false;
  while ((m = re.exec(compound))) {
    any = true;
    if (m[1] && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      const v = el.getAttribute(m[4]);
      if (v === null) return false;
      if (m[5] === "=" && v !== m[6]) return false;
      if (m[5] === "*=" && !v.includes(m[6])) return false;
    }
  }
  return any;
}

function matchesPath(el, parts, root) {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; i >= 0 && n && n !== root?.parentNode; n = n.parentNode) {
    if (n instanceof Element && matchesCompound(n, parts[i])) i--;
  }
  return i < 0;
}

class Event {
  constructor(type, { bubbles = false, key = "", metaKey = false, ctrlKey = false, shiftKey = false } = {}) {
    Object.assign(this, { type, bubbles, key, metaKey, ctrlKey, shiftKey, defaultPrevented: false, stopped: false, target: null });
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

/* ------------------------------------------------------------ the parser */

function parseInto(root, html) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let cur = root, m;
  while ((m = re.exec(html))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) { // close
      const name = m[1].toLowerCase();
      for (let n = cur; n && n !== root.parentNode; n = n.parentNode) if (n.localName === name) { cur = n.parentNode; break; }
    } else if (m[2]) { // open
      const el = new Element(m[2]);
      const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ""))) el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
      cur.appendChild(el);
      if (RAW.has(el.localName)) {
        const end = html.indexOf(`</${el.localName}>`, re.lastIndex);
        el.appendChild(new Text(html.slice(re.lastIndex, end === -1 ? html.length : end)));
        re.lastIndex = end === -1 ? html.length : end;
        continue;
      }
      if (!VOID.has(el.localName) && !m[4]) cur = el;
    } else if (m[5] !== undefined) {
      if (m[5].trim() || cur !== root) cur.appendChild(new Text(decode(m[5])));
    } else if (m[0] === "<") {
      cur.appendChild(new Text("<"));
    }
  }
}

function serializeOne(el) {
  if (el instanceof Text) return el.data;
  const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
  return VOID.has(el.localName) ? `<${el.localName}${attrs}>` : `<${el.localName}${attrs}>${serialize(el)}</${el.localName}>`;
}
const serialize = (el) => el.childNodes.map(serializeOne).join("");

/* ------------------------------------------------------------- document */

class Document extends Element {
  constructor() { super("#document"); this.activeElement = null; }
  createElement(tag) { return new Element(tag); }
  createTextNode(t) { return new Text(t); }
  createDocumentFragment() { return new Fragment(); }
  get body() { return this; }
  get documentElement() { return this; }
}

let document = null;

/** Build the page from web/src/index.html and install browser globals, so
    app.js can be imported as it would run. `fetch` is what the page will
    reach the network with; tests hand in one that answers from a script. */
export function installPage(html, { fetch = async () => ({ ok: false, status: 503, headers: new Map(), json: async () => ({}), text: async () => "" }) } = {}) {
  document = new Document();
  parseInto(document, html);
  const clipboard = { text: "", async writeText(t) { clipboard.text = t; } };
  const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const location = { protocol: "http:", host: "localhost:8080", origin: "http://localhost:8080", pathname: "/", search: "", hash: "",
                     get href() { return `${this.origin}${this.pathname}${this.search}${this.hash}`; } };
  const history = { replaceState(_s, _t, url) { location.hash = url.includes("#") ? "#" + url.split("#")[1] : ""; } };
  const win = globalThis;
  const winListeners = new Map();
  Object.assign(win, {
    document, location, history,
    addEventListener(type, fn) { if (!winListeners.has(type)) winListeners.set(type, []); winListeners.get(type).push(fn); },
    dispatchEvent(e) { for (const fn of winListeners.get(e.type) ?? []) fn(e); },
    Event,
    localStorage: storage(),
    sessionStorage: storage(),
    fetch,
  });
  Object.defineProperty(win, "navigator", { value: { clipboard }, configurable: true });
  win.window = win;
  return { document, location, clipboard, Event };
}
