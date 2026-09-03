/* The deployment: the config, the policy and the page have to agree. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const csp = () => read("deploy", "security-headers.conf").match(/Content-Security-Policy "([^"]+)"/)[1];

test("the deployment files are all present", () => {
  for (const p of [["Dockerfile"], ["fly.toml"], ["deploy", "nginx.conf"],
                   ["deploy", "security-headers.conf"], [".dockerignore"], ["package.json"]])
    assert.doesNotThrow(() => read(...p), p.join("/"));
});

test("nginx serves the page, the health check and gzip", () => {
  const conf = read("deploy", "nginx.conf");
  assert.match(conf, /location = \/healthz/);
  assert.match(conf, /try_files \$uri \$uri\/ \/index\.html/);
  assert.match(conf, /gzip on/);
  assert.match(conf, /max-age=31536000, immutable/);
  assert.match(conf, /location = \/index\.html/);
  assert.ok(conf.includes('add_header Cache-Control "no-cache"'),
    "index.html must not be cached, or a deploy never reaches a warm browser");
});

test("the policy allows no inline script and no eval", () => {
  const policy = csp();
  assert.ok(policy.includes("script-src 'self'"));
  assert.ok(!policy.split("style-src")[0].includes("'unsafe-inline'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
});

test("fly.toml and the Dockerfile agree on the port and the build", () => {
  const fly = read("fly.toml");
  assert.match(fly, /internal_port = 80/);
  assert.match(fly, /force_https = true/);
  assert.match(fly, /path = '\/healthz'/);
  assert.match(fly, /primary_region = 'yyz'/);
  const docker = read("Dockerfile");
  assert.match(docker, /nginx/);
  assert.match(docker, /COPY --from=build \/app\/web\/dist \/usr\/share\/nginx\/html/);
});

test("the image builds with Node and carries no Python", () => {
  const docker = read("Dockerfile");
  assert.match(docker, /FROM node:/);
  assert.ok(!/python/i.test(docker), "the web app has no Python in its toolchain");
  assert.match(docker, /tools\/build\.mjs --dist web\/dist/);
});
