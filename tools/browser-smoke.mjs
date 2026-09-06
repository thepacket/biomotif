/* Exercise the built page in a real headless browser without adding a runtime
   or development dependency. GitHub's Ubuntu image and ordinary desktop
   development machines already provide Chrome/Chromium. */

import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";

const candidates = [process.env.CHROME_BIN, "google-chrome-stable", "google-chrome", "chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
let chrome = null;
for (const candidate of candidates) {
  try {
    if (candidate.includes("/")) accessSync(candidate);
    else execFileSync("which", [candidate], { stdio: "ignore" });
    chrome = candidate; break;
  } catch { /* try the next ordinary installation name */ }
}
if (!chrome) {
  if (process.env.REQUIRE_BROWSER) throw new Error("Chrome or Chromium is required for the browser smoke test");
  console.log("Browser smoke test skipped: Chrome/Chromium is not installed.");
  process.exit(0);
}

const port = 8137;
const server = spawn(process.execPath, ["tools/serve.mjs"], {
  env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "inherit"],
});
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; }
    catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const html = execFileSync(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--dump-dom",
    `http://127.0.0.1:${port}/#motif=sigma70-promoter&demo=operon`],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  assert.match(html, /523 of 523/);
  assert.match(html, /sigma70-promoter/);
  assert.match(html, /Use this motif|assistant-out/);
  assert.match(html, /JSON report/);
  console.log("Real-browser smoke test passed.");
} finally {
  server.kill("SIGTERM");
}
