// Candlesticks: one period per column, the body from open to close, the wick
// from low to high, drawn in the same sub-cell grid as every other family.
//
// Up and down periods take different colours. A candle is the one chart where a
// colour change is information rather than decoration, so the two colours are
// explicit runs rather than palette entries, and they can be overridden.
//
//   { "type": "candle", "candles": [{ "label": "Jan", "open": 100, "high": 118,
//                                    "low": 96, "close": 112 }, ...] }
//   { "type": "candle", "values": [[100, 118, 96, 112], ...] }
//
// The work is split small: reading a row, the layout, one period's box, the
// body and wick, the axis, the label row and the legend. Each piece is a pure
// function, so the drawing stays one pass over one grid.

import {
  BLANK,
  SOLID,
  cellsToRuns,
  makeSampler,
  normalizeEntries,
  padTo,
  paintCell,
  tallyFromGrid,
  titleRow,
  truncate,
} from "./core.js";
import { themeOf } from "./theme.js";
import { axisRow, baseline, buildAxis, pointLabelRow, subRowOf } from "./axis.js";
import { plotRows as plotRowsFor } from "./layout.js";

export const CANDLE_UP = "#57c98a";
export const CANDLE_DOWN = "#e5695f";

/** The rows the caller gave us. `candles` wins over `values`; neither is a list. */
function rawCandles(spec) {
  if (Array.isArray(spec.candles)) return spec.candles;
  if (Array.isArray(spec.values)) return spec.values;
  return [];
}

/** One row in either accepted shape: { open, high, low, close } or [o, h, l, c]. */
function readFields(item) {
  if (Array.isArray(item)) return { open: item[0], high: item[1], low: item[2], close: item[3] };
  return item ?? {};
}

/** A price, or NaN. `Number(null)` is 0, and a missing price is not zero. */
function priceOf(value) {
  if (value === null || value === "") return Number.NaN;
  return Number(value);
}

/** One candle from its fields, or null when any price is not a number. */
function buildCandle(row, fallbackLabel) {
  const open = priceOf(row.open);
  const high = priceOf(row.high);
  const low = priceOf(row.low);
  const close = priceOf(row.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return {
    // The high is the top and the low is the bottom, whatever the caller sent.
    label: String(row.label ?? fallbackLabel),
    open,
    close,
    high: Math.max(high, open, close, low),
    low: Math.min(low, open, close, high),
  };
}

/** Accept { label, open, high, low, close } rows or [open, high, low, close]. */
export function normalizeCandles(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const read = (item, index) => buildCandle(readFields(item), labels[index] ?? index + 1);
  return rawCandles(spec).map(read).filter((candle) => candle !== null);
}

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

/** Green up, red down, taken from the theme so a light terminal gets a darker
 * pair. `spec.up` / `spec.down` still win. */
function candleColours(spec) {
  const theme = themeOf(spec);
  return {
    up: typeof spec.up === "string" ? spec.up : theme.palette[1],
    down: typeof spec.down === "string" ? spec.down : theme.palette[3],
  };
}

/** Rows the chrome takes: the title, the axis label row, the legend, and notes. */
function chromeRows(spec, notes = 0) {
  return (spec.title ? 1 : 0) + 1 + (spec.legend !== false ? 1 : 0) + notes;
}

/** The price range the candles themselves cover. */
function candleBounds(candles) {
  return {
    min: Math.min(...candles.map((candle) => candle.low)),
    max: Math.max(...candles.map((candle) => candle.high)),
  };
}

function candleAxis(spec, candles, plotRows) {
  const { min, max } = candleBounds(candles);
  return buildAxis({
    min,
    max,
    plotRows,
    ticks: spec.ticks ?? 4,
    // A price series is read against its own range: 95 to 120 against zero
    // wastes most of the plot on empty space. Zero is opt in for candles.
    zero: spec.zero === true,
  });
}

/**
 * Where each period sits, in plot cells: its body width, the gap between
 * periods, the pad that centres a short run, and the columns the run takes.
 */
function periodPlan(available, count) {
  const gap = count > 1 ? 1 : 0;
  const periodWidth = Math.max(1, Math.min(3, Math.floor(available / Math.max(1, count)) - gap)) || 1;
  // One clear column between periods, and few candles in a wide chart sit in the
  // middle rather than hugging the axis.
  const stride = periodWidth + gap;
  const used = count * stride - gap;
  return { periodWidth, stride, used, leftPad: Math.max(0, Math.floor((available - used) / 2)) };
}

function centresOf({ stride, leftPad, periodWidth }, count) {
  return Array.from({ length: count }, (_, index) => leftPad + index * stride + (periodWidth - 1) / 2);
}

/**
 * The first periods that fit one column each. A period needs at least one
 * column, so a narrow chart keeps the earliest periods and names the rest in a
 * note instead of painting them past the plot edge, where nobody sees them.
 */
function fitVisible(available, count) {
  let visible = count;
  let plan = periodPlan(available, visible);
  while (visible > 1 && plan.used > available) {
    visible -= 1;
    plan = periodPlan(available, visible);
  }
  return { visible, layout: { ...plan, centres: centresOf(plan, visible) } };
}

/** The body and wick columns of one period, in sub-cells. */
function candleBox({ stride, leftPad, periodWidth }, index, columns) {
  const start = (leftPad + index * stride) * columns;
  const end = start + periodWidth * columns;
  // The body is inset so neighbouring candles never touch.
  const inset = { left: start + 1, right: end - 2 };
  const body = inset.right < inset.left ? { left: start, right: end - 1 } : inset;
  const centre = Math.floor((body.left + body.right) / 2);
  const wickWidth = Math.max(1, Math.floor((body.right - body.left + 1) / 3));
  return {
    left: body.left,
    right: body.right,
    wickLeft: centre - Math.floor((wickWidth - 1) / 2),
    wickWidth,
  };
}

function inSubBounds(x, y, subColumns, subRows) {
  return x >= 0 && y >= 0 && x < subColumns && y < subRows;
}

/** Paint one column range between two sub-rows. */
function fillBox(mark, index, left, right, top, bottom) {
  for (let x = left; x <= right; x += 1) {
    for (let y = top; y <= bottom; y += 1) mark(x, y, index);
  }
}

/** The body from open to close, then the wick from low to high. */
function paintCandle(mark, candle, axis, subRows, box) {
  const index = candle.close >= candle.open ? 0 : 1;
  const bodyTop = subRowOf(axis, Math.max(candle.open, candle.close), subRows);
  const bodyBottom = subRowOf(axis, Math.min(candle.open, candle.close), subRows);
  fillBox(mark, index, box.left, box.right, bodyTop, bodyBottom);

  const wickTop = subRowOf(axis, candle.high, subRows);
  const wickBottom = subRowOf(axis, candle.low, subRows);
  fillBox(mark, index, box.wickLeft, box.wickLeft + box.wickWidth - 1, wickTop, wickBottom);
}

/** The sub-cell grid: 0 is an up period, 1 is a down period, -1 is empty. */
function candleGrid({ axis, candles, layout, subColumns, subRows, columns }) {
  const grid = new Int8Array(subColumns * subRows).fill(-1);
  const mark = (x, y, index) => {
    if (inSubBounds(x, y, subColumns, subRows)) grid[y * subColumns + x] = index;
  };

  for (const [index, candle] of candles.entries()) {
    paintCandle(mark, candle, axis, subRows, candleBox(layout, index, columns));
  }

  return grid;
}

/** One plot cell painted in the colour of the direction that owns most of it. */
function paintOne(x, y, seriesAt, sampler, colours) {
  const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
  if (tally.size === 0) return null;
  const cell = paintCell({ sampler, mask, tally, masks, glyphs: [SOLID, SOLID] });
  return { ...cell, color: cell.slice === 0 ? colours.up : colours.down };
}

/** Reads one sub-cell of the grid, in bounds by construction. */
function seriesReader(grid, subColumns) {
  return (x, y) => grid[y * subColumns + x] ?? -1;
}

function paintCells({ axis, available, grid, sampler, subColumns, colours }) {
  const cells = Array.from({ length: axis.plotRows }, () =>
    Array.from({ length: available }, () => null),
  );
  const seriesAt = seriesReader(grid, subColumns);

  for (let y = 0; y < axis.plotRows; y += 1) {
    for (let x = 0; x < available; x += 1) {
      const cell = paintOne(x, y, seriesAt, sampler, colours);
      if (cell) cells[y][x] = cell;
    }
  }

  return cells;
}

/** The zero row keeps its axis line only when no candle reaches it. */
function plotRow({ axis, cells, row, available, width }) {
  if (row === axis.zeroRow && cells[row].every((cell) => cell === null)) {
    const line = baseline(axis, available);
    return { width, runs: [axisRun(`${line.text}${line.mark}`), axisRun(line.line)] };
  }
  const gutter = axisRow(axis, row);
  const line = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
  return { width, runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(line)] };
}

function bodyRows({ axis, cells, available, width }) {
  const rows = [];
  for (let row = 0; row < axis.plotRows; row += 1) {
    rows.push(plotRow({ axis, cells, row, available, width }));
  }
  return rows;
}

/** The label row, with each label centred on its own candle. Spreading the
 * labels evenly made them drift out of alignment. */
function labelRow(axis, candles, available, centres, width) {
  return {
    width,
    runs: [
      axisRun(BLANK.repeat(axis.gutter)),
      axisRun(pointLabelRow(candles.map((candle) => candle.label), available, centres)),
    ],
  };
}

function legendRow(width, { up, down }) {
  return {
    width,
    runs: [
      { text: "● ", slice: -1, kind: "legend-mark", color: up },
      { text: padTo("up", 5), slice: -1, kind: "legend" },
      { text: "● ", slice: -1, kind: "legend-mark", color: down },
      { text: "down", slice: -1, kind: "legend" },
    ],
  };
}

/** Everything under the title: axis, grid, plot rows, labels, legend. */
function candleChart({ spec, candles, plotRows, width, colours }) {
  const axis = candleAxis(spec, candles, plotRows);
  const available = Math.max(1, width - axis.gutter);
  const { visible, layout } = fitVisible(available, candles.length);
  // The axis keeps the range of the whole series, so narrowing the chart drops
  // periods without rescaling the ones that stay.
  const shown = candles.slice(0, visible);
  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: rowsPerCell } = sampler.shape;
  const subColumns = available * columns;
  const subRows = plotRows * rowsPerCell;

  const grid = candleGrid({ axis, candles: shown, layout, subColumns, subRows, columns });
  const cells = paintCells({ axis, available, grid, sampler, subColumns, colours });
  const rows = bodyRows({ axis, cells, available, width });
  rows.push(labelRow(axis, shown, available, layout.centres, width));
  if (spec.legend !== false) rows.push(legendRow(width, colours));

  return { rows, hidden: candles.length - visible };
}

/** Say how many input rows could not be drawn instead of losing them silently. */
export function skippedCandlesNote(spec, kept, width) {
  const skipped = rawCandles(spec).length - kept;
  if (skipped <= 0) return null;
  const noun = skipped === 1 ? "candle" : "candles";
  return { width, runs: [{ text: truncate(`${skipped} ${noun} skipped`, width), slice: -1, kind: "legend" }] };
}

/** Say how many periods the chart was too narrow to draw. */
export function hiddenPeriodsNote(hidden, width) {
  if (!(hidden > 0)) return null;
  const noun = hidden === 1 ? "period" : "periods";
  return { width, runs: [{ text: truncate(`${hidden} ${noun} hidden`, width), slice: -1, kind: "legend" }] };
}

function candleWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

function candleTitleRows(spec, width) {
  return spec.title ? [titleRow(String(spec.title), width)] : [];
}

function emptyCandleRows(rows, width, skipped) {
  rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
  if (skipped) rows.push(skipped);
  return rows;
}

/** Plot rows after the notes have taken their share of the height budget. */
function chartWithNotes(spec, candles, width, colours, noteCount) {
  return candleChart({
    spec,
    candles,
    plotRows: plotRowsFor(spec, { chrome: chromeRows(spec, noteCount), fallback: 10 }),
    width,
    colours,
  });
}

/** The hidden-period note is a row too, so the fit is retried with it reserved. */
function fittedChart(spec, candles, width, colours, noteCount) {
  const first = chartWithNotes(spec, candles, width, colours, noteCount);
  if (first.hidden === 0) return first;
  return chartWithNotes(spec, candles, width, colours, noteCount + 1);
}

export function renderCandleRows(spec) {
  const width = candleWidth(spec);
  const candles = normalizeCandles(spec);
  const rows = candleTitleRows(spec, width);
  const skipped = skippedCandlesNote(spec, candles.length, width);

  if (candles.length === 0) return emptyCandleRows(rows, width, skipped);

  // The notes take rows out of the height budget before the plot does, or the
  // fence's height guard hides the note itself and reports "rows hidden".
  const chart = fittedChart(spec, candles, width, candleColours(spec), skipped ? 1 : 0);
  rows.push(...chart.rows);

  if (skipped) rows.push(skipped);
  const hidden = hiddenPeriodsNote(chart.hidden, width);
  if (hidden) rows.push(hidden);
  return rows;
}

export { normalizeEntries };
