// A table with typed columns.
//
// A table is the one chart family where the exact number matters, so numbers are
// printed with thousands separators and right-aligned, never compacted to "1.2k".
// Beyond text and numbers, two column types carry meaning in colour: a bar cell
// whose length is the value, and a heat cell whose background is the value.
//
// Columns describe themselves, widths come from the content and are clamped to
// the chart width, and every cell is a run, so the same layout serves plain text
// and colour.

import {
  BLANK,
  cols,
  formatNumber,
  mixOklab,
  padStart,
  padTo,
  titleRow,
  truncate,
  wrapText,
} from "./core.js";
import { paletteOf, themeOf } from "./theme.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
// A column wants four cells; one cell is the hard floor, below which it can hold
// no glyph at all. The gap between the two is what the fit rule spends.
const MIN_WIDTH = 4;
const MIN_CELL = 1;
const GAP = 2;

/** The block that fills the left `fraction` of a cell. */
function leftBlock(fraction) {
  const step = Math.round(Math.max(0, Math.min(1, fraction)) * 8);
  return step >= 8 ? "█" : step <= 0 ? "" : LEFT[step - 1];
}

/** The exact value with thousands separators: 4200 -> "4,200". */
export function exact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  const negative = number < 0;
  const [whole, fraction] = Math.abs(number).toString().split(".");
  const digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${digits}${fraction ? `.${fraction}` : ""}`;
}

/** Columns may be names or objects; every column ends up with a label and a type. */
export function normalizeColumns(spec) {
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  return columns.map(readColumn);
}

function readColumn(column, index) {
  if (typeof column === "string") return namedColumn(column, index);
  return describedColumn(column, index);
}

function namedColumn(name, index) {
  return { index, key: name, label: name, type: "text", width: undefined };
}

function describedColumn(column, index) {
  return {
    index,
    key: columnKey(column, index),
    label: columnLabel(column, index),
    type: columnType(column),
    width: columnWidth(column),
    color: column?.color,
    low: column?.low,
    high: column?.high,
    showValue: column?.showValue,
    align: column?.align,
  };
}

function columnKey(column, index) {
  return column?.key ?? column?.label ?? String(index + 1);
}

function columnLabel(column, index) {
  return String(column?.label ?? column?.key ?? index + 1);
}

function columnType(column) {
  return String(column?.type ?? "text").toLowerCase();
}

function columnWidth(column) {
  const width = Number(column?.width);
  return Number.isFinite(width) ? width : undefined;
}

/** Rows may be arrays in column order, or objects keyed by a column's key. */
export function normalizeRows(spec, columns) {
  const raw = Array.isArray(spec.rows) ? spec.rows : [];
  return raw.map((row) => (Array.isArray(row) ? row : rowValues(row, columns)));
}

function rowValues(row, columns) {
  return columns.map((column) => cellValue(row, column));
}

function cellValue(row, column) {
  return row?.[column.key] ?? row?.[column.label] ?? "";
}

/** The text a cell shows, per column type. A blank cell says nothing. */
function cellText(column, value) {
  if (isBlank(value)) return "";
  if (takesNumber(column)) return exact(value);
  return String(value);
}

function takesNumber(column) {
  return column.type === "number" || column.type === "bar";
}

// null and undefined come from a missing object key or a null array entry;
// "" is what `cellValue` substitutes for a missing key. A real 0 is not blank.
function isBlank(value) {
  return value === null || value === undefined || value === "";
}

/** A cell with nothing in it: no mark and no colour. */
function emptyCell(cellWidth) {
  return { text: BLANK.repeat(cellWidth), slice: -1, kind: "outside" };
}

/**
 * Column widths from the content: a declared width wins, otherwise the widest
 * cell decides, and anything elastic gives way until the table fits the chart.
 *
 * Returns one width per column that fits. At a narrow width the tail of the
 * table is dropped instead of drawn past the edge, so a list shorter than
 * `columns` is the caller's signal to hide the rest and say so.
 */
export function columnWidths(columns, rows, width) {
  const count = fitCount(columns.length, width);
  const kept = columns.slice(0, count);
  const natural = kept.map((column) => naturalWidth(column, rows));
  const budget = width - Math.max(0, kept.length - 1) * GAP;
  const total = natural.reduce((sum, value) => sum + value, 0);
  if (total <= budget) return natural;
  return shrinkToFit(natural, total - budget, elasticColumns(kept));
}

/**
 * The most columns that fit at one cell each: k cells plus 2 * (k - 1)
 * separator cells have to stay inside the width.
 */
function fitCount(columnCount, width) {
  return Math.max(0, Math.min(columnCount, Math.floor((width + GAP) / (1 + GAP))));
}

/** A declared width wins; otherwise the widest cell decides. */
function naturalWidth(column, rows) {
  if (column.width) return Math.max(MIN_WIDTH, Math.floor(column.width));
  return Math.max(MIN_WIDTH, widestCell(column, rows) + barRoom(column.type));
}

function widestCell(column, rows) {
  let need = cols(column.label);
  for (const row of rows) need = Math.max(need, cols(cellText(column, row[column.index])));
  return need;
}

/** A bar needs room for the number plus the bar itself. */
function barRoom(type) {
  return type === "bar" ? 3 : 0;
}

function elasticColumns(columns) {
  return columns.map((column) => column.type === "text" || column.type === "bar");
}

/**
 * Over budget: take the difference out of the elastic columns, then out of
 * everything, and never below one cell.
 */
function shrinkToFit(natural, overflow, elastic) {
  let left = overflow;
  while (left > 0) {
    const room = shrinkTargets(natural, elastic);
    if (room.length === 0) break;
    left = drain(natural, room, left);
  }
  return natural;
}

function shrinkTargets(natural, elastic) {
  const elasticRoom = aboveFloor(natural, elastic);
  return elasticRoom.length > 0 ? elasticRoom : aboveFloor(natural);
}

/** Indices above the one-cell floor, optionally only the elastic ones. */
function aboveFloor(natural, elastic) {
  const indices = [];
  natural.forEach((value, index) => {
    if (value > MIN_CELL && (!elastic || elastic[index])) indices.push(index);
  });
  return indices;
}

/** One cell off each column in turn until the overflow is gone. */
function drain(natural, room, left) {
  let remaining = left;
  for (const index of room) {
    if (remaining <= 0) break;
    natural[index] -= 1;
    remaining -= 1;
  }
  return remaining;
}

/**
 * The lines under the table: what the layout had to drop. A note wraps instead
 * of being cut, because a warning the reader cannot finish is not a warning.
 */
function noteRows(text, width) {
  return wrapText(text, width).map((line) => ({ width, runs: [{ text: line, slice: -1, kind: "legend" }] }));
}

export function renderTableRows(spec) {
  const width = chartWidth(spec.width);
  const columns = normalizeColumns(spec);
  const rows = normalizeRows(spec, columns);
  const out = spec.title ? [titleRow(String(spec.title), width)] : [];

  if (columns.length === 0 || rows.length === 0) return [...out, noDataRow(width)];

  const widths = columnWidths(columns, rows, width);
  // The widths are the columns that fit; the rest are dropped from the right.
  const drawn = columns.slice(0, widths.length);
  const paint = paintContext(spec, drawn, rows);

  out.push(...headerRows(drawn, widths, width, spec.rules !== false));
  out.push(...rows.map((row) => ({ width, runs: rowRuns(row, drawn, widths, paint) })));
  out.push(...layoutNotes(columns, drawn, rows).flatMap((note) => noteRows(note, width)));
  return out;
}

function chartWidth(raw) {
  return Math.max(16, Math.floor(raw ?? 48));
}

function noDataRow(width) {
  return { width, runs: [{ text: "no data", slice: -1, kind: "legend" }] };
}

function headerRows(drawn, widths, width, rules) {
  const rows = [{ width, runs: headerRuns(drawn, widths) }];
  if (rules) rows.push({ width, runs: ruleRuns(widths) });
  return rows;
}

// Header: labels only, so the table reads the same in plain text.
function headerRuns(drawn, widths) {
  const runs = [];
  drawn.forEach((column, index) => {
    if (index > 0) runs.push(gapRun());
    runs.push({ text: headerText(column, widths[index]), slice: -1, kind: "title" });
  });
  return runs;
}

// A header is clipped like any other cell: padStart alone would push a long
// label past the column.
function headerText(column, width) {
  const label = truncate(column.label, width);
  return column.type === "number" ? padStart(label, width) : padTo(label, width);
}

function ruleRuns(widths) {
  const runs = [];
  widths.forEach((value, index) => {
    if (index > 0) runs.push(gapRun());
    runs.push({ text: "─".repeat(value), slice: -1, kind: "axis" });
  });
  return runs;
}

function gapRun() {
  return { text: "  ", slice: -1, kind: "axis" };
}

/** Bar colours, the scale of every bar or heat column, and the fence's heat ramp. */
function paintContext(spec, drawn, rows) {
  return {
    theme: themeOf(spec),
    colours: barColours(drawn, paletteOf(spec)),
    ranges: valueRanges(drawn, rows),
    heat: { low: spec.low, high: spec.high },
  };
}

// Colour for a bar column: its own, or a palette entry per column.
function barColours(drawn, palette) {
  const colours = new Map();
  for (const column of drawn) {
    if (column.type !== "bar") continue;
    colours.set(column.index, column.color ?? palette[column.index % palette.length]);
  }
  return colours;
}

/** The scale of a bar or heat column is that column's own range. */
function valueRanges(drawn, rows) {
  const ranges = new Map();
  for (const column of drawn) {
    if (column.type !== "bar" && column.type !== "heat") continue;
    ranges.set(column.index, valueRange(column, rows));
  }
  return ranges;
}

function valueRange(column, rows) {
  const values = rows.map((row) => Number(row[column.index])).filter((value) => Number.isFinite(value));
  return { low: Math.min(0, ...values), high: Math.max(...values, 0) };
}

function rowRuns(row, drawn, widths, paint) {
  const runs = [];
  drawn.forEach((column, index) => {
    if (index > 0) runs.push(gapRun());
    runs.push(...cellRuns(column, row[index], widths[index], paint));
  });
  return runs;
}

function cellRuns(column, value, cellWidth, paint) {
  if (column.type === "bar") return barRuns(column, value, cellWidth, paint);
  if (column.type === "heat") return heatRuns(column, value, cellWidth, paint);
  return [textRun(column, value, cellWidth)];
}

function textRun(column, value, cellWidth) {
  const clipped = truncate(cellText(column, value), cellWidth);
  const right = column.type === "number" || column.align === "right";
  return {
    text: right ? padStart(clipped, cellWidth) : padTo(clipped, cellWidth),
    slice: -1,
    kind: "text",
  };
}

function barRuns(column, value, cellWidth, paint) {
  if (isBlank(value)) return [emptyCell(cellWidth)];
  const number = exact(value);
  const numberWidth = Number.isFinite(Number(value)) ? cols(number) : 0;
  const showValue = showsBarValue(column, numberWidth, cellWidth);
  const barWidth = Math.max(1, cellWidth - (showValue ? numberWidth + 1 : 0));
  const colour = paint.colours.get(column.index);
  const runs = barFill(barWidth, fractionOf(value, paint.ranges.get(column.index)), colour);
  if (showValue) {
    runs.push({ text: ` ${padStart(number, numberWidth)}`, slice: -1, kind: "label", color: colour });
  }
  return runs;
}

function showsBarValue(column, numberWidth, cellWidth) {
  if (column.showValue === false) return false;
  return numberWidth > 0 && cellWidth >= numberWidth + 2;
}

/**
 * The value's place in its column's own range, so a negative value is short
 * instead of empty. `value / span` drew every negative bar as nothing.
 */
function fractionOf(value, range) {
  const bounds = range ?? { low: 0, high: 1 };
  const span = bounds.high - bounds.low || 1;
  const amount = (Number(value) - bounds.low) / span;
  return Number.isFinite(amount) ? amount : 0;
}

function barFill(barWidth, fraction, colour) {
  const filledWidth = Math.max(0, Math.min(1, fraction)) * barWidth;
  const whole = Math.floor(filledWidth);
  const edge = leftBlock(filledWidth - whole);
  const runs = [];
  if (whole > 0) runs.push({ text: "█".repeat(whole), slice: -1, kind: "fill", color: colour });
  if (edge) runs.push({ text: edge, slice: -1, kind: "fill", color: colour });
  const used = usedCells(whole, edge);
  if (used < barWidth) runs.push({ text: BLANK.repeat(barWidth - used), slice: -1, kind: "outside" });
  return runs;
}

/** Cells the filled part covers: full blocks plus the partial one. */
function usedCells(whole, edge) {
  return whole + (edge ? 1 : 0);
}

function heatRuns(column, value, cellWidth, paint) {
  if (isBlank(value)) return [emptyCell(cellWidth)];
  const colour = heatColour(column, fractionOf(value, paint.ranges.get(column.index)), paint);
  const text = heatText(value, cellWidth);
  if (text === "") return [{ text: BLANK.repeat(cellWidth), slice: -1, kind: "cell", color: colour }];
  return [{ text: padStart(text, cellWidth), slice: -1, kind: "label", color: colour }];
}

/**
 * A heat cell is only as wide as its column: the exact number, then the
 * compact one, then an empty painted cell. It never crosses the edge.
 */
function heatText(value, cellWidth) {
  const exactText = exact(value);
  if (cols(exactText) <= cellWidth) return exactText;
  const compact = formatNumber(value);
  return cols(compact) <= cellWidth ? compact : "";
}

// The ramp resolves left to right: the column's own endpoints, the fence's,
// then the theme's. `color` stays the shorthand for the low end it always was.
function heatColour(column, amount, paint) {
  const low = column.color ?? column.low ?? paint.heat.low ?? paint.theme.heat.low;
  const high = column.high ?? paint.heat.high ?? paint.theme.heat.high;
  return mixOklab(low, high, amount);
}

/** What the layout had to drop, in the order a reader needs it. */
function layoutNotes(columns, drawn, rows) {
  return [...hiddenNotes(columns.length - drawn.length), ...raggedNotes(columns.length, rows)];
}

function hiddenNotes(hidden) {
  if (hidden <= 0) return [];
  return [`${countLabel(hidden, "column", "columns")} hidden`];
}

// Rows are cut and padded to the column count, so a ragged input still draws a
// rectangle. Both directions are counted and said out loud.
function raggedNotes(columnCount, rows) {
  const { missing, extra } = cellOverflow(columnCount, rows);
  const notes = [];
  if (missing > 0) notes.push(`${countLabel(missing, "cell", "cells")} missing`);
  if (extra > 0) notes.push(`${countLabel(extra, "extra value", "extra values")} ignored`);
  return notes;
}

function cellOverflow(columnCount, rows) {
  let missing = 0;
  let extra = 0;
  for (const row of rows) {
    missing += Math.max(0, columnCount - row.length);
    extra += Math.max(0, row.length - columnCount);
  }
  return { missing, extra };
}

function countLabel(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
