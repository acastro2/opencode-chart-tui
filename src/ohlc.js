// Open-high-low-close bars: a vertical range with a left tick for the open and
// a right tick for the close. This is deliberately not a candlestick: a filled
// body hides which end is the open, and the type name promises the ticks.
//
//   { "type": "ohlc", "values": [[100, 118, 96, 112], ...] }
//   { "type": "ohlc", "candles": [{ "label": "Jan", "open": 100, ... }] }
//
// The axis is read against the data, not zero, unless `zero` is true. A price
// series that starts at 95 should not spend most of the plot on empty space.

import {
  BLANK,
  cellsToRuns,
  padTo,
  titleRow,
} from "./core.js";
import { themeOf } from "./theme.js";
import { axisRow, baseline, buildAxis, pointLabelRow } from "./axis.js";
import { hiddenPeriodsNote, normalizeCandles, skippedCandlesNote } from "./candle.js";
import { layoutFor } from "./layout.js";

function axisRun(text) {
  return { text, slice: -1, kind: "axis" };
}

function legendText(text) {
  return { text, slice: -1, kind: "legend" };
}

function legendMark(text, color) {
  return { text, slice: -1, kind: "legend-mark", color };
}

function chartWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** Up and down colours: an explicit spec colour wins over the theme pair. */
function colourPair(spec) {
  const theme = themeOf(spec);
  return {
    up: typeof spec.up === "string" ? spec.up : theme.palette[1],
    down: typeof spec.down === "string" ? spec.down : theme.palette[3],
  };
}

function noDataRow(width) {
  return { width, runs: [legendText("no data")] };
}

/** One blank column between periods once there is more than one. */
function gapFor(count) {
  return count > 1 ? 1 : 0;
}

/**
 * Columns per period: one for a single period, up to three, and never zero.
 * The gap is taken out before the cap, so a crowded chart keeps its separators.
 */
function periodWidthFor(available, count) {
  return Math.max(1, Math.min(3, Math.floor(available / count) - gapFor(count))) || 1;
}

/** Columns `count` periods take: bodies plus the gaps between them. */
function usedColumns(count, stride) {
  return count * stride - gapFor(count);
}

/** Centre the periods in the plot rather than hugging the axis. */
function leftPadFor(available, count, stride) {
  return Math.max(0, Math.floor((available - usedColumns(count, stride)) / 2));
}

/** The column plan without the centres: cheap enough to try a count and drop it. */
function columnPlan(available, count) {
  const periodWidth = periodWidthFor(available, count);
  const stride = periodWidth + gapFor(count);
  const leftPad = leftPadFor(available, count, stride);
  return { periodWidth, stride, leftPad, used: usedColumns(count, stride) };
}

function planColumns(available, count) {
  const plan = columnPlan(available, count);
  return {
    ...plan,
    centres: Array.from(
      { length: count },
      (_, index) => plan.leftPad + index * plan.stride + (plan.periodWidth - 1) / 2,
    ),
  };
}

/**
 * The first periods that fit one column each. A period needs at least one
 * column, so a narrow chart keeps the earliest periods and names the rest in a
 * note instead of painting them past the plot edge, where nobody sees them.
 */
function fitVisible(available, count) {
  let visible = count;
  let plan = columnPlan(available, visible);
  while (visible > 1 && plan.used > available) {
    visible -= 1;
    plan = columnPlan(available, visible);
  }
  return { visible, plan };
}

function blankCells(rows, columns) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
}

/** A setter that drops coordinates outside the plot instead of throwing. */
function cellSetter(cells, columns, rows) {
  return (x, y, char, slice, color) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    cells[y][x] = { slice, char, kind: "fill", color };
  };
}

/** 0 is an up period, 1 a down one; the open/close pair decides, not the close. */
function barStyle(candle, colours) {
  const slice = candle.close >= candle.open ? 0 : 1;
  return { slice, color: slice === 0 ? colours.up : colours.down };
}

/** The high-low stem: one cell wide, top row to bottom row. */
function drawStem(set, centre, top, bottom, style) {
  for (let y = top; y <= bottom; y++) set(centre, y, "│", style.slice, style.color);
}

/**
 * The open tick on the left and the close tick on the right, or one `┼` when
 * the period opened and closed in the same row. A wide period gets a horizontal
 * arm on each tick, which is what makes the direction readable at a glance.
 */
function drawTicks(set, centre, openRow, closeRow, periodWidth, style) {
  const { slice, color } = style;
  if (openRow === closeRow) {
    set(centre, openRow, "┼", slice, color);
  } else {
    set(centre, openRow, "┤", slice, color);
    set(centre, closeRow, "├", slice, color);
  }
  if (periodWidth >= 3) {
    set(centre - 1, openRow, "─", slice, color);
    set(centre + 1, closeRow, "─", slice, color);
  }
}

function drawCandle(candle, index, plot, colours, set) {
  const style = barStyle(candle, colours);
  const centre = Math.floor(plot.centres[index]);
  const rowOf = plot.axis.rowOf;
  drawStem(set, centre, rowOf(candle.high), rowOf(candle.low), style);
  drawTicks(set, centre, rowOf(candle.open), rowOf(candle.close), plot.periodWidth, style);
}

function drawBars(candles, plot, colours) {
  const cells = blankCells(plot.axis.plotRows, plot.available);
  const set = cellSetter(cells, plot.available, plot.axis.plotRows);
  candles.forEach((candle, index) => drawCandle(candle, index, plot, colours, set));
  return cells;
}

/** The axis, the width left for periods, and where each period sits. */
function plotOf(spec, candles, width, notes = 0) {
  // Title, the label row, the legend and the notes are counted once here, and
  // the ledger pays for them before the plot.
  const axis = buildAxis({
    min: Math.min(...candles.map((candle) => candle.low)),
    max: Math.max(...candles.map((candle) => candle.high)),
    plotRows: layoutFor(spec, {
      title: spec.title ? 1 : 0,
      labels: 1,
      legend: spec.legend === false ? 0 : 1,
      notes,
      fallback: 10,
    }).plotRows,
    ticks: spec.ticks ?? 4,
    zero: spec.zero === true,
  });
  const available = Math.max(1, width - axis.gutter);
  const { visible } = fitVisible(available, candles.length);
  // The axis keeps the range of the whole series, so narrowing the chart drops
  // periods without rescaling the ones that stay.
  const shown = candles.slice(0, visible);
  return {
    axis,
    available,
    shown,
    hidden: candles.length - visible,
    ...planColumns(available, visible),
  };
}

function outsideCell() {
  return { slice: -1, char: BLANK, kind: "outside" };
}

function rowIsEmpty(cells) {
  return cells.every((cell) => cell === null);
}

/** The zero row when nothing is drawn on it: the axis line carries the label. */
function baselineRow(axis, available, width) {
  const line = baseline(axis, available);
  return { width, runs: [axisRun(`${line.text}${line.mark}`), axisRun(line.line)] };
}

function dataRow(axis, y, cells, width) {
  const gutter = axisRow(axis, y);
  const line = cells[y].map((cell) => cell ?? outsideCell());
  return {
    width,
    runs: [axisRun(`${gutter.text}${gutter.mark}`), ...cellsToRuns(line)],
  };
}

function plotRow(plot, y, cells, width) {
  if (y === plot.axis.zeroRow && rowIsEmpty(cells[y])) {
    return baselineRow(plot.axis, plot.available, width);
  }
  return dataRow(plot.axis, y, cells, width);
}

function plotRowsOf(plot, cells, width) {
  const rows = [];
  for (let y = 0; y < plot.axis.plotRows; y++) rows.push(plotRow(plot, y, cells, width));
  return rows;
}

function labelRow(plot, candles, width) {
  return {
    width,
    runs: [
      axisRun(BLANK.repeat(plot.axis.gutter)),
      axisRun(
        pointLabelRow(
          candles.map((candle) => candle.label),
          plot.available,
          plot.centres,
        ),
      ),
    ],
  };
}

function legendRow(width, colours) {
  return {
    width,
    runs: [
      legendMark("● ", colours.up),
      legendText(padTo("up", 5)),
      legendMark("● ", colours.down),
      legendText("down"),
    ],
  };
}

/** Say how many input rows could not be drawn instead of losing them silently. */
function notesFor(spec, width, kept, hidden) {
  const rows = [];
  const skipped = skippedCandlesNote(spec, kept, width);
  if (skipped) rows.push(skipped);
  const missed = hiddenPeriodsNote(hidden, width);
  if (missed) rows.push(missed);
  return rows;
}

function tailRows(spec, width, colours, kept, hidden) {
  const rows = [];
  if (spec.legend !== false) rows.push(legendRow(width, colours));
  rows.push(...notesFor(spec, width, kept, hidden));
  return rows;
}

export function renderOhlcRows(spec) {
  const width = chartWidth(spec);
  const candles = normalizeCandles(spec);
  const colours = colourPair(spec);
  const head = spec.title ? [titleRow(String(spec.title), width)] : [];
  const skipped = skippedCandlesNote(spec, candles.length, width);
  if (candles.length === 0) return [...head, noDataRow(width), ...(skipped ? [skipped] : [])];

  const chartFor = (notes) => {
    const plot = plotOf(spec, candles, width, notes);
    const cells = drawBars(plot.shown, plot, colours);
    return {
      plot,
      rows: [...plotRowsOf(plot, cells, width), labelRow(plot, plot.shown, width)],
    };
  };

  // The notes take rows out of the height budget before the plot does, or the
  // fence's height guard hides the note itself and reports "rows hidden".
  let chart = chartFor(skipped ? 1 : 0);
  if (chart.plot.hidden > 0) chart = chartFor((skipped ? 1 : 0) + 1);

  return [
    ...head,
    ...chart.rows,
    ...tailRows(spec, width, colours, candles.length, chart.plot.hidden),
  ];
}
