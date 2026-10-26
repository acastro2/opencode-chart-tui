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
import { graphemeWidth, graphemes, sliceByWidth } from "./text.js";

// The ladder a scaled value rounds up to. `roundStep` walks it in order, so the
// first bound at or above the value wins and anything larger is a full decade.
const ROUND_STEPS = [
  { limit: 1, step: 1 },
  { limit: 2, step: 2 },
  { limit: 2.5, step: 2.5 },
  { limit: 5, step: 5 },
];

/** The round step for a scaled value: 0.8 -> 1, 3 -> 5, 7 -> 10. */
function roundStep(scaled) {
  const found = ROUND_STEPS.find((entry) => scaled <= entry.limit);
  return found ? found.step : 10;
}

/** The next round number at or above the value: 87 -> 100, 230 -> 250, 810 -> 1000. */
export function niceMax(value) {
  const size = Math.abs(Number(value) || 0);
  if (size <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(size));
  return roundStep(size / magnitude) * magnitude;
}

/** The range's ends, with zero pulled in when a zero row is wanted. */
function spanEnds(min, max, zero) {
  const low = Number(min) || 0;
  const high = Number(max) || 0;
  if (!zero) return { low, high };
  return { low: Math.min(0, low), high: Math.max(0, high) };
}

/** A flat series still needs a range to draw in. */
function padRange(value) {
  const pad = Math.max(Math.abs(value) * 0.01, 0.5);
  return { low: value - pad, high: value + pad };
}

/** The step for a rough gap: the round ladder value times its magnitude. */
function stepFor(rough) {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return roundStep(rough / magnitude) * magnitude;
}

/** An empty chart: zero and only zero, with nowhere to go. */
function isZeroSpan(low, high, zero) {
  return zero && low === 0 && high === 0;
}

/**
 * Round bounds covering [min, max], always including zero, in about `ticks`
 * steps. Returns the step as well, so ticks can be exact multiples of it.
 */
export function niceBounds(min, max, ticks = 4, zero = true) {
  const { low, high } = spanEnds(min, max, zero);
  if (isZeroSpan(low, high, zero)) return { low: 0, high: 1, step: 0.25 };
  if (low === high) {
    // Without zero the range has to come from the value itself.
    const padded = padRange(low);
    return niceBounds(padded.low, padded.high, ticks, false);
  }
  const step = stepFor((high - low) / Math.max(1, ticks));
  return {
    low: Math.floor(low / step) * step,
    high: Math.ceil(high / step) * step,
    step,
  };
}

/** A value clamped to the axis, so a bar cannot grow outside its plot. */
function clampToAxis(value, low, high) {
  return Math.max(low, Math.min(Number(value) || 0, high));
}

/** The cell height of one unit and the row a value lands on. */
function rowLookup(low, high, rows) {
  // The cell is the unit, not the gap between two cell centres: a row covers its
  // own box, so a bar at the top of the axis fills the first row completely
  // instead of only its lower half.
  const unit = (high - low || 1) / rows;
  return {
    unit,
    rowOf: (value) => Math.max(0, Math.min(rows - 1, Math.floor((high - clampToAxis(value, low, high)) / unit))),
  };
}

/** One mark per step across the range, with the row it lands on. */
function axisMarks(low, span, step, rowOf) {
  const count = Math.round(span / step);
  const marks = [];
  for (let index = 0; index <= count; index++) {
    const value = low + index * step;
    marks.push({ value: Number(value.toFixed(10)), row: rowOf(value), label: formatNumber(value) });
  }
  return marks;
}

/** Zero first, then by value, so a shared row keeps the zero tick. */
function zeroFirst(a, b) {
  if (a.value === 0) return -1;
  if (b.value === 0) return 1;
  return a.value - b.value;
}

/** One tick per row; the first mark in order wins a row two marks share. */
function oneTickPerRow(marks) {
  const taken = new Map();
  for (const mark of [...marks].sort(zeroFirst)) {
    if (!taken.has(mark.row)) taken.set(mark.row, mark);
  }
  return [...taken.values()].sort((a, b) => a.row - b.row);
}

/** The row of the zero crossing, or -1 when the range does not cross zero. */
function zeroRowOf(low, high, rowOf) {
  return low <= 0 && high >= 0 ? rowOf(0) : -1;
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
  const { unit, rowOf } = rowLookup(low, high, rows);
  const kept = oneTickPerRow(axisMarks(low, high - low || 1, step, rowOf));
  const labelWidth = Math.max(...kept.map((mark) => cols(mark.label)), 1);

  return {
    top: high,
    bottom: low,
    zeroRow: zeroRowOf(low, high, rowOf),
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

/** The centre column of a label: where the caller put it, or evenly spread. */
function labelCentre(index, count, limit, positions) {
  if (Array.isArray(positions) && Number.isFinite(positions[index])) return positions[index];
  return ((limit - 1) * index) / Math.max(1, count - 1);
}

/** A label's left edge: centred on its mark, pulled back inside the row. */
function centredAt(centre, width, limit) {
  const at = Math.max(0, Math.round(centre) - Math.floor(width / 2));
  return Math.min(at, Math.max(0, limit - width));
}

/** The shifted start that clears the previous label, or -1 when it cannot. */
function shiftedTo(lastEnd, width, limit) {
  return lastEnd + 2 + width <= limit ? lastEnd + 2 : -1;
}

/** The start column that clears the previous label, or -1 when it collides. */
function clearOf(at, width, lastEnd, limit, shift) {
  if (at > lastEnd + 1) return at;
  return shift ? shiftedTo(lastEnd, width, limit) : -1;
}

/** The start column for a label, or -1 when it cannot be shown. */
function placeLabel({ index, count, limit, positions, width, lastEnd, shift }) {
  if (width === 0 || width > limit) return -1;
  const at = centredAt(labelCentre(index, count, limit, positions), width, limit);
  return clearOf(at, width, lastEnd, limit, shift);
}

/**
 * Labels under data points (a line, a candle) rather than under slots (a bar).
 * Each label is centred on its point and dropped when the previous one is still
 * on screen, so a narrow chart thins its labels instead of cutting them down to
 * one letter, which is what a slot-based row would do.
 */
export function pointLabelLayout(labels, columns, positions = null, options = {}) {
  const limit = Math.max(0, Math.floor(columns));
  const cells = [];
  let lastEnd = -2;
  let dropped = 0;

  for (const [index, text] of labels.entries()) {
    const value = String(text ?? "");
    const width = cols(value);
    const at = placeLabel({
      index,
      count: labels.length,
      limit,
      positions,
      width,
      lastEnd,
      shift: options.shift === true,
    });
    if (at < 0) {
      dropped += 1;
      continue;
    }
    writeAt(cells, at, value, limit);
    lastEnd = at + width - 1;
  }

  return { text: paddedRow(cells, limit).join(""), dropped };
}

/** The plain label row; the layout carries the dropped count when it matters. */
export function pointLabelRow(labels, columns, positions = null, options = {}) {
  return pointLabelLayout(labels, columns, positions, options).text;
}

/** A zero-width mark hangs off the cell before the label start. */
function attachMark(cells, cursor, at, grapheme) {
  if (cursor > at) cells[cursor - 1] += grapheme;
  return cursor;
}

/** Where the cursor lands after one grapheme, or -1 when it crosses the edge. */
function advance(cells, cursor, at, grapheme, width, limit) {
  if (width === 0) return attachMark(cells, cursor, at, grapheme);
  if (cursor + width > limit) return -1;
  cells[cursor] = grapheme;
  if (width === 2) cells[cursor + 1] = "";
  return cursor + width;
}

/** Write one label into a row of cell strings, leaving a gap after a wide glyph. */
function writeAt(cells, at, value, limit) {
  while (cells.length < at) cells.push(" ");
  let cursor = at;
  for (const grapheme of graphemes(value)) {
    const next = advance(cells, cursor, at, grapheme, graphemeWidth(grapheme), limit);
    if (next < 0) break;
    cursor = next;
  }
  return cursor;
}

/** A cell row padded to the full width, still as cells. */
function paddedRow(cells, limit) {
  while (cells.length < limit) cells.push(" ");
  return cells.slice(0, limit);
}

/** The first column of a category slot. */
function slotStart(index, { groupWidth, gap, slotOffset }) {
  return index * (groupWidth + gap) + slotOffset;
}

/** A slot is free when it starts after the previous label and inside the row. */
function slotFree(start, limit, lastEnd) {
  return start > lastEnd + 1 && start < limit;
}

/** A label cut to its slot in cells, not UTF-16 units and not code points. */
function slotText(raw, groupWidth) {
  return sliceByWidth(String(raw ?? ""), Math.max(1, groupWidth));
}

/** The centred label for one slot, clipped at the row's edge, or null. */
function fitCategory(text, start, { groupWidth, limit }) {
  const width = cols(text);
  const at = start + Math.max(0, Math.floor((groupWidth - width) / 2));
  if (at >= limit) return null;
  if (at + width <= limit) return { text, at };
  const cut = sliceByWidth(text, limit - at);
  return cut ? { text: cut, at } : null;
}

/** The label and start column for one slot, or null when it cannot be shown. */
function placeCategoryLabel(raw, index, slot) {
  const start = slotStart(index, slot);
  if (!slotFree(start, slot.limit, slot.lastEnd)) return null;
  const text = slotText(raw, slot.groupWidth);
  if (!text) return null;
  return fitCategory(text, start, slot);
}

/**
 * Category labels under the bars, thinned so they never collide. A label keeps
 * its slot only when it fits the slot and does not run into the previous one.
 */
export function categoryRow(labels, { groupWidth, gap, width, slotOffset = 0 }) {
  const limit = Math.max(0, Math.floor(width));
  const slot = { groupWidth, gap, limit, slotOffset, lastEnd: -2 };
  const cells = [];

  for (const [index, raw] of labels.entries()) {
    const placed = placeCategoryLabel(raw, index, slot);
    if (!placed) continue;
    writeAt(cells, placed.at, placed.text, limit);
    slot.lastEnd = placed.at + cols(placed.text) - 1;
  }

  return paddedRow(cells, limit).join("");
}
