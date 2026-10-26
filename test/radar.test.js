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

/** Every axis label run in draw order, with the row it sits on and its width. */
const axisRunsOf = (rows) => {
  const runs = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const run of row.runs) {
      if (run.kind === "axis") runs.push({ x, y, w: cols(run.text), text: run.text });
      x += cols(run.text);
    }
  });
  return runs;
};

/** True when two labels on the same row share a cell. */
const anyOverlap = (runs) =>
  runs.some((a, index) => runs.slice(index + 1).some((b) => a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w));

/** True when a drawn label is its source, or a shortened prefix of it. */
const isPrefixOf = (drawn, source) =>
  drawn === source || source.startsWith(drawn.endsWith("…") ? drawn.slice(0, -1) : drawn);

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

check("a negative value is clamped and reported", () => {
  const rows = textRows(renderRadarRows({ ...base, values: [-2, 6, 4, 7, 3] }));
  const note = rows.find((row) => /negative value/.test(row));
  assert.ok(note, "the footer reports the clamp");
  assert.equal(note, "1 negative value clamped to 0");
  for (const [index, text] of rows.entries()) {
    assert.ok(cols(text) <= base.width, `row ${index} is ${cols(text)} wide`);
  }
  const allNegative = textRows(renderRadarRows({ ...base, values: [-1, -2, -3, -4, -5] }));
  assert.match(allNegative[0], /no data/);
  assert.match(allNegative[1], /5 negative values clamped to 0/);
});

check("values above max are clipped at the rim and reported", () => {
  const spec = { type: "radar", width: 40, height: 14, max: 5, labels: ["a", "b", "c"], values: [9, 9, 9] };
  const rows = textRows(renderRadarRows(spec));
  assert.ok(
    rows.some((row) => row === "3 values above max clipped to 5"),
    `the footer says the data left the scale, got:\n${rows.join("\n")}`,
  );
  for (const [index, text] of rows.entries()) {
    assert.ok(cols(text) <= spec.width, `row ${index} is ${cols(text)} wide`);
  }
  const atMax = textRows(renderRadarRows({ ...spec, values: [5, 5, 5] }));
  assert.ok(!atMax.some((row) => /above max/.test(row)), "a value on the scale needs no note");
  const one = textRows(renderRadarRows({ ...spec, values: [9, 5, 5] }));
  assert.ok(one.some((row) => row === "1 value above max clipped to 5"), "one clipped value reads as a value");
});

check("the clip note sits below the polygon, never across it", () => {
  const rows = renderRadarRows({ type: "radar", width: 40, height: 14, max: 5, labels: ["a", "b", "c"], values: [9, 9, 9] });
  const marks = pointsOf(rows, ["fill", "edge", "line", "spoke"]);
  const lastMark = Math.max(...marks.map((point) => point.y));
  const note = rows.findIndex((row) => /above max clipped/.test(runsText(row.runs)));
  assert.ok(note > lastMark, `the note row ${note} comes after the last drawn row ${lastMark}`);
  assert.equal(rows[note].runs.length, 1, "and it is one plain run, so nothing is drawn on it");
});

check("the clip note keeps its row, and the legend keeps its own", () => {
  const rows = renderRadarRows({
    type: "radar",
    width: 56,
    height: 20,
    max: 4,
    labels: ["Speed", "Quality", "Cost", "Risk", "Docs"],
    series: [
      { name: "Now", values: [9, 3, 4, 5, 4] },
      { name: "Target", values: [5, 4, 2, 4, 5] },
    ],
  });
  const text = textRows(rows);
  assert.ok(rows.length <= 20, `the block stays inside the 20-row budget (${rows.length})`);
  const clip = text.findIndex((row) => /above max clipped to 4/.test(row));
  assert.ok(clip >= 0, `the footer reports the clip, got:\n${text.join("\n")}`);
  assert.ok(text.some((row) => /outlines may overlap/.test(row)), "and the overlap note is still there");
  assert.ok(clip < text.findIndex((row) => /● Now/.test(row)), "the note sits above the legend");
  assert.ok(text.some((row) => /● Target/.test(row)), "both legend entries survive");
});

check("the notes order stays: clamp, clip, overlap, dropped, legend", () => {
  const labels = [
    "Performance", "Quality", "Cost", "Risk", "Docs", "Team",
    "Scope", "Plan", "Speed", "Scale", "Safety", "Support",
    "Staffing", "Strategy", "Stability", "Scoring", "Skill", "Service",
  ];
  const rows = textRows(
    renderRadarRows({
      type: "radar",
      width: 36,
      height: 16,
      max: 4,
      labels,
      series: [
        { name: "Now", values: labels.map((_, index) => (index % 5) + 1) },
        { name: "Target", values: [-1, 9, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3] },
      ],
    }),
  );
  const at = (pattern) => rows.findIndex((row) => pattern.test(row));
  assert.ok(at(/negative value clamped/) >= 0, "the clamp note leads");
  assert.ok(at(/above max clipped/) > at(/negative value clamped/), "the clip note follows");
  assert.ok(at(/outlines may overlap/) > at(/above max clipped/), "the overlap note follows");
  assert.ok(at(/axis label dropped/) > at(/outlines may overlap/), "the dropped note follows");
  assert.ok(at(/● Now/) > at(/axis label dropped/), "the legend comes last");
  const notes = rows.filter((row) => /clamped|clipped|overlap|dropped/.test(row));
  assert.deepEqual(notes.slice(0, 3), [
    "1 negative value clamped to 0",
    "7 values above max clipped to 4",
    "outlines may overlap",
  ]);
  assert.match(notes[3], /^\d+ axis labels? dropped$/, "and the dropped count closes the notes");
});

check("a non-array labels field falls back to generated axis names", () => {
  for (const labels of ["abc", 42, { a: 1 }, true]) {
    const rows = renderRadarRows({ type: "radar", width: 40, height: 12, labels, values: [1, 2, 3] });
    assert.deepEqual(
      axisRunsOf(rows).map((run) => run.text).sort(),
      ["1", "2", "3"],
      `labels ${JSON.stringify(labels)} still names every axis`,
    );
  }
  const partial = renderRadarRows({ type: "radar", width: 40, height: 12, labels: ["Speed"], values: [1, 2, 3] });
  assert.deepEqual(axisRunsOf(partial).map((run) => run.text).sort(), ["2", "3", "Speed"], "a short array names the rest by position");
  const viaAxes = renderRadarRows({ type: "radar", width: 40, height: 12, axes: "x", values: [1, 2, 3] });
  assert.deepEqual(axisRunsOf(viaAxes).map((run) => run.text).sort(), ["1", "2", "3"], "a non-array axes field is tolerated too");
});

check("several outlines warn that they may overlap", () => {
  const multi = {
    ...base,
    values: undefined,
    series: [
      { name: "Now", values: [8, 6, 4, 7, 3] },
      { name: "Target", values: [6, 7, 5, 5, 4] },
    ],
  };
  const rows = textRows(renderRadarRows(multi));
  assert.ok(rows.some((row) => /outlines may overlap/.test(row)), "the footer warns about overlapping outlines");
  for (const [index, text] of rows.entries()) {
    assert.ok(cols(text) <= multi.width, `row ${index} is ${cols(text)} wide`);
  }
  const single = textRows(renderRadarRows(base));
  assert.ok(!single.some((row) => /outlines may overlap/.test(row)), "a filled single series has no overlap to warn about");
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

check("a multi-series radar keeps its legend and notes inside the height", () => {
  const rows = renderRadarRows({
    type: "radar",
    width: 56,
    height: 20,
    labels: ["Speed", "Quality", "Cost", "Risk", "Docs"],
    series: [
      { name: "Now", values: [4, 3, 4, 5, 4] },
      { name: "Target", values: [5, 4, 2, 4, 5] },
    ],
  });
  assert.ok(rows.length <= 20, `the block stays inside the 20-row budget (${rows.length})`);
  const text = textRows(rows).join("\n");
  assert.match(text, /outlines may overlap/);
  assert.match(text, /Now/);
  assert.match(text, /Target/);
});

check("a label that would collide is shifted clear of its neighbour", () => {
  // Eighteen axes in a 30-cell block crowd the top and bottom rows. On the
  // bottom row Safety's anchor overlaps the two labels already placed, so the
  // solver walks it three cells left (-3); Scale walks one.
  const labels = [
    "Performance", "Quality", "Cost", "Risk", "Docs", "Team",
    "Scope", "Plan", "Speed", "Scale", "Safety", "Support",
    "Staffing", "Strategy", "Stability", "Scoring", "Skill", "Service",
  ];
  const rows = renderRadarRows({
    type: "radar",
    width: 30,
    height: 12,
    labels,
    values: labels.map((_, index) => (index % 5) + 1),
  });
  const crowd = rows.findIndex((row) => runsText(row.runs).includes("Safety"));
  assert.equal(runsText(rows[crowd].runs), "     SafetyScaleSpeed", "the three crowded labels sit side by side, whole");
  assert.ok(!anyOverlap(axisRunsOf(rows)), "and no two labels share a cell");
});

check("a label with no room is shortened, never clipped", () => {
  const labels = [
    "Authentication", "Authorisation", "Accounting", "Accessibility",
    "Availability", "Auditing", "Archival", "Alerting",
  ];
  const rows = renderRadarRows({ type: "radar", width: 20, height: 30, labels, values: [1, 2, 3, 4, 5, 6, 7, 8] });
  const runs = axisRunsOf(rows);
  assert.equal(runs.length, labels.length, "every axis is still named");
  for (const run of runs) {
    assert.ok(run.x >= 0 && run.x + run.w <= 20, `"${run.text}" stays inside the 20-cell row`);
    assert.ok(labels.some((label) => isPrefixOf(run.text, label)), `"${run.text}" is a prefix of its axis name`);
  }
  assert.ok(runs.filter((run) => !labels.includes(run.text)).length >= 4, "the long names are shortened");
  assert.ok(!anyOverlap(runs), "and no two labels share a cell");
});

check("a label that cannot fit anywhere is dropped and counted", () => {
  const labels = [
    "Performance", "Quality", "Cost", "Risk", "Docs", "Team",
    "Scope", "Plan", "Speed", "Scale", "Safety", "Support",
    "Staffing", "Strategy", "Stability", "Scoring", "Skill", "Service",
  ];
  const rows = renderRadarRows({
    type: "radar",
    width: 30,
    height: 10,
    labels,
    values: labels.map((_, index) => (index % 5) + 1),
  });
  const text = textRows(rows);
  assert.equal(text.at(-1), "1 axis label dropped", "the note says what was left out");
  assert.ok(!text.join("\n").includes("Quality"), "the label it could not place is not drawn");
  assert.ok(text.join("\n").includes("Performance") && text.join("\n").includes("Skill"), "the others are still named");
  assert.ok(text.every((line) => cols(line) <= 30), "and the note fits the block");
});

check("an axis label on the frame edge stays inside the block", () => {
  const rows = renderRadarRows(base);
  const runs = axisRunsOf(rows);
  const top = runs.filter((run) => run.y === 0);
  assert.deepEqual(top.map((run) => run.text), ["Speed"], "the top axis is named on the first row");
  const bottom = runs.filter((run) => run.y === rows.length - 1);
  assert.deepEqual(bottom.map((run) => run.text), ["Risk", "Cost"], "the bottom two axes share the last row");
  for (const run of runs) {
    assert.ok(run.x >= 0 && run.x + run.w <= base.width, `"${run.text}" fits the row`);
    assert.ok(run.y >= 0 && run.y < rows.length, `"${run.text}" is on a drawn row`);
  }
});

check("a long CJK label is shortened by display columns", () => {
  const labels = ["スピード", "品質管理", "コスト", "リスク", "ドキュメント", "可用性", "監査", "保守性"];
  const rows = renderRadarRows({ type: "radar", width: 20, height: 15, labels, values: [1, 2, 3, 4, 5, 6, 7, 8] });
  const runs = axisRunsOf(rows);
  assert.ok(runs.some((run) => run.text === "ドキュメント"), "a label with room is drawn whole");
  assert.ok(runs.some((run) => run.text === "コ"), "a two-cell room keeps one wide glyph, not two");
  for (const run of runs) {
    assert.ok(run.x + run.w <= 20, `"${run.text}" fits the row`);
    assert.ok(labels.some((label) => isPrefixOf(run.text, label)), `"${run.text}" is a prefix of its axis name`);
  }
  assert.ok(runs.filter((run) => !labels.includes(run.text)).length >= 4, "the wide names are shortened");
  assert.ok(!anyOverlap(runs), "and no two labels share a cell");
});

check("a dropped label reserves its row instead of pushing the legend out", () => {
  // The dropped count is only known after the label pass, so a fixed height has
  // to be redrawn with one more note row. Without that the note pushes the last
  // legend entry out and the height guard reports "rows hidden" in its place.
  const labels = [
    "Performance", "Quality", "Cost", "Risk", "Docs", "Team",
    "Scope", "Plan", "Speed", "Scale", "Safety", "Support",
    "Staffing", "Strategy", "Stability", "Scoring", "Skill", "Service",
  ];
  const rows = renderRadarRows({
    type: "radar",
    width: 30,
    height: 10,
    labels,
    series: [
      { name: "Now", values: labels.map((_, index) => (index % 5) + 1) },
      { name: "Target", values: [6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 6, 5, 4] },
    ],
  });
  const text = textRows(rows);
  assert.ok(rows.length <= 10, `the block stays inside the 10-row budget (${rows.length})`);
  assert.match(text.join("\n"), /outlines may overlap/, "the overlap note is still there");
  assert.match(text.join("\n"), /^\d+ axis labels dropped$/m, "the dropped note is drawn");
  assert.match(text.join("\n"), /● Now/, "the first legend entry survives");
  assert.match(text.join("\n"), /● Target/, "and so does the last one");
});

check("the notes keep their order: clamp, overlap, dropped, legend", () => {
  const labels = [
    "Performance", "Quality", "Cost", "Risk", "Docs", "Team",
    "Scope", "Plan", "Speed", "Scale", "Safety", "Support",
    "Staffing", "Strategy", "Stability", "Scoring", "Skill", "Service",
  ];
  const rows = renderRadarRows({
    type: "radar",
    width: 36,
    height: 15,
    labels,
    series: [
      { name: "Now", values: labels.map((_, index) => (index % 5) + 1) },
      { name: "Target", values: [-1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3] },
    ],
  });
  assert.deepEqual(textRows(rows).slice(-5), [
    "1 negative value clamped to 0",
    "outlines may overlap",
    "1 axis label dropped",
    "● Now",
    "● Target",
  ]);
});

console.log(`\n${checks}/${checks} checks passed`);
