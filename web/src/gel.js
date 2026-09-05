/* A drawn agarose gel.

   Fragment sizes as a list are the answer; the gel is how the answer is read
   in a lab. Bands sit on a log scale, because DNA migrates roughly with the
   log of its length, and a band's darkness follows the fragment's mass —
   every fragment of a digest is present in equal number, so a long one
   carries more stain than a short one. A ladder in the first lane gives the
   scale, the way a real gel needs one.

   Everything is drawn with SVG attributes and classes, never a style
   attribute: the deployed policy allows no inline style. */

/** A common 1 kb ladder, rungs in base pairs. */
export const LADDER = [10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 750, 500, 250, 100];

const W = 96;          // lane pitch
const TOP = 34;        // room for the lane labels
const HEIGHT = 300;    // the migration distance available
const WELL = 8;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("en-US");

/** Where a fragment of `size` bases runs to, in pixels below the wells. */
export function migration(size, lo, hi) {
  const clamp = Math.min(Math.max(size, lo), hi);
  return TOP + WELL + ((Math.log(hi) - Math.log(clamp)) / (Math.log(hi) - Math.log(lo))) * HEIGHT;
}

/** The SVG for a gel. `lanes` is [{label, sizes}], each a digest to draw; the
    ladder is added as the first lane. Sizes below the ladder's smallest rung
    still draw, at the bottom, since a real gel shows them run off too. */
export function gelSvg(lanes, { ladder = LADDER } = {}) {
  const all = [...ladder, ...lanes.flatMap((l) => l.sizes)];
  // The scale spans the ladder, stretched when a fragment is bigger than its top rung.
  const hi = Math.max(ladder[0], ...all);
  const lo = Math.min(ladder[ladder.length - 1], ...all.filter((s) => s > 0));
  const cols = [{ label: "ladder", sizes: ladder, ladder: true }, ...lanes];
  const width = cols.length * W + 60;
  const height = TOP + WELL + HEIGHT + 24;
  const parts = [];

  parts.push(`<svg class="gel" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" ` +
             `aria-label="${esc(describeGel(lanes))}">`);
  parts.push(`<title>${esc(describeGel(lanes))}</title>`);
  parts.push(`<rect class="gel-slab" x="0" y="${TOP}" width="${width}" height="${height - TOP}" rx="6"/>`);

  cols.forEach((lane, i) => {
    const x = 30 + i * W;
    parts.push(`<text class="gel-label" x="${x + W / 2 - 8}" y="${TOP - 12}" text-anchor="middle">${esc(lane.label)}</text>`);
    parts.push(`<rect class="gel-well" x="${x}" y="${TOP + 2}" width="${W - 16}" height="${WELL}" rx="1"/>`);
    const biggest = Math.max(...lane.sizes, 1);
    // Draw the largest first so the label of a smaller band that sits close
    // to it can be skipped rather than drawn on top of it.
    const sorted = [...lane.sizes].sort((a, b) => b - a);
    let lastLabelY = -Infinity;
    for (const size of sorted) {
      if (size <= 0) continue;
      const y = migration(size, lo, hi);
      // Mass: an equimolar band's stain scales with its length. The ladder is
      // drawn evenly, since a bought ladder is mixed to look that way.
      const weight = lane.ladder ? 0.85 : 0.35 + 0.65 * Math.sqrt(size / biggest);
      const thick = lane.ladder ? 3 : 3 + 3 * Math.sqrt(size / biggest);
      parts.push(`<rect class="gel-band" x="${x}" y="${(y - thick / 2).toFixed(1)}" width="${W - 16}" ` +
                 `height="${thick.toFixed(1)}" rx="1.5" opacity="${weight.toFixed(2)}"/>`);
      const wantLabel = lane.ladder ? [10000, 5000, 3000, 2000, 1500, 1000, 500, 250, 100].includes(size) : true;
      if (wantLabel && Math.abs(y - lastLabelY) >= 11) {
        const lx = lane.ladder ? x - 4 : x + W - 12;
        const anchor = lane.ladder ? "end" : "start";
        parts.push(`<text class="gel-size" x="${lx}" y="${(y + 3.5).toFixed(1)}" text-anchor="${anchor}">${fmt(size)}</text>`);
        lastLabelY = y;
      }
    }
  });
  parts.push("</svg>");
  return parts.join("\n");
}

/** The gel in words, for a screen reader and the SVG's title. */
export function describeGel(lanes) {
  return "A drawn gel: " + lanes.map((l) => `${l.label} gives ${l.sizes.length === 1 ? "one band" : `${l.sizes.length} bands`} at ` +
    `${[...l.sizes].sort((a, b) => b - a).map(fmt).join(", ")} bp`).join("; ") + ".";
}
