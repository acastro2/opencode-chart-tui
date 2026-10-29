// Box plot: one distribution per label, drawn horizontally.
//
// A box plot is five numbers and a handful of dots: Q1, the median, Q3, the two
// whiskers and the points past the fences. A terminal cell is about twice as tall
// as it is wide, so a vertical box one column wide would be a sliver; one row per
// label gives the box the chart's width, which is the dimension a distribution
// needs. The row reads left to right, from the smallest sample to the largest:
//
//   ├─────█│███────┤            ●
//
// `├`/`┤` are the whisker ends, `─` the whisker, `█` the interquartile range, `│`
// the median, `●` an outlier. The axis row under the boxes carries round ticks.
//
// The whisker stops at the furthest sample still inside 1.5 x IQR of its
// quartile, so a whisker is always a real observation and never reaches past the
// data. Anything further out is an outlier and gets a dot.
//
// A group of samples with nothing readable in it is not a box, so it is left out.
// `values` holds one array per label; the value policy for this family drops what
// it cannot read, and this file reads the same policy so the footer agrees.

import { blankGrid, cellsToRuns, cols, formatNumber, stampText, titleRow, truncate } from "./core.js";
import { buildAxis } from "./axis.js";
import { layoutFor } from "./layout.js";
import { coerceList, policyFor } from "./values.js";

const BOX = "█";
const WHISKER = "─";
const MEDIAN = "│";
const LOW_CAP = "├";
const HIGH_CAP = "┤";
const OUTLIER = "●";

/** The most of a row the label gutter may take, so the plot keeps the rest. */
const LABEL_SHARE = 0.4;
/** Tukey's fence: a sample further than this many IQRs out is an outlier. */
const FENCE = 1.5;
/**
 * Ticks asked of `buildAxis`. The round ladder turns this into three to five
 * marks: the span is split into four, and the step it rounds to is never more
 * than half the gap, so the count lands between 3 and 5.
 */
const TICKS = 4;
/** The rows the axis is measured in. Only the row a tick lands on uses them. */
const TICK_ROWS = 30;

/** The value `p` of the way through a sorted sample, between two neighbours. */
function quantile(sorted, p) {
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/**
 * The five numbers of one sorted sample, plus the points past its fences.
 *
 * A whisker is the furthest sample inside 1.5 IQR of its quartile, so a whisker
 * end is always a value that was really measured. "Inside" is non-empty by
 * construction: at least half the sample lies between the quartiles.
 */
function boxSummary(sorted) {
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const reach = FENCE * (q3 - q1);
  const inside = sorted.filter((value) => value >= q1 - reach && value <= q3 + reach);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    median,
    q3,
    whiskerLow: inside[0],
    whiskerHigh: inside[inside.length - 1],
    outliers: sorted.filter((value) => value < inside[0] || value > inside[inside.length - 1]),
  };
}

/**
 * One box per label that has at least one readable sample. The index is the
 * group's position in the fence, so a group dropped for having no samples does
 * not repaint the boxes after it.
 */
export function normalizeBoxes(spec) {
  const policy = policyFor("box");
  const labels = Array.isArray(spec?.labels) ? spec.labels : [];
  const groups = Array.isArray(spec?.values) ? spec.values : [];
  const boxes = [];

  for (const [index, group] of groups.entries()) {
    const read = coerceList(Array.isArray(group) ? group : [], policy, { compact: true });
    if (read.values.length === 0) continue;
    const sorted = [...read.values].sort((a, b) => a - b);
    boxes.push({ label: String(labels[index] ?? index + 1), index, samples: sorted, ...boxSummary(sorted) });
  }

  return boxes;
}

/** The block's width: the fence's own, never narrower than the floor. */
function blockWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** Space for the names: their widest, at most 40% of the chart, never zero. */
function labelWidthOf(boxes, width) {
  const widest = boxes.reduce((most, box) => Math.max(most, cols(box.label)), 1);
  return Math.max(1, Math.min(widest, Math.max(4, Math.floor(width * LABEL_SHARE))));
}

/** The columns the plot may use: the row less the label gutter and its space. */
function plotOf(width, labelWidth) {
  return { start: Math.min(width - 1, labelWidth + 1), end: width - 1 };
}

/** The smallest and largest sample the chart will place. */
function extentOf(boxes) {
  return boxes.reduce(
    (ends, box) => ({ low: Math.min(ends.low, box.min), high: Math.max(ends.high, box.max) }),
    { low: Infinity, high: -Infinity },
  );
}

/** The bound the axis answered, or the data's own when the axis could not. */
function boundOf(answered, own) {
  return Number.isFinite(answered) ? answered : own;
}

/** A range that is never empty, so every value still maps to a column. */
function widen(low, high) {
  return high > low ? high : low + 1;
}

/**
 * The round axis over every sample, and the value range its bounds describe.
 * The bounds cover the data, so the range is what maps a value to a column; the
 * fallback is for an axis that cannot answer (a degenerate float range).
 */
function frameOf(boxes) {
  const ends = extentOf(boxes);
  const axis = buildAxis({ min: ends.low, max: ends.high, plotRows: TICK_ROWS, ticks: TICKS, zero: false });
  const low = boundOf(axis.bottom, ends.low);
  const high = boundOf(axis.top, ends.high);
  return { axis, scale: { low, high: widen(low, high) } };
}

/** The label gutter, the plot columns, and the value range they draw in. */
function geometryOf(boxes, width, scale) {
  const labelWidth = labelWidthOf(boxes, width);
  return { width, labelWidth, plot: plotOf(width, labelWidth), scale };
}

/** The column a value sits in, clamped to the plot. */
function columnOf(value, geometry) {
  const { scale, plot } = geometry;
  const span = scale.high - scale.low;
  const across = span > 0 ? (value - scale.low) / span : 0;
  return plot.start + Math.round(Math.max(0, Math.min(1, across)) * (plot.end - plot.start));
}

/** Write one cell of a row; the cell's kind is what `theme.js` colours it by. */
function put(row, column, char, kind, slice) {
  if (column >= 0 && column < row.length) row[column] = { char, kind, slice };
}

/** The whisker line and its two caps. The box is painted over the middle later. */
function drawWhisker(row, box, geometry) {
  const low = columnOf(box.whiskerLow, geometry);
  const high = columnOf(box.whiskerHigh, geometry);
  for (let column = low; column <= high; column += 1) put(row, column, WHISKER, "axis", -1);
  put(row, low, LOW_CAP, "axis", -1);
  put(row, high, HIGH_CAP, "axis", -1);
}

/**
 * One box in one row, in draw order: whisker, box, median, outliers. The median
 * is a `line` run, which the theme draws as a cut through the box's colour, so it
 * reads as a notch rather than a second block. A box one cell wide keeps its
 * block, because there is no cell inside it for the median.
 */
function drawBox(row, box, geometry) {
  const left = columnOf(box.q1, geometry);
  const right = columnOf(box.q3, geometry);
  drawWhisker(row, box, geometry);
  for (let column = left; column <= right; column += 1) put(row, column, BOX, "fill", box.index);
  if (right > left) put(row, columnOf(box.median, geometry), MEDIAN, "line", box.index);
  for (const value of box.outliers) put(row, columnOf(value, geometry), OUTLIER, "target", -1);
}

/** The label, right-aligned in the gutter so every plot starts in one column. */
function stampLabel(grid, y, box, labelWidth) {
  const text = truncate(box.label, labelWidth);
  stampText(grid, Math.max(0, labelWidth - cols(text)), y, text, { kind: "axis", slice: -1 });
}

/** One row per box: the label, then the summary in the plot. */
function boxRowsOf(boxes, geometry) {
  const grid = blankGrid(geometry.width, boxes.length);
  for (const [y, box] of boxes.entries()) {
    stampLabel(grid, y, box, geometry.labelWidth);
    drawBox(grid[y], box, geometry);
  }
  return grid.map((cells) => ({ width: geometry.width, runs: cellsToRuns(cells) }));
}

/** One tick, centred on its column, unless it would touch the previous one. */
function placeTick(state, value) {
  const text = formatNumber(value);
  const width = cols(text);
  if (width > state.geometry.plot.end - state.geometry.plot.start + 1) return;
  const column = columnOf(value, state.geometry);
  const room = state.geometry.plot.end - width + 1;
  const at = Math.max(state.geometry.plot.start, Math.min(column - Math.floor(width / 2), room));
  // One blank cell between two labels, or "20" and "30" read as "2030".
  if (at <= state.lastEnd + 1) return;
  stampText(state.grid, at, 0, text, { kind: "axis", slice: -1 });
  state.lastEnd = at + width - 1;
}

/**
 * The axis row: the ticks `buildAxis` chose, under the columns they name.
 * `buildAxis` answers top to bottom, because a vertical axis reads downward;
 * a horizontal row is placed left to right, so the marks are sorted by value
 * first. Placing them in row order would let the rightmost tick claim the row
 * and drop every tick to its left.
 */
function axisRowOf(axis, geometry) {
  const grid = blankGrid(geometry.width, 1);
  const state = { grid, geometry, lastEnd: geometry.plot.start - 2 };
  const marks = [...axis.ticks].sort((a, b) => a.value - b.value);
  for (const mark of marks) placeTick(state, mark.value);
  return { width: geometry.width, runs: cellsToRuns(grid[0]) };
}

/** A row of muted text: a note, or the sentence that stands in for a chart. */
function noteRow(width, text) {
  return { width, runs: [{ text: `  ${truncate(text, Math.max(1, width - 2))}`, slice: -1, kind: "legend" }] };
}

/** Nothing to draw: the title still prints, then the one row that says why. */
function emptyRows(spec, width) {
  const title = spec.title ? [titleRow(String(spec.title), width)] : [];
  return [...title, noteRow(width, "no data")];
}

/** The count of boxes left out, in the longest form the row has room for. */
function hiddenText(width, hidden) {
  const count = `${hidden} ${hidden === 1 ? "box" : "boxes"}`;
  const text = `${count} hidden`;
  return cols(text) <= width - 2 ? text : `${hidden} hidden`;
}

/** How many drawn marks the frame had to squeeze to its edge. */
function frameOverflow(boxes, scale) {
  const outside = (value) => value < scale.low || value > scale.high;
  let count = 0;
  for (const box of boxes) {
    const marks = [box.whiskerLow, box.median, box.whiskerHigh, ...box.outliers];
    count += marks.filter(outside).length;
  }
  return count;
}

/** The ledger: the title, the axis row and the notes come out of `height` first. */
function ledgerOf(spec, count, notes) {
  return layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: 1,
    notes,
    fallback: count,
    min: 3,
    max: 30,
  });
}

/**
 * The plot rows the block can spend. The first pass learns that some boxes do not
 * fit; the note that says so is a row, so a declared height pays for it out of
 * the same ledger instead of growing the block. Without a declared height there
 * is no budget to keep, and the note simply prints.
 */
function ledgerFor(spec, count, notes) {
  const first = ledgerOf(spec, count, notes);
  if (count <= first.plotRows || !(Number(spec.height) > 0)) return first;
  return ledgerOf(spec, count, notes + 1);
}

/** The rows a box-plot fence prints: title, boxes, axis, notes. */
export function renderBoxRows(spec = {}) {
  const width = blockWidth(spec);
  const boxes = normalizeBoxes(spec);
  if (boxes.length === 0) return emptyRows(spec, width);

  const frame = frameOf(boxes);
  const geometry = geometryOf(boxes, width, frame.scale);
  const overflow = frameOverflow(boxes, frame.scale);
  const ledger = ledgerFor(spec, boxes.length, overflow > 0 ? 1 : 0);
  const drawn = boxes.slice(0, Math.min(boxes.length, ledger.plotRows));
  const hidden = boxes.length - drawn.length;

  return [
    ...(spec.title ? [titleRow(String(spec.title), width)] : []),
    ...boxRowsOf(drawn, geometry),
    axisRowOf(frame.axis, geometry),
    ...(overflow > 0 ? [noteRow(width, `${overflow} ${overflow === 1 ? "value" : "values"} clamped`)] : []),
    ...(hidden > 0 ? [noteRow(width, hiddenText(width, hidden))] : []),
  ];
}
