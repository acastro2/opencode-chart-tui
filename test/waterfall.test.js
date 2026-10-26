import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { normalizeSteps, renderWaterfallRows, WATERFALL_DOWN, WATERFALL_TOTAL, WATERFALL_UP } from "../src/waterfall.js";
import { buildAxis } from "../src/axis.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

/** A drawn bar cell: a block or shade, not a connector, a digit or the legend. */
const isBar = (cell) => {
  if (!cell || cell === " ") return false;
  const point = cell.codePointAt(0);
  return (
    (point >= 0x2580 && point <= 0x259f) ||
    (point >= 0x1fb00 && point <= 0x1fbff) ||
    (point >= 0x1cc00 && point <= 0x1cebf)
  );
};

/** Columns that carry a bar, grouped into runs of adjacent columns. */
const barGroupsOf = (rows) => {
  const columns = new Set();
  for (const row of rows) {
    for (const [x, cell] of cellsOf(row).entries()) if (isBar(cell)) columns.add(x);
  }
  const groups = [];
  for (const x of [...columns].sort((a, b) => a - b)) {
    const last = groups[groups.length - 1];
    if (last && x - last[last.length - 1] <= 1) last.push(x);
    else groups.push([x]);
  }
  return groups;
};

const spec = {
  type: "waterfall",
  width: 48,
  plotHeight: 9,
  title: "ARR movement",
  labels: ["Start", "New", "Churn", "Expansion"],
  values: [120, 45, -30, 25],
};

check("the running total follows the deltas", () => {
  const { steps, total } = normalizeSteps(spec);
  assert.equal(total, 160);
  assert.deepEqual(
    steps.map((step) => [step.from, step.to, step.kind]),
    [
      [0, 120, 0],
      [120, 165, 0],
      [165, 135, 1],
      [135, 160, 0],
      [0, 160, 2],
    ],
  );
  assert.equal(steps[4].label, "Total");
});

check("a delta bar floats between two totals and the total starts at zero", () => {
  const { steps } = normalizeSteps(spec);
  // The second delta is not a bar from zero, it is a bar from the first total.
  assert.equal(steps[1].from, 120);
  assert.equal(steps[1].to, 165);
  assert.equal(steps[2].to, 135, "a negative delta lowers the total");
  const last = steps[steps.length - 1];
  assert.equal(last.from, 0, "the total is a level, not a movement");
  assert.equal(last.kind, 2);
});

check("the total can be left out and the start can be seeded", () => {
  const opened = normalizeSteps({ values: [10, -4] });
  assert.equal(opened.steps.length, 3, "two deltas plus the total");
  const closed = normalizeSteps({ values: [10, -4], total: false });
  assert.equal(closed.steps.length, 2);
  assert.equal(closed.total, 6, "the running total is reported either way");
  const seeded = normalizeSteps({ start: 100, values: [10], total: false });
  assert.equal(seeded.steps[0].from, 100);
  assert.equal(seeded.steps[0].to, 110);
});

check("up, down and total are three different colours", () => {
  const colours = new Set(
    renderWaterfallRows(spec)
      .flatMap((row) => row.runs)
      .filter((run) => run.color)
      .map((run) => run.color),
  );
  assert.ok(colours.has(WATERFALL_UP), "a rise is drawn in the up colour");
  assert.ok(colours.has(WATERFALL_DOWN), "a fall is drawn in the down colour");
  assert.ok(colours.has(WATERFALL_TOTAL), "the total has its own colour");
  assert.equal(colours.size, 3);
});

check("a connector joins each bar to the next", () => {
  const rows = textRows(renderWaterfallRows(spec));
  const axis = buildAxis({ min: 0, max: 165, plotRows: 9 });
  const zero = axis.zeroRow;
  const connectors = rows.filter((row, y) => y !== zero && row.includes("─")).length;
  assert.ok(connectors >= 4, `four joins between five bars, saw ${connectors} rows with a connector`);
});

check("the bars sit above the zero row and the total reaches the running total", () => {
  const rows = textRows(renderWaterfallRows(spec));
  const axis = buildAxis({ min: 0, max: 165, plotRows: 9 });
  const drawn = rows.map((row, y) => (row.includes("█") || row.includes("▂") || row.includes("🮅") ? y : -1)).filter((y) => y >= 0);
  assert.ok(drawn.length > 0);
  assert.ok(Math.min(...drawn) < axis.zeroRow, "bars are drawn above zero");
  // The tallest bar belongs to the largest level, 165 (New) and 160 (Total).
  const tallest = rows.findIndex((row) => row.includes("█"));
  assert.ok(tallest < axis.zeroRow);
});

check("a signed label appears once per step and no row overflows", () => {
  const rows = textRows(renderWaterfallRows(spec));
  for (const label of ["+120", "+45", "-30", "+25"]) {
    const seen = rows.filter((row) => row.includes(label)).length;
    assert.equal(seen, 1, `${label} appears ${seen} times`);
  }
  for (const row of rows) assert.ok(cols(row) <= spec.width, `"${row}" is ${cols(row)} of ${spec.width}`);
});

check("the legend names the directions that occur", () => {
  const legend = textRows(renderWaterfallRows(spec)).filter((row) => row.includes("up") || row.includes("down"));
  assert.equal(legend.length, 1);
  assert.match(legend[0], /▲ up/);
  assert.match(legend[0], /▼ down/);
  assert.match(legend[0], /■ total/);

  // One direction and no total is a single kind, so there is nothing to explain.
  const onlyUp = textRows(renderWaterfallRows({ ...spec, values: [10, 20], total: false }));
  assert.equal(onlyUp.filter((row) => row.includes("up")).length, 0, "one direction needs no legend");
});

check("an empty waterfall says so", () => {
  const rows = textRows(renderWaterfallRows({ type: "waterfall", width: 30, values: [] }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

check("every drawn cell is a real block pattern", () => {
  for (const row of textRows(renderWaterfallRows(spec))) {
    for (const cell of cellsOf(row)) {
      // Digits, signs and the axis frame are text, not drawing. So are the
      // legend markers, which name a direction rather than plotting a value.
      if (cell === " " || /[0-9a-zA-Z+.,%│┤┼-]/.test(cell) || "▲▼■●".includes(cell)) continue;
      const point = cell.codePointAt(0);
      const canvas =
        (point >= 0x2500 && point <= 0x259f) || // box drawing, block elements, shades
        (point >= 0x1fb00 && point <= 0x1fbff) || // legacy computing: sextants and quarter blocks
        (point >= 0x1cc00 && point <= 0x1cebf); // legacy computing supplement: octants
      assert.ok(canvas, `"${cell}" U+${point.toString(16)} is not a block or a connector`);
    }
  }
});

check("each label sits under its own bar", () => {
  const spec = {
    type: "waterfall",
    width: 64,
    height: 9,
    labels: ["Jan", "Feb", "Mar", "Apr"],
    values: [120, 45, -30, 25],
  };
  const rows = textRows(renderWaterfallRows(spec));
  const labelRow = rows[rows.length - 2];
  const groups = barGroupsOf(rows.slice(0, -2));
  assert.equal(groups.length, 5, `four deltas plus the total, found ${groups.length}`);
  for (const [index, label] of [...spec.labels, "Total"].entries()) {
    const at = labelRow.indexOf(label);
    assert.ok(at >= 0, `${label} is drawn`);
    const group = groups[index];
    const markCentre = (group[0] + group[group.length - 1]) / 2;
    const labelCentre = at + (cols(label) - 1) / 2;
    assert.ok(Math.abs(labelCentre - markCentre) <= 1, `${label} sits at ${labelCentre}, its bar at ${markCentre}`);
  }
});

check("twenty steps at width 16 fill the plot and stay inside it", () => {
  const many = {
    type: "waterfall",
    width: 16,
    height: 9,
    labels: Array.from({ length: 20 }, (_, index) => `S${index}`),
    values: Array.from({ length: 20 }, (_, index) => (index % 3 === 0 ? -5 : 8)),
  };
  const rows = textRows(renderWaterfallRows(many));
  assert.ok(rows.length > 0, "the chart renders");
  for (const row of rows) assert.ok(cols(row) <= many.width, `"${row}" is ${cols(row)} of ${many.width}`);

  // One mark per step: each step gets at least one sub-column, so no step can be
  // lost when the column runs out. The grid bounds check stops a write wrapping
  // into the next row instead.
  const gutter = rows[0].indexOf("┤") + 1;
  const drawn = new Set();
  for (const row of rows) {
    for (const [x, cell] of cellsOf(row).entries()) if (isBar(cell) && x >= gutter) drawn.add(x);
  }
  const columns = [...drawn].sort((a, b) => a - b);
  assert.ok(columns.length >= Math.ceil(many.labels.length / 2), `every step keeps a mark (${columns.length} columns)`);
  assert.ok(columns.length <= many.width - gutter, `the bars stay inside the plot (${columns.length})`);
  for (let index = 1; index < columns.length; index++) {
    assert.ok(columns[index] - columns[index - 1] <= 1, `the bars are contiguous at column ${columns[index]}`);
  }
});

check("a narrow waterfall reports the category labels it thinned", () => {
  const many = {
    type: "waterfall",
    width: 16,
    height: 9,
    labels: Array.from({ length: 20 }, (_, index) => `S${index}`),
    values: Array.from({ length: 20 }, (_, index) => (index % 3 === 0 ? -5 : 8)),
  };
  const rows = textRows(renderWaterfallRows(many));
  const labelRow = rows.find((row) => row.includes("S0"));
  assert.ok(labelRow, "the category row is drawn");
  const shown = new Set(labelRow.trim().split(/\s+/)).size;
  const note = rows.find((row) => /labels hidden/.test(row));
  assert.ok(note, "the footer says labels were hidden");
  // Twenty steps plus the total row: every label the row did not draw is hidden.
  const expected = many.labels.length + 1 - shown;
  assert.match(note, new RegExp(`^${expected} labels hidden$`), `"${note}" counts the hidden labels`);
  for (const row of rows) assert.ok(cols(row) <= many.width, `"${row}" is ${cols(row)} of ${many.width}`);

  const wide = textRows(renderWaterfallRows({ ...many, width: 100, height: 9 }));
  assert.ok(!wide.some((row) => /labels? hidden/.test(row)), "a chart that fits every label says nothing");
});

check("a narrow legend is cut to the width and says an entry was left out", () => {
  const narrow = { ...spec, width: 16, height: 7 };
  const rows = textRows(renderWaterfallRows(narrow));
  const legend = rows.find((row) => row.includes("up") || row.includes("down"));
  assert.ok(legend, "the legend is drawn");
  assert.ok(cols(legend) <= narrow.width, `"${legend}" is ${cols(legend)} of ${narrow.width}`);
  assert.match(legend, /…/, "the row shows that an entry was left out");
  assert.ok(!legend.includes("total"), "the entry that did not fit is gone");
});

check("two value labels never touch", () => {
  for (const width of [16, 24, 30, 48]) {
    const rows = textRows(renderWaterfallRows({ ...spec, width, height: 9 }));
    for (const row of rows) {
      assert.ok(!/[0-9][-+][0-9]/.test(row), `"${row}" has two numbers running together at width ${width}`);
    }
  }
});

check("wide labels stay inside a narrow waterfall", () => {
  const wide = { type: "waterfall", width: 26, height: 8, labels: ["开始", "增长", "流失"], values: [120, 45, -30] };
  const rows = textRows(renderWaterfallRows(wide));
  for (const row of rows) assert.ok(cols(row) <= wide.width, `"${row}" is ${cols(row)} of ${wide.width}`);
  const labels = rows.find((row) => row.includes("开始"));
  assert.ok(labels, "the first wide label is drawn");
  assert.equal(cols(labels), wide.width, "the label row is measured in cells, not code units");
});

check("height is the total block, not just the plot", () => {
  const rows = textRows(renderWaterfallRows({ ...spec, plotHeight: undefined, height: 9 }));
  assert.ok(rows.length <= 9, `height 9 drew ${rows.length} rows`);
});

check("plotHeight keeps the plot height while height stays total", () => {
  const rows = textRows(renderWaterfallRows({ ...spec, height: 20, plotHeight: 9 }));
  assert.ok(rows.length <= 20, `height 20 drew ${rows.length} rows`);
});

check("a wide waterfall keeps every category label", () => {
  const wide = {
    type: "waterfall",
    width: 76,
    height: 10,
    labels: ["Start", "New", "Churn", "Expansion"],
    values: [120, 45, -30, 25],
  };
  const rows = textRows(renderWaterfallRows(wide));
  const text = rows.join("\n");
  for (const label of ["Start", "New", "Churn", "Expansion", "Total"]) {
    assert.ok(text.includes(label), `${label} is drawn`);
  }
  assert.ok(!/label hidden/i.test(text), "nothing is reported hidden when the row has room");
});

console.log(`\n${checks}/${checks} checks passed`);
