// Combo: grouped bars and a line in one frame, on one shared value scale.
//
// Why one scale: a Pareto or an actual-vs-trend compares a count with a curve,
// and a second right-hand axis can be stretched until any two series agree. One
// scale from zero keeps the comparison honest, even when the line is small next
// to the bars.
//
// Bars are sampled by value, like `bar.js`: every sub-cell of a column is
// translated back into a value and kept when the bar reaches it, so a column can
// end part-way through a cell instead of rounding to a whole row. The line is
// painted after the bars at sub-cell resolution, so a shallow slope is a
// diagonal band rather than a staircase, with a `●` at every data column. The
// marker owns its cell, and that includes a bar's only visible top cell: the
// point is what the line is for, and a marker hidden behind a column is a
// marker the reader cannot place.

import {
  BLANK,
  cellsToRuns,
  cols,
  legendRowRuns,
  makeSampler,
  paintCell,
  titleRow,
  truncate,
} from "./core.js";
import { axisRow, baseline, buildAxis, pointLabelRow, subRowOf, valueAtRow } from "./axis.js";
import { layoutFor } from "./layout.js";
import { coerceList, policyFor } from "./values.js";

/** The only two series kinds a combo knows. Anything else is not drawn. */
const PLOT_TYPES = new Set(["bar", "line"]);

/** A run of axis furniture: tick text, the axis line, or the blank gutter. */
function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

/** The width to draw at: the fence's own, a sane default when it is unreadable. */
function widthOf(spec) {
  const given = Number(spec.width);
  return Number.isFinite(given) && given > 0 ? Math.max(16, Math.floor(given)) : 48;
}

// --- reading the fence -----------------------------------------------------

/**
 * One series entry, or null when it cannot be drawn. A bare array has no
 * `type`, so it cannot take part in a bar-and-line mix; a series with no values
 * has nothing to place. Both are dropped instead of guessed at.
 */
function readPlotType(item) {
  const type = String(item?.type ?? "").toLowerCase();
  return PLOT_TYPES.has(type) ? type : null;
}

function readSeries(item, policy, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const type = readPlotType(item);
  if (type === null) return null;
  const { values } = coerceList(item.values, policy);
  if (values.length === 0) return null;
  return { name: item.name == null ? `series ${index + 1}` : String(item.name), type, values };
}

function readSeriesList(spec) {
  const policy = policyFor("combo");
  const raw = Array.isArray(spec.series) ? spec.series : [];
  return raw.map((item, index) => readSeries(item, policy, index)).filter(Boolean);
}

/** The number of points every series and the label row must cover. */
function comboLength(series, spec) {
  const longest = series.reduce((most, item) => Math.max(most, item.values.length), 0);
  return Math.max(longest, Array.isArray(spec.labels) ? spec.labels.length : 0);
}

/** A short series still gets a cell under every label: zero is where it has none. */
function padSeries(series, length) {
  for (const item of series) while (item.values.length < length) item.values.push(0);
}

/** Labels as text; a missing one becomes its 1-based position, as in core. */
function comboLabels(spec, length) {
  const given = Array.isArray(spec.labels) ? spec.labels : [];
  return Array.from({ length }, (_, index) => String(given[index] ?? index + 1));
}

/**
 * The series, labels and bar count to draw, or the one-line reason there are
 * none. Every value is read under the combo policy (zero/zero), so the bars, the
 * line and the footer all agree about what a blank cell means.
 */
function readCombo(spec) {
  const read = readSeriesList(spec);
  if (read.length === 0) return { reason: "no bar or line series" };
  const length = comboLength(read, spec);
  padSeries(read, length);
  const bars = read.filter((item) => item.type === "bar").length;
  if (bars === 0) return { reason: "needs one bar series" };
  if (bars === read.length) return { reason: "needs one line series" };
  const series = read.map((item, index) => ({ ...item, slice: index }));
  return { series, labels: comboLabels(spec, length), bars };
}

// --- geometry --------------------------------------------------------------

/** The most blank columns between two groups, so a two-label chart stays a chart. */
const MAX_GAP = 12;
/** A bar is three cells wide: one column reads as a stick, not a bar. */
const BAR_WIDTH = 3;

/**
 * One group per label: one column per bar series, and the groups spread over the
 * width when every label fits. Spreading is what gives a label row room: at one
 * column per series, packing the groups together leaves the chart in the left
 * fifth of the frame and the names overlap, so half of them are dropped.
 *
 * A gap never grows past `MAX_GAP`, so a two-label chart stays a chart instead
 * of two bars at opposite edges. When even the tight groups do not fit, the
 * trailing labels are dropped and counted, never drawn past the width.
 *
 * `mid` is the column of the line's point inside a group: the centre, rounded
 * left when a group has an even number of columns.
 */
function planCombo(labels, bars, available) {
  const margin = labels.length > 1 ? 1 : 0;
  const tight = bars + margin;
  if (labels.length * tight - margin <= available) {
    const spread = Math.floor(available / labels.length);
    const step = Math.max(tight, Math.min(spread, bars + MAX_GAP));
    return { bars, step, visible: labels.length, hidden: 0, mid: Math.floor((bars - 1) / 2) };
  }
  const visible = Math.max(1, Math.min(labels.length, Math.floor(available / bars)));
  return { bars, step: bars, visible, hidden: labels.length - visible, mid: Math.floor((bars - 1) / 2) };
}

// --- bars ------------------------------------------------------------------

/** True when a sampled value is inside a bar that rises from zero. */
function insideBar(value, sample) {
  return sample >= 0 && sample < value;
}

/**
 * One cell of one bar column, or null when the bar does not reach it. The
 * sub-rows are sampled from the cell's own top edge, like `bar.js`: the shared
 * sampler's sub-cell offsets are centred on the cell, which would shift every
 * bar half a row against `valueAtRow`.
 */
function barCell(sampler, axis, row, value, slice) {
  if (!(value > 0)) return null;
  const { columns, rows } = sampler.shape;
  let mask = 0;
  let filled = 0;
  for (let subRow = 0; subRow < rows; subRow++) {
    const sample = valueAtRow(axis, row + (subRow + 0.5) / rows);
    if (!insideBar(value, sample)) continue;
    for (let subColumn = 0; subColumn < columns; subColumn++) mask |= 1 << (subRow * columns + subColumn);
    filled += columns;
  }
  if (filled === 0) return null;
  return paintCell({ sampler, mask, tally: new Map([[slice, filled]]), masks: new Map([[slice, mask]]) });
}

/** Paint every bar series into its own column of every visible group. */
function paintBars(cells, sampler, axis, plan, barSeries) {
  for (const [slot, item] of barSeries.entries()) {
    for (let index = 0; index < plan.visible; index++) {
      const column = index * plan.step + slot * BAR_WIDTH;
      const value = item.values[index];
      for (let row = 0; row < axis.plotRows; row++) {
        const cell = barCell(sampler, axis, row, value, item.slice);
        if (!cell) continue;
        for (let offset = 0; offset < BAR_WIDTH; offset++) cells[row][column + offset] = cell;
      }
    }
  }
}

// --- the line --------------------------------------------------------------

/** The value at a fractional label position, linear between two points. */
function valueBetween(values, position) {
  const last = values.length - 1;
  const at = Math.max(0, Math.min(last, position));
  const low = Math.floor(at);
  const high = Math.min(last, low + 1);
  return values[low] + (values[high] - values[low]) * (at - low);
}

/**
 * The one cell of a group that carries a data point: its mid column, which is
 * the column the line has always been read through.
 */
const POINT = "●";

/** True when a plot column is a group's centre, so it gets a marker. */
function isPointColumn(plan, column) {
  return (column - plan.mid) % plan.step === 0;
}

/** One bit in a cell's mask: the sub-cell at (subX, subY) inside it. */
function addBit(masks, cellX, cellY, bit) {
  const key = `${cellY}:${cellX}`;
  masks.set(key, (masks.get(key) ?? 0) | bit);
}

/**
 * The sub-cell mask of every cell the line crosses. A line is drawn at the
 * sampler's resolution, one sub-row per sub-column, and joined to the previous
 * sub-row so a rise is a diagonal band rather than a one-cell step. That is the
 * difference between a line chart and a staircase: a shallow slope still moves
 * within a row, which a cell-per-column connector cannot show.
 */
function lineMasks(axis, plan, item, sampler) {
  const { columns, rows } = sampler.shape;
  const subRows = axis.plotRows * rows;
  const firstCell = plan.mid;
  const lastCell = (plan.visible - 1) * plan.step + plan.mid;
  // Start and end at the middle of the marker cells: the data point is the
  // centre, not the cell's left edge, and the line must reach the dot.
  const first = firstCell * columns + Math.floor(columns / 2);
  const last = lastCell * columns + Math.floor(columns / 2);
  const span = Math.max(1, plan.step * columns);
  const masks = new Map();
  let previous = null;
  for (let x = first; x <= last; x++) {
    const value = valueBetween(item.values, (x - first) / span);
    const y = subRowOf(axis, value, subRows);
    const from = previous === null ? y : Math.min(previous, y);
    const to = previous === null ? y : Math.max(previous, y);
    for (let subY = from; subY <= to; subY++) {
      const bit = 1 << ((subY % rows) * columns + (x % columns));
      addBit(masks, Math.floor(x / columns), Math.floor(subY / rows), bit);
    }
    previous = y;
  }
  return masks;
}

/** Paint one line series: a sub-cell line between the markers, markers on top. */
function paintLine(cells, axis, plan, item, sampler) {
  for (const [key, mask] of lineMasks(axis, plan, item, sampler)) {
    const [row, column] = key.split(":").map(Number);
    if (isPointColumn(plan, column)) continue;
    // The line goes behind a bar; the marker in the centre still places the
    // point. Cutting a sub-cell hole in the bar would cost more than it shows.
    if (cells[row][column]) continue;
    cells[row][column] = { slice: item.slice, char: sampler.glyph(mask), kind: "fill", mask };
  }
  for (let index = 0; index < plan.visible; index++) {
    const column = index * plan.step + plan.mid;
    const row = axis.rowOf(item.values[index]);
    cells[row][column] = { slice: item.slice, char: POINT, kind: "series" };
  }
}

// --- rows ------------------------------------------------------------------

/**
 * The zero row is a data row. A bar that passes through it owns the cell, and a
 * full block there hangs half a cell below the line, so it keeps the upper half
 * the way `bar.js` does. An empty cell carries the horizontal axis line.
 */
function finishZeroRow(cells, axis, available, bars) {
  if (axis.zeroRow < 0) return;
  const row = cells[axis.zeroRow];
  for (let column = 0; column < available; column++) {
    const cell = row[column];
    if (!cell) row[column] = { slice: -1, char: "─", kind: "axis" };
    else if (cell.kind === "fill" && cell.slice < bars) row[column] = { ...cell, char: "▀" };
  }
}

/** The gutter for one plot row: a tick mark, the zero crossing, or the line. */
function gutterOf(axis, row) {
  if (row === axis.zeroRow) {
    const zero = baseline(axis, 0);
    return `${zero.text}${zero.mark}`;
  }
  const gutter = axisRow(axis, row);
  return `${gutter.text}${gutter.mark}`;
}

function plotRowsOf(cells, axis, width) {
  return cells.map((line, row) => ({
    width,
    runs: [
      axisRun(gutterOf(axis, row)),
      ...cellsToRuns(line.map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" })),
    ],
  }));
}

/**
 * The label row under the plot. A label is centred on its group, not on one of
 * its columns, so a two-series group still names the whole group. Trailing
 * labels the width cannot hold are counted in the row's own tail, so the loss is
 * said without spending a row the height ledger did not grant.
 */
function labelRowOf(axis, plan, labels, available, width) {
  const shown = labels.slice(0, plan.visible);
  const positions = shown.map((_, index) => index * plan.step + (plan.bars - 1) / 2);
  const tail = plan.hidden > 0 ? `+${plan.hidden}` : "";
  const room = available - cols(tail) - 1;
  const text =
    tail === "" || room < 1
      ? pointLabelRow(shown, available, positions)
      : `${pointLabelRow(shown, room, positions)} ${tail}`;
  return { width, runs: [axisRun(BLANK.repeat(axis.gutter)), axisRun(text)] };
}

/** One legend row per series: the marker carries the series colour. */
function legendRowsOf(spec, width, series) {
  if (spec.legend === false) return [];
  const entries = series.map((item) => ({ label: item.name, value: 0 }));
  return legendRowRuns(entries, { width, values: false });
}

function emptyRows(spec, width, reason) {
  const title = spec.title ? [titleRow(String(spec.title), width)] : [];
  return [
    ...title,
    { width, runs: [{ text: truncate("  no data", width), slice: -1, kind: "legend" }] },
    { width, runs: [{ text: truncate(`  ${reason}`, width), slice: -1, kind: "legend" }] },
  ];
}

/** The title, the plot, the label row and the legend: the whole block. */
function chartRows(spec, width, data) {
  const legend = spec.legend === false ? 0 : data.series.length;
  const ledger = layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: 1,
    legend,
    fallback: 9,
    min: 4,
    max: 30,
  });
  const axis = buildAxis({
    min: 0,
    max: Math.max(0, ...data.series.flatMap((item) => item.values)),
    plotRows: ledger.plotRows,
    ticks: spec.ticks ?? 4,
  });
  const available = Math.max(1, width - axis.gutter);
  if (available < data.bars * BAR_WIDTH) return emptyRows(spec, width, "too narrow for a bar");

  const plan = planCombo(data.labels, data.bars * BAR_WIDTH, available);
  const sampler = makeSampler(spec.mosaic);
  const cells = Array.from({ length: axis.plotRows }, () => Array.from({ length: available }, () => null));
  paintBars(cells, sampler, axis, plan, data.series.filter((item) => item.type === "bar"));
  for (const item of data.series) if (item.type === "line") paintLine(cells, axis, plan, item, sampler);
  finishZeroRow(cells, axis, available, data.bars);

  return [
    ...(spec.title ? [titleRow(String(spec.title), width)] : []),
    ...plotRowsOf(cells, axis, width),
    labelRowOf(axis, plan, data.labels, available, width),
    ...legendRowsOf(spec, width, data.series),
  ];
}

/**
 * A combo chart: grouped bars plus a line, over shared labels and one axis.
 *
 * A spec that cannot be read, or that does not mix at least one bar series with
 * at least one line series, says so instead of drawing half a chart.
 */
export function renderComboRows(spec) {
  const width = widthOf(spec);
  const data = readCombo(spec);
  return data.reason ? emptyRows(spec, width, data.reason) : chartRows(spec, width, data);
}
