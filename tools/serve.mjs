/* Serve web/dist with the headers deploy/nginx.conf sets, so the content
   security policy is exercised locally instead of first meeting a browser in
   production. `npm run dist && npm run serve`. */

import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "web", "dist");
const PORT = Number(process.env.PORT) || 8080;

const CSP = readFileSync(join(ROOT, "deploy", "security-headers.conf"), "utf8")
  .match(/Content-Security-Policy "([^"]+)"/)[1];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".json": "application/json" };

createServer((req, res) => {
  const send = (code, body, type = "text/plain; charset=utf-8", extra = {}) => {
    res.writeHead(code, { "Content-Type": type, "Content-Security-Policy": CSP,
                          "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", ...extra });
    res.end(body);
  };
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/healthz") return send(200, "ok\n");
  const name = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const path = join(DIST, name);
  if (!path.startsWith(DIST)) return send(403, "no\n");
  try {
    statSync(path);
  } catch {
    // No routes: anything unknown lands on the page, as nginx does.
    return send(200, readFileSync(join(DIST, "index.html")), TYPES[".html"]);
  }
  const ext = extname(path);
  const cache = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
  send(200, readFileSync(path), TYPES[ext] ?? "application/octet-stream", { "Cache-Control": cache });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${PORT}  serving web/dist with the deployed CSP`);
});
