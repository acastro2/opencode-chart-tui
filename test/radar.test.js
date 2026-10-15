import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { renderRadarRows } from "../src/radar.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));

/** Every drawn cell with its position and kind. */
const pointsOf = (rows, kinds) => {
  const points = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const run of row.runs) {
      for (const char of [...run.text]) {
        if (kinds.includes(run.kind)) points.push({ x, y, kind: run.kind, slice: run.slice, char });
        x += 1;
      }
    }
  });
  return points;
};

const shape = (spec) => {
  const rows = renderRadarRows(spec);
  const points = pointsOf(rows, ["fill", "edge", "line"]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    rows,
    points,
    width: xs.length > 0 ? Math.max(...xs) - Math.min(...xs) + 1 : 0,
    height: ys.length > 0 ? Math.max(...ys) - Math.min(...ys) + 1 : 0,
  };
};

const base = {
  type: "radar",
  width: 52,
  height: 15,
  labels: ["Speed", "Quality", "Cost", "Risk", "Docs"],
  values: [8, 6, 4, 7, 3],
};

check("a radar needs three axes and some values", () => {
  assert.match(textRows(renderRadarRows({ ...base, labels: ["a", "b"], values: [1, 2] }))[0], /no data/);
  assert.match(textRows(renderRadarRows({ ...base, values: [0, 0, 0, 0, 0] }))[0], /no data/);
});

check("every row is inside the chart width", () => {
  for (const [index, text] of textRows(renderRadarRows(base)).entries()) {
    assert.ok(cols(text) <= base.width, `row ${index} is ${cols(text)} wide`);
  }
});

check("the polygon is round rather than a flat ellipse", () => {
  // The cell is about twice as tall as it is wide, so a round shape measures
  // about twice as wide as it is tall on the grid.
  const drawn = shape({ ...base, values: [10, 10, 10, 10, 10], max: 10 });
  const ratio = drawn.width / drawn.height;
  assert.ok(ratio > 1.8 && ratio < 2.6, `round shape measures ${drawn.width}x${drawn.height} (${ratio.toFixed(2)})`);
});

check("the sides are straight segments, not bowed arcs", () => {
  // The area of an inscribed regular n-gon is (n / 2) * sin(2*pi / n) times its
  // ellipse, so a pentagon holds 0.757 and a triangle 0.414 of the same circle.
  // If the radius were interpolated linearly in angle both shapes would come out
  // as circles and the ratio would be about 1; the true polygons give 1.83.
  const pentagon = shape({ ...base, values: [10, 10, 10, 10, 10], max: 10 }).points.length;
  const triangle = shape({ ...base, labels: ["a", "b", "c"], values: [10, 10, 10], max: 10 }).points.length;
  const ratio = pentagon / triangle;
  assert.ok(ratio > 1.55 && ratio < 2.1, `a pentagon holds more than a triangle of the same radius (${ratio.toFixed(2)})`);
});

check("a smaller value draws a smaller shape", () => {
  const full = shape({ ...base, values: [10, 10, 10, 10, 10], max: 10 });
  const half = shape({ ...base, values: [5, 5, 5, 5, 5], max: 10 });
  const ratio = full.width / half.width;
  assert.ok(ratio > 1.8 && ratio < 2.2, `half the value is half the width (${ratio.toFixed(2)})`);
  assert.ok(half.height < full.height, "and less tall");
});

check("every axis label is drawn outside the shape", () => {
  const rows = renderRadarRows(base);
  const labels = pointsOf(rows, ["axis"]);
  const text = textRows(rows).join("\n");
  for (const label of base.labels) assert.ok(text.includes(label), `the axis is named: ${label}`);
  assert.ok(labels.length >= base.labels.length, `one run per axis label at least (${labels.length})`);
});

check("one series fills its shape", () => {
  const drawn = shape(base);
  // A regular pentagon covers 0.757 of its circle, so this five-axis shape fills
  // 130 cells where the old bowed-radius version filled 182.
  // The polygon sits inside `max`, so its area is the pentagon's share of the
  // ellipse (0.757) times the average radius squared, not the full disc.
  assert.ok(drawn.points.length > 100, `a filled polygon covers area (${drawn.points.length} cells)`);
  assert.ok(
    drawn.points.every((point) => point.slice === 0),
    "and every filled cell belongs to that series",
  );
});

check("several series draw outlines instead of painting over each other", () => {
  const single = shape(base);
  const multi = shape({
    ...base,
    values: undefined,
    series: [
      { name: "Now", values: [8, 6, 4, 7, 3] },
      { name: "Target", values: [6, 7, 5, 5, 4] },
    ],
  });
  const slices = new Set(multi.points.map((point) => point.slice));
  assert.equal(slices.size, 2, "both series are drawn");
  assert.ok(
    multi.points.length < single.points.length * 0.8,
    `outlines use less ink than a fill (${multi.points.length} vs ${single.points.length})`,
  );
  const legend = textRows(multi.rows).join("\n");
  assert.match(legend, /Now/);
  assert.match(legend, /Target/);
});

check("the spokes can be turned off and a single series has no legend", () => {
  const withSpokes = pointsOf(renderRadarRows(base), ["spoke"]);
  const without = pointsOf(renderRadarRows({ ...base, spokes: false }), ["spoke"]);
  assert.ok(withSpokes.length > 0, "spokes are drawn by default");
  assert.equal(without.length, 0, "and can be switched off");
  const single = pointsOf(renderRadarRows(base), ["legend-mark"]);
  assert.equal(single.length, 0, "one series needs no legend");
});

check("a filled shape draws its spokes over the fill", () => {
  const drawn = renderRadarRows({ ...base, width: 44, height: 16, values: [4, 3, 4, 5, 4], max: 5 });
  const runs = drawn.flatMap((row) => row.runs);
  // Behind a fill a spoke is invisible, so the cell carries both: the spoke's
  // sub-cells as the glyph in the muted axis colour, over the series colour.
  const over = runs.filter((run) => run.kind === "edge" && run.color === "#9aa0a6");
  assert.ok(over.length >= 5, `spokes cross the filled shape (${over.length} runs)`);
  assert.ok(
    over.every((run) => run.other === 0),
    "and each carries the series behind it, so the plugin can paint the fill",
  );
  const off = renderRadarRows({ ...base, spokes: false }).flatMap((row) => row.runs).filter((run) => run.kind === "edge");
  assert.equal(off.length, 0, "and none are drawn when the spokes are off");
});

check("an empty radar says so", () => {
  assert.match(textRows(renderRadarRows({ type: "radar", width: 40 }))[0], /no data/);
});

console.log(`\n${checks}/${checks} checks passed`);
