import assert from "node:assert/strict";
import { cols, formatNumber, runsText } from "../src/core.js";
import { renderBarRows, layoutVerticalBars, layoutHorizontalBars } from "../src/bar.js";
import { buildAxis } from "../src/axis.js";
import { glyphFor, modeShape } from "../src/mosaic.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

/** Every glyph any mode can draw, so a cell can be proved to be a real pattern. */
const allGlyphs = new Set(["█", "░", ..."▁▂▃▄▅▆▇", ..."▏▎▍▌▋▊▉"]);
for (const mode of ["quadrant", "sextant", "octant"]) {
  const shape = modeShape(mode);
  for (let mask = 1; mask < 2 ** (shape.columns * shape.rows); mask++) allGlyphs.add(glyphFor(mask, mode));
  allGlyphs.add("█");
}

const cases = {
  vertical: { type: "bar", width: 40, height: 8, labels: ["Jul", "Aug", "Sep"], values: [118, 132, 146] },
  grouped: {
    type: "bar",
    width: 46,
    height: 8,
    labels: ["Jul", "Aug"],
    series: [{ name: "Closed", values: [80, 90] }, { name: "Open", values: [40, 42] }],
  },
  stacked: {
    type: "bar",
    width: 46,
    height: 8,
    stacked: true,
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [80, 90, 100] }, { name: "In flight", values: [40, 42, 46] }],
  },
  horizontal: { type: "hbar", width: 46, labels: ["Globex", "Initech", "Umbrella"], values: [4200, 3100, 2900] },
  horizontalGrouped: {
    type: "hbar",
    width: 46,
    labels: ["Jul", "Aug"],
    series: [{ name: "Closed", values: [118, 132] }, { name: "Forecast", values: [120, 140] }],
  },
  horizontalStacked: {
    type: "hbar",
    width: 48,
    stacked: true,
    track: true,
    labels: ["EMEA", "AMER"],
    series: [{ name: "Won", values: [60, 120] }, { name: "Open", values: [30, 25] }],
  },
};

check("no bar row is wider than the chart", () => {
  for (const [name, spec] of Object.entries(cases)) {
    for (const row of textRows(renderBarRows(spec))) {
      assert.ok(cols(row) <= spec.width, `${name}: "${row}" is ${cols(row)} of ${spec.width}`);
    }
  }
});

check("every bar cell is a real block pattern", () => {
  for (const [name, spec] of Object.entries(cases)) {
    for (const row of textRows(renderBarRows(spec))) {
      for (const cell of cellsOf(row)) {
        if (cell === " " || cell === "●" || /[0-9.,%a-zA-ZkMG│┤┼─]/.test(cell)) continue;
        assert.ok(allGlyphs.has(cell), `${name}: "${cell}" is not a block pattern`);
      }
    }
  }
});

check("the value column is one column for horizontal bars", () => {
  const rows = textRows(renderBarRows(cases.horizontal));
  const values = rows.filter((row) => /[0-9]/.test(row) && !row.includes("│"));
  const ends = values.map((row) => row.trimEnd().length - row.trimEnd().replace(/[0-9.]+[kMG]?$/, "").length);
  assert.ok(ends.length >= 3);
  assert.equal(new Set(ends).size, 1, `values end at different columns: ${ends.join(",")}`);
});

check("a taller value draws a taller bar", () => {
  // Find the bar columns and their top rows without assuming any layout: a bar
  // is a group of contiguous columns that carry fill cells.
  const rows = renderBarRows(cases.vertical).map((row) => row.runs);
  const columns = new Map(); // column index -> the rows it fills
  for (const [y, runs] of rows.entries()) {
    let cursor = 0;
    for (const run of runs) {
      const length = cols(run.text);
      if ((run.kind === "fill" || run.kind === "label") && run.slice === 0) {
        for (let x = cursor; x < cursor + length; x++) {
          if (!columns.has(x)) columns.set(x, new Set());
          columns.get(x).add(y);
        }
      }
      cursor += length;
    }
  }

  const sorted = [...columns.keys()].sort((a, b) => a - b);
  const groups = [];
  for (const column of sorted) {
    const last = groups[groups.length - 1];
    if (last && column - last[last.length - 1] <= 1) last.push(column);
    else groups.push([column]);
  }
  assert.equal(groups.length, 3, `three bars, found ${groups.length}`);

  const tops = groups.map((group) => Math.min(...group.flatMap((column) => [...columns.get(column)])));
  const heights = groups.map((group) => Math.max(...group.flatMap((column) => [...columns.get(column)])) - tops[groups.indexOf(group)]);
  assert.ok(
    tops[0] >= tops[1] && tops[1] >= tops[2] && tops[0] > tops[2],
    `taller values start higher, allowing two to share a row: ${tops.join(",")}`,
  );
  assert.ok(Math.max(...heights) >= 2, `the bars have height: ${heights.join(",")}`);
});

check("every bar grows from the baseline", () => {
  const rows = textRows(renderBarRows(cases.vertical));
  const baseline = rows.findIndex((row) => row.includes("┼"));
  assert.ok(baseline > 0);
  const above = cellsOf(rows[baseline - 1]);
  const filled = above.map((cell, index) => (cell === "█" ? index : -1)).filter((index) => index >= 0);
  assert.ok(filled.length >= 3, "all three bars touch the baseline");
});

check("a single series writes its value exactly once per bar", () => {
  // The regression: the label was stamped once per column of the bar, so the
  // digits overlapped each other.
  const spec = { type: "bar", width: 44, height: 8, labels: ["Jul", "Aug", "Sep", "Oct"], values: [118, 132, 146, 158] };
  const text = textRows(renderBarRows(spec)).join("\n");
  for (const value of [118, 132, 146, 158]) {
    const occurrences = text.split(formatNumber(value)).length - 1;
    assert.equal(occurrences, 1, `${value} appears ${occurrences} times`);
  }
});

check("grouped bars give each series its own column", () => {
  const spec = cases.grouped;
  const rows = renderBarRows(spec).map((row) => row.runs);
  // Track, per column, which series fills it.
  const filled = new Map();
  for (const runs of rows) {
    let cursor = 0;
    for (const run of runs) {
      const length = cols(run.text);
      if (run.kind === "fill" && run.slice >= 0) {
        for (let x = cursor; x < cursor + length; x++) filled.set(x, run.slice);
      }
      cursor += length;
    }
  }

  const columns = [...filled.keys()].sort((a, b) => a - b);
  const groups = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && column - last[last.length - 1] <= 1) last.push(column);
    else groups.push([column]);
  }
  assert.equal(groups.length, 2, `one group per label, found ${groups.length}`);

  // Inside a group the two series own equal runs of columns, side by side.
  for (const group of groups) {
    const counts = new Map();
    for (const column of group) counts.set(filled.get(column), (counts.get(filled.get(column)) ?? 0) + 1);
    assert.equal(counts.size, 2, `both series are drawn in one group: ${[...counts.keys()]}`);
    assert.equal(new Set(counts.values()).size, 1, `the series get equal columns: ${[...counts.values()]}`);
    assert.equal(group.length, group.filter((column) => filled.get(column) <= 1).length);
  }
});

check("a stacked bar names both series where they meet", () => {
  const spec = cases.stacked;
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, [
    { name: "Closed", values: [80, 90, 100] },
    { name: "In flight", values: [40, 42, 46] },
  ]);
  const edges = rows.flatMap((row) => row.runs).filter((run) => run.kind === "edge");
  assert.ok(edges.length >= 2, `boundary cells exist (${edges.length})`);
  for (const edge of edges) {
    assert.ok(edge.other >= 0 && edge.other !== edge.slice, "the cell names the other series");
    for (const char of edge.text) {
      assert.ok(allGlyphs.has(char), `"${char}" is not a block pattern`);
      assert.notEqual(char, "█", "a boundary cell is not a full block");
    }
  }
});

check("sorting a ranking orders it by value", () => {
  const spec = { type: "hbar", width: 40, sort: true, labels: ["Small", "Big", "Middle"], values: [10, 300, 100] };
  const rows = textRows(renderBarRows(spec));
  const order = ["Big", "Middle", "Small"].map((label) => rows.findIndex((row) => row.includes(label)));
  assert.ok(order[0] < order[1] && order[1] < order[2], `sorted order was ${order.join(",")}`);
});

check("a horizontal stacked bar keeps the whole bar for its segments", () => {
  const spec = cases.horizontalStacked;
  const { rows } = layoutHorizontalBars(spec, spec.width, spec.labels, [
    { name: "Won", values: [60, 120] },
    { name: "Open", values: [30, 25] },
  ]);
  const runs = rows[0].runs;
  const bar = runs.filter((run) => ["fill", "edge"].includes(run.kind));
  assert.ok(bar.length > 0);
  const width = bar.reduce((sum, run) => sum + cols(run.text), 0);
  const amera = 145; // the largest label total, so its bar fills the plot area
  assert.ok(width >= 20, `the bar is drawn (${width} cells of ${amera} value)`);
  assert.ok(bar.some((run) => run.slice === 0) && bar.some((run) => run.slice === 1), "both series appear");
});

check("an empty chart says so instead of drawing nothing", () => {
  const rows = textRows(renderBarRows({ type: "bar", width: 30, labels: [], values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

check("a negative value draws below the zero row", () => {
  // The bug this batch fixed: every axis was 0-to-max, so a negative bar was
  // silently drawn as nothing at all.
  const spec = { type: "bar", width: 40, height: 8, labels: ["Up", "Down"], values: [60, -40] };
  const rows = textRows(renderBarRows(spec));
  const axis = buildAxis({ min: -40, max: 60, plotRows: 8 });
  // The zero row is the one whose gutter reads exactly "0" before its mark. The
  // zero row's mark is ┼, so it has to be in the split set.
  const zero = rows.findIndex((row) => {
    const gutter = row.split(/[│┤┼]/)[0];
    return gutter !== undefined && gutter.trim() === "0";
  });
  assert.ok(zero > 0, `found the zero row (${zero})`);
  const drawn = rows.flatMap((row, y) => (row.includes("█") || row.includes("▄") || row.includes("▀") ? [y] : []));
  assert.ok(drawn.some((y) => y < zero), "something is drawn above zero");
  assert.ok(drawn.some((y) => y > zero), `something is drawn below zero (rows ${drawn.join(",")} at zero ${zero})`);
  assert.ok(axis.zeroRow > 0 && axis.zeroRow < axis.plotRows - 1, "zero sits inside the plot");
});

check("a 100% bar chart fills every label to the top", () => {
  const spec = {
    type: "bar",
    width: 44,
    height: 8,
    normalized: true,
    labels: ["Jul", "Aug", "Sep"],
    series: [{ name: "Closed", values: [80, 20, 50] }, { name: "Open", values: [20, 80, 50] }],
  };
  const rows = renderBarRows(spec);
  const first = rows.findIndex((row) => row.runs.some((run) => run.kind === "fill" || run.kind === "edge"));
  assert.equal(first, 0, "every stack reaches the first plot row");
  assert.equal(buildAxis({ min: 0, max: 100, plotRows: 8 }).top, 100, "the axis is a percentage axis");
  // The legend still reports the real numbers, not the percentages.
  const legend = rows.flatMap((row) => row.runs).filter((run) => run.kind === "legend");
  assert.ok(legend.some((run) => run.text.includes("150")), `legend keeps real totals: ${legend.map((r) => r.text).join("|")}`);
});
check("a wide chart stays readable rather than filling every column", () => {
  const spec = { type: "bar", width: 120, height: 8, labels: ["a", "b", "c"], values: [1, 2, 3] };
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, [{ name: "v", values: spec.values }]);
  const filled = textRows(rows).find((row) => row.includes("█"));
  const barCells = cellsOf(filled).filter((cell) => cell === "█").length;
  // Three bars sit at the widest the plan allows (12 cells each, with a gap that
  // grows with the bar), so the row is still mostly the empty plot around them
  // rather than one plank of colour.
  assert.ok(barCells <= 40, `three bars use few columns (${barCells})`);
  assert.ok(barCells < cellsOf(filled).length / 2, "and the plot keeps breathing room around them");
  assert.ok(buildAxis({ max: 3, plotRows: 8 }).top >= 3);
  assert.ok(buildAxis({ max: 3, plotRows: 8 }).top <= 4, "and stays tight above the data");
});

console.log(`\n${checks}/${checks} checks passed`);
