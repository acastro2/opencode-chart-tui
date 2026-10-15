// The axis and the plot frame shared by bar, line, area, scatter, histogram and
// candlestick charts.
//
// A terminal chart has very little room for numbers, so the scale lands on round
// values: both ends are multiples of a step of 1, 2 or 5 times a power of ten,
// and a tick only earns a row when it does not collide with another tick.
//
// Zero is always inside the range. A chart of differences, profit and loss, or
// variance has to be able to go below the line, so the zero row is a first class
// citizen: bars grow away from it in both directions and it carries the axis.

import { cols, formatNumber } from "./core.js";

/** The next round number at or above the value: 87 -> 100, 230 -> 250, 810 -> 1000. */
export function niceMax(value) {
  const size = Math.abs(Number(value) || 0);
  if (size <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(size));
  const scaled = size / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Round bounds covering [min, max], always including zero, in about `ticks`
 * steps. Returns the step as well, so ticks can be exact multiples of it.
 */
export function niceBounds(min, max, ticks = 4, zero = true) {
  const low = zero ? Math.min(0, Number(min) || 0) : Number(min) || 0;
  const high = zero ? Math.max(0, Number(max) || 0) : Number(max) || 0;
  if (zero && low === 0 && high === 0) return { low: 0, high: 1, step: 0.25 };
  if (low === high) {
    // A flat series still needs a range to draw in, and without zero the range
    // has to come from the value itself.
    const pad = Math.max(Math.abs(low) * 0.01, 0.5);
    return niceBounds(low - pad, high + pad, ticks, false);
  }

  const rough = (high - low) / Math.max(1, ticks);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / magnitude;
  const step = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * magnitude;
  return {
    low: Math.floor(low / step) * step,
    high: Math.ceil(high / step) * step,
    step,
  };
}

/**
 * A vertical scale with round ticks and a zero row inside it.
 *
 * @returns {{top: number, bottom: number, zeroRow: number, plotRows: number, height: number, ticks: {value: number, row: number, label: string}[], rowOf: (value: number) => number, gutter: number}}
 *   `height` is the number of data rows and equals `plotRows`: the axis line is
 *   drawn on the zero row, which is also a data row, so nothing is wasted.
 */
export function buildAxis({ min = 0, max, plotRows, ticks = 4, zero = true }) {
  const rows = Math.max(3, Math.floor(plotRows));
  const { low, high, step } = niceBounds(min, max, ticks, zero);
  const span = high - low || 1;
  // The cell is the unit, not the gap between two cell centres: a row covers its
  // own box, so a bar at the top of the axis fills the first row completely
  // instead of only its lower half.
  const unit = span / rows;

  const rowOf = (value) => {
    const clamped = Math.max(low, Math.min(Number(value) || 0, high));
    return Math.max(0, Math.min(rows - 1, Math.floor((high - clamped) / unit)));
  };

  const marks = [];
  const count = Math.round(span / step);
  for (let index = 0; index <= count; index++) {
    const value = low + index * step;
    marks.push({ value: Number(value.toFixed(10)), row: rowOf(value), label: formatNumber(value) });
  }

  // One tick per row. Zero goes first so the axis line keeps its label, then the
  // rest from the bottom up.
  const taken = new Map();
  for (const mark of [...marks].sort((a, b) => (a.value === 0 ? -1 : b.value === 0 ? 1 : a.value - b.value))) {
    if (!taken.has(mark.row)) taken.set(mark.row, mark);
  }
  const kept = [...taken.values()].sort((a, b) => a.row - b.row);
  const labelWidth = Math.max(...kept.map((mark) => cols(mark.label)), 1);

  return {
    top: high,
    bottom: low,
    zeroRow: low <= 0 && high >= 0 ? rowOf(0) : -1,
    plotRows: rows,
    height: rows,
    unit,
    ticks: kept.map((mark) => ({ ...mark, label: mark.label.padStart(labelWidth) })),
    rowOf,
    // The space the gutter really takes: the tick text plus its mark. One cell,
    // not two, or every bar shifts right and the chart can overflow its width.
    gutter: labelWidth + 1,
  };
}

/** The value at a continuous row coordinate, so a cell can be sampled. */
export function valueAtRow(axis, y) {
  return axis.bottom + (1 - y / Math.max(1, axis.plotRows)) * (axis.top - axis.bottom);
}

/**
 * The sub-row index a value falls in, for a plot drawn in a grid of `subRows`
 * sub-rows. Sub-row 0 is the top of the plot, so a value at the top of the axis
 * lands in the first sub-row rather than half a cell below it.
 */
export function subRowOf(axis, value, subRows) {
  const span = axis.top - axis.bottom || 1;
  const clamped = Math.max(axis.bottom, Math.min(Number(value) || 0, axis.top));
  return Math.max(0, Math.min(subRows - 1, Math.floor(((axis.top - clamped) / span) * subRows)));
}

/** The value a sub-row covers, for a plot drawn in a grid of `subRows` sub-rows. */
export function subRowValue(axis, subRow, subRows) {
  // valueAtRow takes cell units, so a sub-row is divided by how many sub-rows a
  // cell has. Dividing by subRows itself would scale the value twice and leave
  // the whole plot inside the top of the axis.
  const rowsPerCell = subRows / Math.max(1, axis.plotRows);
  return valueAtRow(axis, subRow / Math.max(1e-6, rowsPerCell));
}

/** The gutter text and mark for one data row: a tick, or a plain axis line. */
export function axisRow(axis, row) {
  const tick = axis.ticks.find((mark) => mark.row === row);
  return {
    text: (tick?.label ?? "").padStart(axis.gutter - 1),
    mark: tick ? "┤" : "│",
    tick: Boolean(tick),
  };
}

/** The zero row: the label of its tick joined to the horizontal axis. */
export function baseline(axis, axisWidth) {
  const tick = axis.ticks.find((mark) => mark.row === axis.zeroRow);
  const width = Math.max(1, axis.gutter - 1);
  return {
    text: (tick?.label ?? "0").padStart(width),
    mark: "┼",
    line: "─".repeat(Math.max(0, axisWidth)),
  };
}

/**
 * Labels under data points (a line, a candle) rather than under slots (a bar).
 * Each label is centred on its point and dropped when the previous one is still
 * on screen, so a narrow chart thins its labels instead of cutting them down to
 * one letter, which is what a slot-based row would do.
 */
export function pointLabelRow(labels, columns, positions = null) {
  const cells = [];
  let lastEnd = -2;

  for (const [index, text] of labels.entries()) {
    // A slot family (bars, candles, waterfall steps) tells us where its centre
    // is; otherwise the points are spread evenly across the row.
    const centre =
      Array.isArray(positions) && Number.isFinite(positions[index])
        ? positions[index]
        : ((columns - 1) * index) / Math.max(1, labels.length - 1);
    const at = Math.max(0, Math.round(centre) - Math.floor(cols(text) / 2));
    if (at <= lastEnd + 1) continue;
    // The label is already the whole label: a point label is thinned, never cut.
    const value = String(text);
    if (at + cols(value) > columns) continue;
    let cursor = at;
    while (cells.length < cursor) cells.push(" ");
    for (const char of value) cells[cursor++] = char;
    lastEnd = cursor - 1;
  }

  // Slicing the array of code points, not the string, so a wide glyph is never
  // cut in half.
  return cells.slice(0, Math.max(0, columns)).join("");
}

/**
 * Category labels under the bars, thinned so they never collide. A label keeps
 * its slot only when it fits the slot and does not run into the previous one.
 */
export function categoryRow(labels, { groupWidth, gap, width, slotOffset = 0 }) {
  const cells = [];
  let lastEnd = -2;

  for (const [index, raw] of labels.entries()) {
    const start = index * (groupWidth + gap) + slotOffset;
    if (start <= lastEnd + 1) continue;
    const text = String(raw).slice(0, Math.max(1, groupWidth));
    if (!text) continue;
    const at = start + Math.max(0, Math.floor((groupWidth - cols(text)) / 2));
    while (cells.length < at) cells.push(" ");
    let cursor = at;
    for (const char of text) cells[cursor++] = char;
    lastEnd = cursor - 1;
  }

  return cells.join("").slice(0, Math.max(0, width));
}
