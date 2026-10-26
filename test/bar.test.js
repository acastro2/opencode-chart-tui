import assert from "node:assert/strict";
import { cols, formatNumber, runsText } from "../src/core.js";
import { renderBarRows, layoutVerticalBars, layoutHorizontalBars, verticalLabelRow, hiddenCategoryCount } from "../src/bar.js";
import { buildAxis } from "../src/axis.js";
import { glyphFor, modeShape } from "../src/mosaic.js";
import { styleOf, THEMES } from "../src/theme.js";

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

/** The rows, per series, that carry that series' own bar cells. */
function seriesRows(rows) {
  const drawn = new Map();
  for (const [y, row] of rows.entries()) {
    for (const run of row.runs) {
      if (run.slice < 0 || (run.kind !== "fill" && run.kind !== "edge")) continue;
      if (!drawn.has(run.slice)) drawn.set(run.slice, []);
      drawn.get(run.slice).push(y);
    }
  }
  return drawn;
}

/** The row that carries the zero line: the one whose gutter reads "0". */
function zeroRowOf(rows) {
  const index = rows.findIndex((row) => runsText(row.runs).split(/[│┤┼]/)[0].trim() === "0");
  assert.ok(index >= 0, "the chart draws a zero row");
  return index;
}

/** Each series' height in rows, measured from the zero row to the bar's top. */
function heightsBySeries(rows) {
  const zero = zeroRowOf(rows);
  const heights = new Map();
  for (const [slice, drawn] of seriesRows(rows)) {
    const top = Math.min(...drawn);
    heights.set(slice, { top, bottom: Math.max(...drawn), height: zero - top + 1 });
  }
  return { zero, heights };
}

check("every grouped series bar starts on the zero row", () => {
  // The bug: the second series' range was built on the first's running total, so
  // Open (40) was drawn from 80 upwards and never reached the floor.
  const spec = cases.grouped;
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, spec.series);
  const zero = zeroRowOf(rows);
  const drawn = seriesRows(rows);
  for (const [slice, item] of spec.series.entries()) {
    const rowsOfSeries = drawn.get(slice);
    assert.ok(rowsOfSeries, `${item.name} is drawn at all`);
    assert.equal(
      Math.max(...rowsOfSeries),
      zero,
      `${item.name} reaches the zero row (row ${Math.max(...rowsOfSeries)} of ${zero})`,
    );
  }
});

check("a grouped bar's height follows its own value", () => {
  // 80 and 20 on a 12-row axis of 0..80: the tall bar fills the plot and the
  // short one fills exactly a quarter of it.
  const spec = {
    type: "bar",
    width: 40,
    plotHeight: 12,
    legend: false,
    labels: ["Jul"],
    series: [{ name: "Closed", values: [80] }, { name: "Open", values: [20] }],
  };
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, spec.series);
  const { heights } = heightsBySeries(rows);
  const closed = heights.get(0);
  const open = heights.get(1);
  assert.ok(closed && open, "both series are drawn");
  assert.equal(closed.height, 12, `the tall bar fills the plot (${closed.height})`);
  assert.equal(open.height, 3, `the quarter bar is a quarter as tall (${open.height})`);
  assert.equal(closed.height / open.height, 4, "the heights keep the value ratio");
});

check("two grouped series of equal value draw equal heights", () => {
  const spec = {
    type: "bar",
    width: 40,
    plotHeight: 12,
    legend: false,
    labels: ["Jul"],
    series: [{ name: "A", values: [60] }, { name: "B", values: [60] }],
  };
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, spec.series);
  const drawn = seriesRows(rows);
  assert.ok(drawn.get(0) && drawn.get(1), "both series are drawn");
  assert.deepEqual(drawn.get(1), drawn.get(0), "the equal bars occupy the same rows");
  assert.equal(heightsBySeries(rows).heights.get(1).height, 12, "and they fill the plot");
});

check("a stacked chart still stacks", () => {
  // The grouped fix must not ground every series: a stack keeps growing upwards.
  const spec = {
    type: "bar",
    width: 40,
    plotHeight: 12,
    legend: false,
    stacked: true,
    labels: ["Jul"],
    series: [{ name: "Closed", values: [60] }, { name: "Open", values: [20] }],
  };
  const { rows } = layoutVerticalBars(spec, spec.width, spec.labels, spec.series);
  const zero = zeroRowOf(rows);
  const drawn = seriesRows(rows);
  const lower = [Math.min(...drawn.get(0)), Math.max(...drawn.get(0))];
  const upper = [Math.min(...drawn.get(1)), Math.max(...drawn.get(1))];
  assert.deepEqual(lower, [3, zero], `the lower series sits on the floor: ${lower}`);
  assert.deepEqual(upper, [0, 2], `the upper series sits on the lower one: ${upper}`);
  assert.equal(upper[1] + 1, lower[0], "the two parts meet without a gap");
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

check("a horizontal bar value contrasts with the chart background", () => {
  // The value sits in the suffix outside the bar. A series-coloured background
  // there reads as an extra bar segment, so the label owns the chart background.
  const expected = [4200, 3100, 2900].map(formatNumber);
  for (const name of ["dark", "light"]) {
    const theme = THEMES[name];
    const runs = renderBarRows({ ...cases.horizontal, theme: name }).flatMap((row) => row.runs);
    const values = runs.filter((run) => expected.some((text) => run.text.includes(text)));
    assert.equal(values.length, 3, `${name}: three value runs, found ${values.length}`);
    for (const run of values) {
      assert.equal(run.kind, "label", "the value is a label, not a fill");
      assert.equal(run.slice, -1, "the suffix is outside the series");
      const style = styleOf(run, theme.palette, theme);
      assert.equal(style.bg, theme.background, `${name}: the background is the chart`);
      assert.notEqual(style.fg, style.bg, `${name}: the foreground contrasts (${style.fg} on ${style.bg})`);
    }
  }
});

check("more categories than columns are hidden with a note", () => {
  const labels = Array.from({ length: 20 }, (_, index) => `S${index}`);
  const values = labels.map((_, index) => index + 1);
  const rows = renderBarRows({ type: "bar", width: 16, height: 8, labels, values });
  for (const row of rows) {
    const width = cols(runsText(row.runs));
    assert.ok(width <= 16, `a row fits the 16-cell chart (${width})`);
  }
  const text = rows.map((row) => runsText(row.runs)).join("\n");
  assert.match(text, /hidden/);
});

check("one hidden category is named in full when it fits", () => {
  // The short note exists for a chart too narrow for the sentence; at width 18
  // there is room, so the reader gets the singular and the real word.
  const labels = Array.from({ length: 15 }, (_, index) => `L${index}`);
  const values = labels.map((_, index) => index + 1);
  const rows = textRows(renderBarRows({ type: "bar", width: 18, height: 6, labels, values }));
  const note = rows.find((row) => row.includes("hidden"));
  assert.equal(note.trim(), "1 category hidden");
  assert.ok(cols(note) <= 18);
});

check("a chart with no data keeps its title", () => {
  const rows = textRows(renderBarRows({ type: "bar", width: 30, title: "Nothing", labels: [], values: [] }));
  assert.equal(rows.length, 2, "title and one note");
  assert.equal(rows[0], "Nothing");
  assert.match(rows[1], /no data/);
});

check("a 100% horizontal bar divides each label's own total", () => {
  // EMEA is 60 of 90, AMER 120 of 145: normalized, each bar fills the plot, so
  // the smaller label is not drawn short against the larger total.
  const spec = {
    type: "hbar",
    width: 44,
    normalized: true,
    labels: ["EMEA", "AMER"],
    series: [{ name: "Won", values: [60, 120] }, { name: "Open", values: [30, 25] }],
  };
  const { rows } = layoutHorizontalBars(spec, spec.width, spec.labels, spec.series);
  const barWidth = (row) =>
    row.runs.filter((run) => run.kind === "fill" || run.kind === "edge").reduce((sum, run) => sum + cols(run.text), 0);
  assert.equal(barWidth(rows[0]), barWidth(rows[1]), "both bars are full");
  assert.ok(barWidth(rows[0]) >= 20);
  // One series in a stack is its own total, so the row still reports the value.
  const single = layoutHorizontalBars({ type: "hbar", width: 40, stacked: true, labels: ["a", "b"], values: [5, 9] }, 40, ["a", "b"], [
    { name: "v", values: [5, 9] },
  ]);
  assert.match(runsText(single.rows[1].runs), /9/);
});

check("a track stops where the bar ends", () => {
  const spec = { type: "hbar", width: 40, track: true, labels: ["Full", "Half"], values: [10, 5] };
  const series = [{ name: "v", values: spec.values }];
  const { rows } = layoutHorizontalBars(spec, spec.width, spec.labels, series);
  const trackOf = (row) => row.runs.filter((run) => run.kind === "track");
  assert.equal(trackOf(rows[0]).length, 0, "a full bar has no track left");
  assert.ok(trackOf(rows[1]).length > 0, "a short bar keeps a track");
  for (const row of rows) assert.ok(cols(runsText(row.runs)) <= spec.width);
});

check("a textured bar tells its series apart without colour", () => {
  // Partial cells keep their mosaic glyph; only the solid blocks are swapped for
  // the series texture, and the two series must not share one.
  const fills = renderBarRows({ ...cases.stacked, textured: true })
    .flatMap((row) => row.runs)
    .filter((run) => run.kind === "fill");
  const solid = (slice) =>
    new Set(fills.filter((run) => run.slice === slice).flatMap((run) => [...run.text]).filter((char) => "█░▓▒".includes(char)));
  assert.deepEqual([...solid(0)], ["█"], "series 0 keeps the full block");
  assert.deepEqual([...solid(1)], ["░"], "series 1 is drawn in its texture");
});

check("long bin labels are thinned instead of cut down", () => {
  // A histogram gives the bar fence labels wider than one bar slot. Slot
  // labels would cut them to "0.0-"; point labels keep the whole text and drop
  // the neighbours that collide.
  const labels = ["0.0-9.9", "10.0-19.9", "20.0-29.9", "30.0-39.9"];
  const series = [{ name: "n", values: [4, 9, 6, 2] }];
  const point = verticalLabelRow({ type: "bar", width: 30, slotLabels: false }, 30, labels, series);
  const slot = verticalLabelRow({ type: "bar", width: 30 }, 30, labels, series);
  assert.ok(point.includes("0.0-9.9"), `the point label keeps its text: "${point}"`);
  assert.ok(!slot.includes("0.0-9.9"), `the slot label is cut to its slot: "${slot}"`);
  assert.ok(cols(point) <= 30 && cols(slot) <= 30);
});

check("a two-series chart can turn its legend off", () => {
  const rows = renderBarRows({ ...cases.grouped, legend: false });
  assert.equal(rows.flatMap((row) => row.runs).filter((run) => run.kind === "legend").length, 0);
  assert.ok(rows.some((row) => row.runs.some((run) => run.kind === "fill")), "the bars are still drawn");
});

check("sorting only reorders a single series", () => {
  // Two series have no single ranking to sort by, so the labels keep their order.
  const spec = {
    type: "hbar",
    width: 40,
    sort: true,
    labels: ["Small", "Big"],
    series: [{ name: "a", values: [10, 300] }, { name: "b", values: [20, 100] }],
  };
  const rows = textRows(renderBarRows(spec));
  assert.ok(rows.findIndex((row) => row.includes("Small")) < rows.findIndex((row) => row.includes("Big")));
});

check("horizontal: true and the hbar type draw the same chart", () => {
  const flagged = renderBarRows({ ...cases.horizontal, type: "bar", horizontal: true });
  assert.deepEqual(textRows(flagged), textRows(renderBarRows(cases.horizontal)));
});

check("valueLabels: false leaves the bars bare", () => {
  const rows = textRows(renderBarRows({ type: "bar", width: 40, height: 8, valueLabels: false, labels: ["Jul"], values: [118] }));
  assert.ok(!rows.join("\n").includes("118"), "the number is not written on the bar");
});

check("a 100% chart of zeros does not divide by zero", () => {
  const rows = renderBarRows({ type: "bar", width: 30, height: 6, normalized: true, labels: ["a", "b"], values: [0, 0] });
  const text = textRows(rows).join("\n");
  assert.ok(!/NaN|Infinity/.test(text), "the axis and the values stay finite");
  assert.ok(!text.includes("█"), "no bar is drawn from nothing");
});

check("the hidden-category note survives the height budget", () => {
  // At width 24 twenty categories cannot all fit, so the note is the only thing
  // that says the picture is short. The note is a row too: it must be counted
  // before the plot is sized, or fitToHeight trims it and the loss is silent.
  const labels = Array.from({ length: 30 }, (_, index) => `S${index}`);
  const rows = renderBarRows({
    type: "bar", width: 24, height: 8, labels, values: labels.map((_, index) => index + 1),
  });
  const text = rows.map((row) => runsText(row.runs)).join("\n");
  assert.match(text, /hidden/, "the hidden categories are reported");
  assert.doesNotMatch(text, /row hidden at/, "the note is not itself trimmed");
  assert.ok(rows.length <= 8, `the block stays inside the height budget (${rows.length})`);
});

check("a noteRow key in the fence does not cost a plot row", () => {
  // `noteRow` is the internal second-pass flag: it belongs to the layout call,
  // not to the spec. A fence that happens to carry one must draw the same
  // chart as one that does not.
  const spec = { type: "bar", width: 40, height: 8, labels: ["Jul", "Aug", "Sep"], values: [118, 132, 146] };
  assert.deepEqual(
    textRows(renderBarRows({ ...spec, noteRow: true })),
    textRows(renderBarRows(spec)),
  );
});

check("the exported hidden count is the count the note reports", () => {
  const labels = Array.from({ length: 30 }, (_, index) => `S${index}`);
  const values = labels.map((_, index) => index + 1);
  const series = [{ name: "v", values }];
  const spec = { type: "bar", width: 24, labels, values };
  const hidden = hiddenCategoryCount(spec, 24, labels, series);
  assert.ok(hidden > 0, `some categories are hidden (${hidden})`);
  const note = textRows(renderBarRows({ ...spec, height: 8 })).find((row) => row.includes("hidden"));
  assert.ok(note, "the chart prints a note");
  assert.equal(Number(note.match(/\d+/)[0]), hidden, `the note reports the same count: "${note}"`);
  assert.equal(hiddenCategoryCount({ type: "bar", width: 60 }, 60, ["a", "b"], [{ name: "v", values: [1, 2] }]), 0);
});

console.log(`\n${checks}/${checks} checks passed`);
