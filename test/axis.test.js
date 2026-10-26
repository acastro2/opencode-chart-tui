// The axis: round bounds, ticks and gutter, and the two label rows every family
// shares. The checks read the returned numbers and the plain-text rows, so they
// prove what a family is given: the same low/high/step for its scale, a tick on a
// row of its own, and a label row that never runs past the chart's width.

import assert from "node:assert/strict";
import { cols } from "../src/core.js";
import {
  axisRow,
  baseline,
  buildAxis,
  categoryRow,
  niceBounds,
  niceMax,
  pointLabelLayout,
  pointLabelRow,
  subRowOf,
  subRowValue,
  valueAtRow,
} from "../src/axis.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const cellsOf = (row) => [...row];
const isMultiple = (value, step) => Math.abs(value / step - Math.round(value / step)) < 1e-6;

check("a maximum climbs the round ladder and never rounds down", () => {
  // Each step on the ladder 1, 2, 2.5, 5, 10 times a power of ten.
  const ladder = [
    [1, 1],
    [1.5, 2],
    [2.2, 2.5],
    [3, 5],
    [9, 10],
    [10, 10],
    [19, 20],
    [26, 50],
    [87, 100],
    [230, 250],
    [810, 1000],
    [0.03, 0.05],
    [0.4, 0.5],
  ];
  for (const [value, expected] of ladder) {
    assert.equal(niceMax(value), expected, `niceMax(${value})`);
    assert.ok(niceMax(value) >= value, `${value} fits under its maximum`);
  }
  // The sign is irrelevant: a chart of losses tops out the same way.
  assert.equal(niceMax(-87), 100);
  // Nothing to scale is one unit, not zero and not a crash.
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(NaN), 1);
  assert.equal(niceMax("not a number"), 1);
});

check("bounds cover the data, zero and a round step", () => {
  const ranges = [
    [0, 7],
    [0, 87],
    [0, 146],
    [0, 1234],
    [-40, 60],
    [-5, -1],
    [-200, -3],
    [-0.3, -0.1],
    [0.1, 0.3],
    [180, 190],
    [1000, 1001],
    [2, 2],
    [-7, -7],
  ];
  for (const [min, max] of ranges) {
    for (const zero of [true, false]) {
      const { low, high, step } = niceBounds(min, max, 4, zero);
      assert.ok(low <= min && high >= max, `${low}..${high} covers ${min}..${max} (zero ${zero})`);
      assert.ok(step > 0 && Number.isFinite(step), `step ${step} is usable`);
      if (zero) assert.ok(low <= 0 && high >= 0, "zero is on the default axis");
      // Ticks are exact multiples of the step, so their labels line up.
      assert.ok(isMultiple(low, step) && isMultiple(high, step), `${low} and ${high} are multiples of ${step}`);
      assert.ok(high - low >= step, "the range holds at least one step");
    }
  }
  // A wider request makes a wider step, never a narrower one.
  assert.equal(niceBounds(0, 100, 4).step, 25, "four ticks fit a hundred");
  assert.equal(niceBounds(0, 100, 2).step, 50, "two ticks take half of it");
  assert.equal(niceBounds(0, 100, 10).step, 10, "ten ticks take a tenth");
});

check("an all-zero or all-negative range still has a scale", () => {
  assert.deepEqual(niceBounds(0, 0), { low: 0, high: 1, step: 0.25 }, "an empty chart gets a quarter-unit step");
  assert.deepEqual(niceBounds(-5, -1), { low: -6, high: 0, step: 2 }, "a loss chart stops at zero");

  const negatives = buildAxis({ min: -5, max: -1, plotRows: 6 });
  assert.equal(negatives.top, 0, "zero is the top of a chart that only goes down");
  assert.ok(negatives.bottom <= -5, "and the bottom still covers the data");
  assert.equal(negatives.zeroRow, 0, "the axis line is the first row");
  assert.equal(negatives.ticks[negatives.ticks.length - 1].value, negatives.bottom, "the last tick is the floor");
  assert.ok(negatives.ticks.every((tick) => tick.value <= 0), "no positive tick on a negative axis");

  const empty = buildAxis({ min: 0, max: 0, plotRows: 8 });
  assert.equal(empty.top, 1, "zero and zero becomes a one-unit axis");
  assert.equal(empty.bottom, 0);
  assert.ok(empty.zeroRow >= 0 && empty.zeroRow < empty.plotRows, "and zero has a row to sit on");
  assert.equal(empty.zeroRow, empty.rowOf(0));
});

check("a flat series is drawn around its value, not around zero", () => {
  // Prices or scores a few units apart collapse into one row when zero is forced
  // in, so a caller can ask for the range without it.
  for (const [value, min, max] of [[5, 4.5, 5.5], [-7, -7.5, -6.5]]) {
    const bounds = niceBounds(value, value, 4, false);
    assert.deepEqual(bounds, { low: min, high: max, step: 0.25 }, `${value} gets its own range`);
    assert.ok(bounds.low < value && value < bounds.high, "the value is inside the range");
    assert.ok(!(bounds.low <= 0 && bounds.high >= 0), "zero is left out");
    assert.ok(isMultiple(bounds.low, bounds.step) && isMultiple(bounds.high, bounds.step));
  }
  const withZero = buildAxis({ min: 5, max: 5, plotRows: 8 });
  assert.equal(withZero.bottom, 0, "the default still reaches zero");
  assert.ok(withZero.top > 5, "and still covers the value");

  // A range that leaves zero out has no zero row to draw, and its baseline says
  // zero without pretending the row exists.
  const tight = buildAxis({ min: 180, max: 190, plotRows: 8, zero: false });
  assert.ok(tight.bottom >= 180 && tight.top <= 190, "the tight axis stays on the data");
  assert.equal(tight.zeroRow, -1, "and has no zero row");
  assert.deepEqual(
    baseline(tight, 4),
    { text: "  0", mark: "┼", line: "────" },
    "its baseline falls back to zero",
  );
});

check("the gutter is the widest tick label plus its mark", () => {
  for (const [min, max] of [[0, 7], [0, 87], [-40, 60], [0, 1234], [-200, -3]]) {
    const axis = buildAxis({ min, max, plotRows: 8 });
    const widest = Math.max(...axis.ticks.map((tick) => cols(tick.label)));
    assert.equal(axis.gutter, widest + 1, `gutter for ${min}..${max}`);
    for (const tick of axis.ticks) {
      assert.equal(cols(tick.label), widest, "every tick label is padded to the same width");
      assert.equal(cols(tick.label), axis.gutter - 1, "and the mark takes exactly one cell");
      assert.equal(cols(axisRow(axis, tick.row).text), axis.gutter - 1, "an axis row is the same width");
    }
  }
  // A five-figure axis needs more room than a single-figure one, and it says so.
  assert.ok(buildAxis({ max: 1234, plotRows: 8 }).gutter > buildAxis({ max: 7, plotRows: 8 }).gutter);
});

check("a tick keeps a row to itself and zero wins a shared one", () => {
  for (const [min, max] of [[0, 7], [0, 87], [-40, 60], [-200, -3]]) {
    const axis = buildAxis({ min, max, plotRows: 8 });
    const rows = axis.ticks.map((tick) => tick.row);
    assert.equal(new Set(rows).size, rows.length, "no two ticks share a row");
    assert.deepEqual(rows, [...rows].sort((a, b) => a - b), "the ticks are ordered top to bottom");
    assert.ok(Math.min(...rows) >= 0 && Math.max(...rows) < axis.plotRows, "every tick is inside the plot");
    assert.equal(axis.zeroRow, axis.rowOf(0), "zero has a row of its own");
  }
  // A short plot loses the tick that collides with zero, never the zero tick: the
  // axis line needs its label more than 0.1 does.
  const tight = buildAxis({ min: 0, max: 0.3, plotRows: 3 });
  assert.ok(tight.ticks.some((tick) => tick.value === 0), "zero is still labelled");
  assert.ok(!tight.ticks.some((tick) => Math.abs(tick.value - 0.1) < 1e-9), "the colliding tick is gone");

  const tickRow = tight.ticks[0].row;
  assert.equal(axisRow(tight, tickRow).mark, "┤", "a tick row has its mark");
  assert.equal(axisRow(tight, tickRow).tick, true);
  assert.equal(axisRow(tight, 99).mark, "│", "a plain row has the line");
  assert.equal(axisRow(tight, 99).text.trim(), "", "and no label");

  const axis = buildAxis({ min: 0, max: 100, plotRows: 8 });
  const frame = baseline(axis, 12);
  assert.equal(frame.mark, "┼");
  assert.equal(frame.text, axis.ticks.find((tick) => tick.row === axis.zeroRow).label, "the zero label is kept");
  assert.equal(frame.line, "────────────", "the line is as wide as the plot");
});

check("the row of a value is clamped to the plot", () => {
  const axis = buildAxis({ min: -40, max: 60, plotRows: 8 });
  assert.equal(axis.rowOf(axis.top), 0, "the top of the axis is the first row");
  assert.equal(axis.rowOf(axis.bottom), axis.plotRows - 1, "the bottom is the last row");
  assert.equal(axis.rowOf(1e9), 0, "a value above the axis is pinned to the top");
  assert.equal(axis.rowOf(-1e9), axis.plotRows - 1, "a value below it is pinned to the bottom");
  assert.equal(axis.rowOf(NaN), axis.rowOf(0), "a value that is not a number reads as zero");
  // A plot always has at least three rows to carry a zero line between two ticks.
  assert.equal(buildAxis({ max: 10, plotRows: 1 }).plotRows, 3);
  assert.equal(buildAxis({ max: 10, plotRows: 3.7 }).plotRows, 3);
});

check("the sub-row helpers agree with the axis", () => {
  const axis = buildAxis({ min: 0, max: 100, plotRows: 8 });
  assert.equal(valueAtRow(axis, 0), 100, "row zero is the top value");
  assert.equal(valueAtRow(axis, 8), 0, "the row below the last is the bottom value");
  assert.equal(valueAtRow(axis, 4), 50, "halfway down is half the range");

  assert.equal(subRowOf(axis, 100, 16), 0, "the top value lands in the first sub-row");
  assert.equal(subRowOf(axis, 0, 16), 15, "the bottom value lands in the last one");
  assert.equal(subRowOf(axis, 1e9, 16), 0, "and a value outside the axis is clamped");
  for (const subRow of [0, 1, 5, 8, 15]) {
    assert.equal(subRowOf(axis, subRowValue(axis, subRow, 16), 16), subRow, `sub-row ${subRow} round-trips`);
  }
});

check("category labels centre in their slots", () => {
  const slot = { groupWidth: 6, gap: 2, width: 40 };
  const row = categoryRow(["Mon", "Tue", "Wed"], slot);
  for (const [index, label] of ["Mon", "Tue", "Wed"].entries()) {
    const start = index * (slot.groupWidth + slot.gap);
    const expected = start + Math.floor((slot.groupWidth - cols(label)) / 2);
    assert.equal(row.indexOf(label), expected, `${label} is centred in slot ${index}`);
    assert.equal(cols(row), 40, "the row is exactly the chart width");
  }
  assert.deepEqual(cellsOf(row).slice(4, 6), [" ", " "], "adjacent labels keep two cells between them");

  // The whole row shifts with the plot: a gutter is not part of a slot.
  const shifted = categoryRow(["Mon", "Tue"], { ...slot, slotOffset: 5 });
  assert.equal(shifted.indexOf("Mon"), row.indexOf("Mon") + 5, "the first label starts five cells right");
  assert.equal(shifted.slice(0, 5).trim(), "", "and nothing is drawn in the gutter");
});

check("a category label is cut to its slot and to the row's edge", () => {
  const long = categoryRow(["January", "February", "March"], { groupWidth: 3, gap: 1, width: 30 });
  assert.ok(long.includes("Jan") && long.includes("Feb") && long.includes("Mar"), "each label is cut to three cells");
  assert.ok(!long.includes("January"), "the rest of the name is gone");
  assert.equal(cols(long), 30);

  // The last slot starts before the edge but its text does not fit: cut it, do
  // not run past the width.
  const edge = categoryRow(["a", "b", "c", "d", "ef"], { groupWidth: 2, gap: 0, width: 9 });
  assert.equal(edge, "a b c d e", "the last label keeps the one cell it has");

  // A wide glyph is measured in cells: one fits a three-cell slot, not two.
  const cjk = categoryRow(["設計"], { groupWidth: 3, gap: 1, width: 20 });
  assert.ok(cjk.includes("設"), "the first glyph is kept");
  assert.ok(!cjk.includes("構"), "the second would overflow the slot");
});

check("a category slot with no room drops its label", () => {
  // One cell per slot and no gap: there is no blank to separate the labels, so
  // every other one goes.
  const narrow = categoryRow(["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], { groupWidth: 1, gap: 0, width: 6 });
  assert.equal(narrow, "J S N ", "alternates are dropped, not merged");
  assert.equal(cols(narrow), 6);

  // A two-cell glyph cannot start at the only column there is.
  const none = categoryRow(["設計"], { groupWidth: 2, gap: 0, width: 1 });
  assert.equal(none, " ", "nothing is drawn when not even one glyph fits");

  // An empty label takes no room and does not push its neighbours.
  const empty = categoryRow(["", "x"], { groupWidth: 4, gap: 1, width: 20 });
  assert.equal(empty.indexOf("x"), 6, "the next label keeps its own slot");
  assert.equal(empty.trim(), "x");

  // A missing label is empty, not the word null.
  assert.equal(categoryRow([null, "x"], { groupWidth: 4, gap: 1, width: 20 }), empty);

  // The slot starts inside the row, but centring its label would start outside.
  const overflow = categoryRow(["a", "b", "c", "x"], { groupWidth: 3, gap: 0, width: 10 });
  assert.equal(overflow, " a  b  c  ", "the last label has nowhere to start");
});

check("point labels thin out instead of colliding", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const layout = pointLabelLayout(months, 30);
  assert.equal(cols(layout.text), 30, "the row is the chart width");
  assert.equal(layout.dropped, 6, "half the labels make room for the other half");
  for (const shown of ["Jan", "Mar", "May", "Jul", "Sep", "Nov"]) {
    assert.ok(layout.text.includes(shown), `${shown} is kept`);
  }
  for (const hidden of ["Feb", "Apr", "Jun", "Aug", "Oct", "Dec"]) {
    assert.ok(!layout.text.includes(hidden), `${hidden} is dropped whole, not cut`);
  }
  // No two labels run together: a shown label always has a blank beside it.
  const cells = cellsOf(layout.text);
  for (const shown of ["Jan", "Mar", "May", "Jul", "Sep", "Nov"]) {
    const at = layout.text.indexOf(shown);
    assert.ok(at === 0 || cells[at - 1] === " ", `${shown} has a gap before it`);
    assert.ok(at + 3 >= 30 || cells[at + 3] === " ", `${shown} has a gap after it`);
  }
});

check("point labels centre on their marks, or spread evenly", () => {
  const placed = pointLabelLayout(["a", "bb", "ccc"], 24, [2, 10, 20]);
  assert.equal(placed.text.indexOf("a"), 2, "a one-cell label sits on its point");
  assert.equal(placed.text.indexOf("bb"), 9, "a two-cell label is centred one cell left");
  assert.equal(placed.text.indexOf("ccc"), 19, "a three-cell label is centred one cell left");
  assert.equal(placed.dropped, 0);

  // With no positions the labels spread evenly, and the last one is pulled back
  // inside the row rather than dropped.
  const spread = pointLabelLayout(["a", "bb", "ccc"], 24);
  assert.equal(spread.text.indexOf("a"), 0, "the first label starts at the left edge");
  assert.equal(spread.text.indexOf("ccc") + 3, 24, "the last label ends at the right edge");
  assert.equal(spread.dropped, 0);

  // A position that is not a number falls back to the even spread.
  const fallback = pointLabelLayout(["a", "bb", "ccc"], 24, [NaN, undefined, 20]);
  assert.equal(fallback.text.indexOf("a"), 0, "a missing first position is spread, not skipped");

  // Nothing to print is dropped, not printed as the word null.
  const missing = pointLabelLayout([null, "a"], 6);
  assert.equal(missing.dropped, 1, "a null label takes no room");
  assert.equal(missing.text.trim(), "a", "and the label beside it still shows");
});

check("a label wider than the row is dropped, not cut", () => {
  const tooWide = pointLabelLayout(["設計"], 3);
  assert.equal(tooWide.dropped, 1, "four cells of glyph do not fit three columns");
  assert.equal(tooWide.text, "   ", "and nothing is drawn");
  const fits = pointLabelLayout(["設計"], 6);
  assert.equal(fits.text, "設計  ", "the whole label is kept when it fits");
  assert.equal(cols(fits.text), 6);

  // A zero-width mark rides on the cell before it, so the row keeps its width
  // and the label keeps its letters.
  const marked = pointLabelLayout(["a\u200bb"], 4);
  assert.equal(marked.text, "a\u200bb  ", "the mark is attached, not given a cell");
  assert.equal(cols(marked.text), 4, "the row is still four cells wide");
  assert.equal(marked.text.length, 5, "the free cell stays free, so the string is longer than its width");
});

check("the shift rule moves a label right by two, or drops it", () => {
  const labels = ["aaaa", "bbbb", "cccc"];
  const shifted = pointLabelLayout(labels, 10, [0, 0, 0], { shift: true });
  assert.equal(shifted.text, "aaaa bbbb ", "the second label moves to lastEnd + 2");
  assert.equal(shifted.text.indexOf("bbbb"), 5);
  assert.equal(cellsOf(shifted.text)[4], " ", "exactly one blank separates the two");
  assert.ok(!shifted.text.includes("cccc"), "the third has no room and is dropped");
  assert.equal(shifted.dropped, 1, "one label is counted as dropped");
  assert.equal(cols(shifted.text), 10, "the shift never leaves the row");

  // Without the option the second label is simply lost.
  const plain = pointLabelLayout(labels, 10, [0, 0, 0]);
  assert.equal(plain.text, "aaaa      ");
  assert.equal(plain.dropped, 2, "the collided label and the one behind it");

  // Only the boolean true opts in: a truthy value is not the rule.
  assert.deepEqual(pointLabelLayout(labels, 10, [0, 0, 0], { shift: 1 }), plain);
});

check("dropped counts every label the row could not show", () => {
  const mixed = pointLabelLayout(["", "ok", "toolong", "x"], 8);
  assert.equal(mixed.text, " ok    x", "the two that fit are drawn in place");
  assert.equal(mixed.dropped, 2, "the empty label and the too-wide one are counted");

  for (const [labels, width] of [[["a", "b", "c"], 1], [["", "", ""], 4], [["ab", "cd", "ef"], 3]]) {
    const layout = pointLabelLayout(labels, width);
    const shown = labels.filter((label) => label !== "" && layout.text.includes(label)).length;
    assert.equal(shown + layout.dropped, labels.length, `${JSON.stringify(labels)} at ${width}: shown + dropped`);
  }
});

check("a label row is always the width it was asked for", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const letters = new Set("JanFebMrApyu");
  for (const width of [0, 1, 2, 5, 12, 30]) {
    const layout = pointLabelLayout(months, width);
    assert.equal(cols(layout.text), width, `point row at ${width}`);
    assert.equal(pointLabelRow(months, width), layout.text, "the plain row is the layout's text");
    // A kept label is kept whole: thinning never leaves half a name behind.
    for (const cell of cellsOf(layout.text)) {
      assert.ok(cell === " " || letters.has(cell), `only label letters and blanks: ${JSON.stringify(cell)}`);
    }
  }
});

console.log(`\n${checks}/${checks} checks passed`);
