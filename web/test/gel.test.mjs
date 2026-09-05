/* The drawn gel: bands land where a log scale puts them, heavier fragments
   are darker, and nothing in it needs an inline style. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LADDER, describeGel, gelSvg, migration } from "../src/gel.js";

test("a fragment migrates with the log of its length", () => {
  const y1000 = migration(1000, 100, 10000);
  const y100 = migration(100, 100, 10000);
  const y10000 = migration(10000, 100, 10000);
  assert.ok(y10000 < y1000 && y1000 < y100, "bigger runs less far");
  // Log scale: 10 kb to 1 kb covers the same distance as 1 kb to 100 bp.
  assert.ok(Math.abs((y1000 - y10000) - (y100 - y1000)) < 1e-9);
  assert.equal(migration(5, 100, 10000), y100, "a fragment below the scale sits at the bottom, not off the picture");
});

test("every lane draws its bands, and the ladder comes first", () => {
  const svg = gelSvg([{ label: "EcoRI", sizes: [2696] }, { label: "EcoRI + BamHI", sizes: [1800, 896] }]);
  assert.match(svg, /^<svg class="gel"/);
  assert.ok(svg.indexOf(">ladder<") < svg.indexOf(">EcoRI<"));
  assert.equal((svg.match(/class="gel-band"/g) || []).length, LADDER.length + 1 + 2);
  assert.ok(svg.includes(">2,696<") && svg.includes(">1,800<") && svg.includes(">896<"));
});

test("a longer fragment is a darker band", () => {
  const svg = gelSvg([{ label: "cut", sizes: [4000, 400] }]);
  const bands = [...svg.matchAll(/class="gel-band"[^>]*opacity="([\d.]+)"/g)].map((m) => Number(m[1])).slice(LADDER.length);
  assert.equal(bands.length, 2);
  assert.ok(bands[0] > bands[1], `${bands[0]} should be darker than ${bands[1]}`);
});

test("the scale stretches for a fragment bigger than the ladder", () => {
  const svg = gelSvg([{ label: "uncut", sizes: [48502] }]);
  assert.ok(svg.includes(">48,502<"));
  const y = Number(svg.match(/class="gel-band"[\s\S]*?y="([\d.]+)"/g).at(-1).match(/y="([\d.]+)"/)[1]);
  assert.ok(y < migration(10000, 100, 48502), "it sits above the ladder's top rung");
});

test("the gel carries no inline style, since the policy allows none", () => {
  const svg = gelSvg([{ label: "a", sizes: [1000, 500] }]);
  assert.ok(!/style=/.test(svg));
  assert.ok(!/<style/.test(svg));
});

test("the gel is described in words for anyone who cannot see it", () => {
  const svg = gelSvg([{ label: "EcoRI", sizes: [896, 1800] }]);
  assert.match(svg, /role="img" aria-label="A drawn gel: EcoRI gives 2 bands at 1,800, 896 bp\."/);
  assert.equal(describeGel([{ label: "one", sizes: [2696] }]), "A drawn gel: one gives one band at 2,696 bp.");
  assert.ok(!gelSvg([{ label: "<b>&", sizes: [10] }]).includes("<b>"), "labels are escaped");
});
