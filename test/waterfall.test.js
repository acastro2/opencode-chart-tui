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

const spec = {
  type: "waterfall",
  width: 48,
  height: 9,
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

console.log(`\n${checks}/${checks} checks passed`);
