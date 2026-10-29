// Slope: the change of one measure between two columns, per category.
//
// Why this family: a table of before/after numbers hides the two things a reader
// wants first — which way each value moved, and which lines overtook the others.
// Every "before" sits in one column and every "after" in another, on a shared
// value axis, so a glance down the left column and down the right one reads as
// two rankings, and the lines between them are the changes.
//
// The two columns are fixed on purpose. A point at its own value's x is a
// dumbbell: it answers "how far apart are the two numbers", not "which line
// crossed which", and two categories that move the same distance draw the same
// picture wherever they start. Here the span is always the same width, so the
// angle of the line is the size of the change.
//
// The vertical scale is the data's own, always with zero inside it, because
// "from 0 to 20" and "from 100 to 120" must not look the same.
//
// Colour carries the direction: palette slice 0 for a rise, 1 for a fall, 2 for
// no change. A caller who wants red for a fall passes its own `palette`; the
// default palette is the theme's eight series colours, not a red/green pair.

import { blankGrid, cellsToRuns, cols, formatNumber, stampText, titleRow, truncate } from "./core.js";
import { buildAxis } from "./axis.js";
import { MIN_CHART_WIDTH, layoutFor } from "./layout.js";
import { coerceList, policyFor } from "./values.js";

/** The mark at each end of a line: one glyph for before and one for after. */
const MARK = "◆";
/** The line's cell when its row did not change between two columns. */
const LEVEL = "─";
/** The line's cell when the value rose: lower left to upper right. */
const RISING = "╱";
/** The line's cell when the value fell: upper left to lower right. */
const FALLING = "╲";
/** A step of more than one row keeps a vertical cell, so the line never breaks. */
const STEEP = "│";

/** The palette slice each direction paints with. */
export const SLOPE_UP = 0;
export const SLOPE_DOWN = 1;
export const SLOPE_SAME = 2;

/** The narrowest plot worth drawing: below it the value text goes, not the marks. */
const MIN_PLOT = 16;
/** The label gutter never takes more than this share of the chart. */
const GUTTER_LIMIT = 0.34;
/** One cell of air between a number column and the plot. */
const VALUE_GAP = 1;
/** The plot's height when the fence names none: the axis is this chart's body. */
const DEFAULT_PLOT_ROWS = 10;

/** A cell template no family paints with a colour of its own. */
const PLAIN = { slice: -1, mask: 0 };

/** One series' numbers: a bare array, or the array under its `values` key. */
function seriesValuesOf(item) {
  if (Array.isArray(item)) return item;
  return item?.values ?? [];
}

/** One series' name, or the position it holds when the fence gave none. */
function seriesNameOf(item, index) {
  return String(item?.name ?? `series ${index + 1}`);
}

/** One series as a name and coerced numbers, under the slope value policy. */
function readSeries(raw, index) {
  const item = raw[index];
  return {
    name: seriesNameOf(item, index),
    values: coerceList(seriesValuesOf(item), policyFor("slope")).values,
  };
}

/** The labels, or the point's position when the spec named none. */
function readLabels(spec, series) {
  const labels = Array.isArray(spec?.labels) ? spec.labels : [];
  const count = Math.max(labels.length, ...series.map((item) => item.values.length));
  return Array.from({ length: count }, (_, index) => String(labels[index] ?? index + 1));
}

/** The bottom of the shared scale: the smallest value, so a slope is visible. */
function lowOf(series) {
  const values = series.flatMap((item) => item.values);
  return values.length > 0 ? Math.min(...values) : 0;
}

/** The top of the shared scale: the largest value, never below zero. */
function highOf(series) {
  let high = 0;
  for (const item of series) {
    for (const value of item.values) high = Math.max(high, value);
  }
  return high > 0 ? high : 1;
}

/** One row per label: the two values a line joins. */
function pointsOf(labels, series) {
  const [before, after] = series;
  return labels.map((label, index) => ({
    label,
    before: before.values[index] ?? 0,
    after: after.values[index] ?? 0,
  }));
}

/**
 * The fence body as a slope: exactly two series, the labels, and the shared
 * scale. A spec with any other number of series is refused rather than guessed:
 * a line of five series has no before and no after.
 */
export function normalizeSlope(spec = {}) {
  const raw = Array.isArray(spec.series) ? spec.series : [];
  if (raw.length !== 2) {
    return { error: "slope needs two series (before, after)", names: [], labels: [], points: [], low: 0, high: 1 };
  }
  const series = [readSeries(raw, 0), readSeries(raw, 1)];
  const labels = readLabels(spec, series);
  return {
    error: null,
    names: series.map((item) => item.name),
    labels,
    points: pointsOf(labels, series),
    low: lowOf(series),
    high: highOf(series),
  };
}

/** `  no data`, plus the reason when there is one. */
function noDataRows(spec, width, note) {
  const rows = spec.title ? [titleRow(spec.title, width)] : [];
  rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
  if (note) rows.push({ width, runs: [{ text: truncate(`  ${note}`, width), slice: -1, kind: "legend" }] });
  return rows;
}

/** The block's width: the fence's own, never under the floor, default 60. */
function chartWidth(spec) {
  return Math.max(MIN_CHART_WIDTH, Math.floor(Number(spec.width) || 60));
}

/** The widest visible label, bounded so the plot keeps its share of the width. */
function labelWidthFor(points, width) {
  let widest = 0;
  for (const point of points) widest = Math.max(widest, cols(point.label));
  const limit = Math.max(4, Math.floor(width * GUTTER_LIMIT));
  return Math.min(Math.max(4, widest), limit);
}

/** The widest number on each side: one column for the before values, one for after. */
function valueWidths(points) {
  let before = 0;
  let after = 0;
  for (const point of points) {
    before = Math.max(before, cols(formatNumber(point.before)));
    after = Math.max(after, cols(formatNumber(point.after)));
  }
  return { before, after };
}

/**
 * The columns: the label gutter, a column of before values, the plot, and a
 * column of after values. Each number sits beside its own mark, so a row that
 * also carries another line's dot cannot make one category's number look like
 * the other's.
 *
 * The numbers are dropped together and before the plot is: a chart with one
 * end's values and not the other reads as if the missing end had none.
 */
function slopeGeometry(width, data, plotRows) {
  const labelWidth = labelWidthFor(data.points, width);
  const values = valueWidths(data.points);
  const gutter = labelWidth + 1;
  // Both number columns, their air, and the smallest plot worth drawing.
  const framed = gutter + values.before + VALUE_GAP + MIN_PLOT + VALUE_GAP + values.after;
  const withText = width >= framed;
  const left = withText ? gutter + values.before + VALUE_GAP : gutter;
  const plot = Math.max(2, width - left - (withText ? values.after + VALUE_GAP : 0));
  return {
    width,
    left,
    plot,
    right: left + plot - 1,
    labelWidth,
    values,
    withText,
    // A slope chart is read for the change, not the distance from zero: an exact
    // min..max scale fills the plot, where a nice-bounds axis pads it with empty
    // bands and flattens every move.
    axis: exactScale(
      data.low === data.high ? Math.max(0, data.low - 1) : data.low,
      data.low === data.high ? data.high + 1 : data.high,
      plotRows,
    ),
  };
}

/**
 * Map a value straight onto a row: the lowest value at the bottom row, the
 * highest at the top. No padding, no nice bounds — a slope needs the range it has.
 */
function exactScale(low, high, plotRows) {
  const span = high - low || 1;
  const last = Math.max(0, plotRows - 1);
  return {
    plotRows,
    rowOf: (value) => Math.max(0, Math.min(last, Math.round(((high - value) / span) * last))),
  };
}

/** The palette slice for a row's direction. */
function sliceOf(point) {
  if (point.after > point.before) return SLOPE_UP;
  if (point.after < point.before) return SLOPE_DOWN;
  return SLOPE_SAME;
}

/**
 * One category with the two rows its line joins, its direction and its colour:
 * the single reading every drawing step shares, so a mark, its line and its text
 * cannot disagree about which row they belong to.
 */
function place(point, axis) {
  return {
    ...point,
    from: axis.rowOf(point.before),
    to: axis.rowOf(point.after),
    slice: sliceOf(point),
  };
}

/** One cell, clipped to the grid: a mark never widens its own chart. */
function paint(grid, x, y, char, template) {
  const row = grid[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = { ...template, char };
}

/** The cells that take the line from `previous` to `row` in one column. */
function climbCells(x, previous, row, template) {
  if (row === previous) return [{ x, y: row, char: LEVEL, template }];
  const up = row < previous;
  const cells = [];
  for (let y = previous + (up ? -1 : 1); y !== row; y += up ? -1 : 1) {
    cells.push({ x, y, char: STEEP, template });
  }
  cells.push({ x, y: row, char: up ? RISING : FALLING, template });
  return cells;
}

/**
 * The line's cells between the two dots. Each plot column draws the line's own
 * row there, so the line spans the whole plot whatever the size of the change;
 * a step of more than one row fills the rows it crosses, because a gap in the
 * line reads as two short lines.
 */
function connectorCells(placed, geometry) {
  const template = { slice: placed.slice, kind: "fill", mask: 0 };
  const span = Math.max(1, geometry.right - geometry.left);
  const cells = [];
  let previous = placed.from;
  for (let x = geometry.left + 1; x < geometry.right; x++) {
    const row = Math.round(placed.from + ((placed.to - placed.from) * (x - geometry.left)) / span);
    cells.push(...climbCells(x, previous, row, template));
    previous = row;
  }
  return cells;
}

/** The two ends: one mark in the before column, one in the after column. */
function drawMarks(grid, placed, geometry) {
  const template = { slice: placed.slice, kind: "fill", mask: 0 };
  paint(grid, geometry.left, placed.from, MARK, template);
  paint(grid, geometry.right, placed.to, MARK, template);
}

/**
 * The row each label is written on: its own before row, or -1 when another
 * category already claimed that row. A nudged label sits beside a line that is
 * not its own, which reads as a mislabelled chart, so a collision hides the name
 * and the note says how many did.
 */
function labelRows(placed) {
  const taken = new Set();
  return placed.map((point) => {
    if (taken.has(point.from)) return -1;
    taken.add(point.from);
    return point.from;
  });
}

/**
 * The category and its before value, on the row its before mark sits on. Both
 * are skipped when a second category claimed that row: the number would sit
 * beside one of two dots, so the note reports the labels that could not be
 * placed instead of guessing.
 */
function drawBeforeText(grid, point, labelRow, geometry) {
  if (labelRow < 0) return;
  const label = truncate(point.label, geometry.labelWidth);
  stampText(grid, geometry.labelWidth - cols(label), labelRow, label, { ...PLAIN, kind: "axis" });
  if (!geometry.withText) return;
  const text = formatNumber(point.before);
  const start = geometry.labelWidth + VALUE_GAP + geometry.values.before - cols(text);
  stampText(grid, start, labelRow, text, { ...PLAIN, kind: "legend" });
}

/**
 * The after value, on the row its own mark sits on rather than the label's row.
 * Two categories close in value can share a row with a different line's dot; a
 * number drawn on the label's row would then sit beside the wrong mark.
 */
function drawAfterText(grid, point, geometry) {
  if (!geometry.withText) return;
  const text = formatNumber(point.after);
  stampText(grid, geometry.right + 1 + VALUE_GAP, point.to, text, { ...PLAIN, kind: "legend" });
}

/**
 * The plot: every line first, then every mark. Marks last so a line that crosses
 * another cannot eat the dot that ends it.
 */
function buildGrid(geometry, placed, labelAt) {
  const grid = blankGrid(geometry.width, geometry.axis.plotRows);
  for (const point of placed) {
    for (const cell of connectorCells(point, geometry)) paint(grid, cell.x, cell.y, cell.char, cell.template);
  }
  for (const point of placed) drawMarks(grid, point, geometry);
  for (const [index, point] of placed.entries()) drawBeforeText(grid, point, labelAt[index], geometry);
  for (const point of placed) drawAfterText(grid, point, geometry);
  return grid;
}

/** A name's cells: cut to its half of the row and centred on its own column. */
function nameCells(text, anchor, min, max) {
  const room = Math.max(0, max - min);
  const cut = truncate(String(text ?? ""), room);
  if (cut === "") return [];
  const width = cols(cut);
  const start = Math.max(min, Math.min(anchor - Math.floor((width - 1) / 2), max - width));
  return [{ start, text: cut }];
}

/**
 * The series names under their own columns: the first under the before column,
 * the last under the after column. A legend row would name them again from a
 * distance, so this row is the legend, and it is the one row the ledger pays for.
 */
function namesUnderColumns(width, names, geometry) {
  const split = geometry.left + Math.floor(Math.max(0, geometry.plot - 1) / 2);
  const grid = blankGrid(width, 1);
  const template = { ...PLAIN, kind: "legend" };
  for (const cell of nameCells(names[0], geometry.left, 0, split)) {
    stampText(grid, cell.start, 0, cell.text, template);
  }
  for (const cell of nameCells(names[1], geometry.right, split, width)) {
    stampText(grid, cell.start, 0, cell.text, template);
  }
  const runs = cellsToRuns(grid[0]);
  return runs.length > 0 ? { width, runs } : null;
}

/** The labels that found no row, named rather than silently missing. */
function hiddenNote(width, hidden) {
  if (!(hidden > 0)) return [];
  const plural = hidden === 1 ? "label" : "labels";
  const text = truncate(`  … ${hidden} ${plural} hidden`, width);
  return [{ width, runs: [{ text, slice: -1, kind: "legend" }] }];
}

/**
 * The row budget: the title, the plot's value rows and the series names under
 * the columns. The plot is the body of a slope — it is the value axis — so an
 * unset height draws `DEFAULT_PLOT_ROWS` rows rather than one row per category.
 */
function slopeLedger(spec, noteRow) {
  return layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: spec.legend === false ? 0 : 1,
    notes: noteRow ? 1 : 0,
    fallback: DEFAULT_PLOT_ROWS,
    min: 3,
    max: 30,
  }).plotRows;
}

/** One drawing at a given plot height, with the labels it could not place. */
function drawSlope(spec, data, noteRow) {
  const geometry = slopeGeometry(chartWidth(spec), data, slopeLedger(spec, noteRow));
  const placed = data.points.map((point) => place(point, geometry.axis));
  const labelAt = labelRows(placed);
  return {
    geometry,
    grid: buildGrid(geometry, placed, labelAt),
    hidden: labelAt.filter((row) => row < 0).length,
  };
}

/**
 * The rows a slope draws: an optional title, the plot (the value axis), the
 * series names under the two columns, and the note for hidden labels.
 */
export function renderSlopeRows(spec = {}) {
  const width = chartWidth(spec);
  const data = normalizeSlope(spec);
  if (data.error) return noDataRows(spec, width, data.error);
  if (data.points.length === 0) return noDataRows(spec, width, null);

  const drawn = drawSlope(spec, data, false);
  // A label with no row left is a loss, and the note itself is a row: draw again
  // with that row reserved, so the block still ends where `height` promised.
  const final = drawn.hidden > 0 ? drawSlope(spec, data, true) : drawn;

  const rows = spec.title ? [titleRow(String(spec.title), width)] : [];
  rows.push(...final.grid.map((cells) => ({ width, runs: cellsToRuns(cells) })));
  const names = spec.legend === false ? null : namesUnderColumns(width, data.names, final.geometry);
  if (names) rows.push(names);
  rows.push(...hiddenNote(width, final.hidden));
  return rows;
}
