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

/* ------------------------------------------------------------- licensing */

test("the licence, the notice and the contributing guide agree", () => {
  const licence = read("LICENSE");
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 Andre Paquette/);
  assert.match(licence, /WITHOUT WARRANTY OF ANY KIND/);

  const readme = read("README.md");
  assert.match(readme, /MIT — Copyright \(c\) 2026 Andre Paquette/);
  assert.ok(readme.includes("[LICENSE](LICENSE)"));
  assert.ok(readme.includes("[CONTRIBUTING.md](CONTRIBUTING.md)"));

  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.author, "Andre Paquette");
});

test("bundled data keeps its own terms, and they are named", () => {
  /* The MIT licence covers the code, not the catalogues the library draws on.
     Each source named here must actually be cited by the file that uses it. */
  const contributing = read("CONTRIBUTING.md");
  for (const [source, file] of [["REBASE", "restriction.mtf"],
                                ["PROSITE", "protein.mtf"],
                                ["PLACE", "plant.mtf"]]) {
    assert.ok(contributing.includes(source), `${source} is not credited`);
    assert.ok(read("library", file).includes(source),
      `${file} does not cite ${source}, so crediting it would be wrong`);
  }
});

test("the contributing guide tells a contributor what to actually do", () => {
  /* This project takes pull requests, so the guide has to be usable: how to
     run it, how to add a motif, and which generated files CI will check. */
  const contributing = read("CONTRIBUTING.md");
  assert.ok(contributing.includes("Pull requests are welcome"));
  for (const command of ["npm test", "npm run dist", "npm run serve",
                         "npm run data", "npm run index", "npm run build"])
    assert.ok(contributing.includes(command), `${command} is not explained`);
  for (const key of [":example", ":ref", ":category", ":alphabet", ":scan #f"])
    assert.ok(contributing.includes(key), `${key} is not documented`);
  assert.ok(contributing.includes("defmotif") && contributing.includes("defenzyme"));
  assert.ok(contributing.includes("MIT licence"), "a contributor should be told the terms");
});

test("nothing claims an automation this project does not have", () => {
  /* The guide was copied from a repository that refuses pull requests and
     closes them with a workflow. This one accepts them, so both the claim and
     the workflow must be gone. */
  const contributing = read("CONTRIBUTING.md");
  assert.ok(!/closed automatically|automated workflow|closed unread/i.test(contributing));
  assert.throws(() => read(".github", "workflows", "close-pull-requests.yml"),
    "a PR-closing workflow would contradict the guide");
});
