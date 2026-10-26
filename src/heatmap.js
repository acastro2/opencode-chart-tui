// A heat map: one cell per value, coloured along a ramp, with an optional
// number inside the cell.
//
// The colour is computed per cell rather than taken from the palette, so a run
// carries its own colour (`color`) the same way a series grid carries a slice.
//
// The work is split into three flat stages so no single function has to hold
// the whole picture: normalize the fence into rows, plan the layout in cells,
// then paint the runs from that plan. Every stage is a small pure helper, which
// is also what keeps the branch count low enough to test properly.

import {
  BLANK,
  DEFAULT_PALETTE,
  cols,
  contrastOn,
  formatNumber,
  mixOklab,
  padStart,
  padTo,
  titleRow,
  truncate,
  wrapText,
} from "./core.js";
import { themeOf } from "./theme.js";
import { coerce, policyFor } from "./values.js";

export const HEAT_LOW = "#1f3b57";
export const HEAT_HIGH = "#e5695f";

/** The shared fate of a heat map value: a blank and an unreadable one are holes. */
const HEAT_POLICY = policyFor("heatmap");

/**
 * One value the map can draw. The policy leaves a hole (null) for anything not
 * a finite number: a bad value is a gap to report, never a zero to paint as data.
 */
function heatValue(value) {
  return coerce(value, HEAT_POLICY).value;
}

/* -------------------------------------------------------------------------- */
/* Normalizing: a fence of any accepted shape -> { columns, rows }             */
/* -------------------------------------------------------------------------- */

// "headers" is the name for a heat map's column labels; "columns" was the old
// one and still reads, so an older fence keeps working.
function headerLabels(spec) {
  if (Array.isArray(spec.headers)) return spec.headers.map(String);
  if (Array.isArray(spec.columns)) return spec.columns.map(String);
  return [];
}

/** A row is either its own value list, or an object carrying one. */
function rowValues(row) {
  return Array.isArray(row) ? row : row?.values ?? [];
}

function rowLabel(row, index) {
  return Array.isArray(row) ? String(index + 1) : String(row?.label ?? index + 1);
}

function rowsFromRows(source) {
  const rows = [];
  for (const [index, row] of source.entries()) {
    const values = rowValues(row).map(heatValue);
    if (values.length > 0) rows.push({ label: rowLabel(row, index), values });
  }
  return rows;
}

function isValueGrid(values) {
  return Array.isArray(values) && Array.isArray(values[0]);
}

function rowsFromValues(source, labels) {
  return Array.from(source, (values, index) => ({
    label: String(labels?.[index] ?? index + 1),
    // A malformed row is a row with no values, not a crash on `.map`.
    values: (Array.isArray(values) ? values : []).map(heatValue),
  }));
}

function seriesList(item) {
  return item?.values ?? item ?? [];
}

function listedValues(list) {
  return (Array.isArray(list) ? list : []).map(heatValue);
}

function seriesValues(item) {
  return listedValues(seriesList(item));
}

function seriesLabel(item, index) {
  return String(item?.name ?? index + 1);
}

function rowsFromSeries(source) {
  const rows = [];
  for (const [index, item] of source.entries()) {
    const values = seriesValues(item);
    if (values.length > 0) rows.push({ label: seriesLabel(item, index), values });
  }
  return rows;
}

/**
 * Accept a grid of numbers, rows of { label, values }, or series where each
 * series is a row. Returns rows of labels and values plus the column labels.
 */
export function normalizeGrid(spec) {
  const columns = headerLabels(spec);
  if (Array.isArray(spec.rows)) return { columns, rows: rowsFromRows(spec.rows) };
  if (isValueGrid(spec.values)) return { columns, rows: rowsFromValues(spec.values, spec.labels) };
  if (Array.isArray(spec.series)) return { columns, rows: rowsFromSeries(spec.series) };
  return { columns, rows: [] };
}

/* -------------------------------------------------------------------------- */
/* Planning: the width budget, the value range, and how many cells fit        */
/* -------------------------------------------------------------------------- */

function resolveWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** The headers set the column count, or the longest row when the fence gave none. */
function countColumns(columns, grid) {
  if (columns.length > 0) return columns.length;
  const longest = grid.reduce((most, row) => Math.max(most, row.values.length), 0);
  return Math.max(1, longest);
}

/** The list the fence declared, whether or not the normalizer could keep it. */
function declaredRows(spec) {
  if (Array.isArray(spec.rows)) return spec.rows;
  if (Array.isArray(spec.values)) return spec.values;
  return Array.isArray(spec.series) ? spec.series : [];
}

/** The widest header label sets the default cell width. */
function widestHeader(columns) {
  return columns.length > 0 ? Math.max(...columns.map((text) => cols(String(text)))) : 0;
}

function resolveCellWidth(spec, widest) {
  const fallback = Math.max(2, widest + 1);
  return Math.max(1, Math.min(8, Math.floor(spec.cellWidth ?? fallback)));
}

function coalesce(primary, secondary, fallback) {
  return primary ?? secondary ?? fallback;
}

function rampOf(spec, theme) {
  return {
    low: coalesce(spec.low, spec.from, theme.heat.low),
    high: coalesce(spec.high, spec.to, theme.heat.high),
  };
}

function isGiven(value) {
  return value !== undefined && value !== null && Number.isFinite(Number(value));
}

function minOf(list) {
  return Math.min(...list);
}

function maxOf(list) {
  return Math.max(...list);
}

function boundOf(override, list, choose, empty) {
  if (isGiven(override)) return Number(override);
  return list.length > 0 ? choose(list) : empty;
}

function numbersOf(grid) {
  return grid.flatMap((row) => row.values).filter((value) => value !== null);
}

function resolveRange(spec, grid, theme) {
  const { low, high } = rampOf(spec, theme);
  const numbers = numbersOf(grid);
  const min = boundOf(spec.min, numbers, minOf, 0);
  const max = boundOf(spec.max, numbers, maxOf, 1);
  return { low, high, min, max, span: max - min || 1 };
}

function labelGutter(grid, width) {
  const widest = Math.max(...grid.map((row) => cols(row.label)), 1);
  return Math.min(widest, Math.max(4, Math.floor(width * 0.3)));
}

/**
 * Everything the painting stage needs: the ramp, the value range, the label
 * gutter, how many columns fit and how wide each cell is.
 */
function heatLayout(spec, grid, columns, count, width) {
  const { low, high, min, max, span } = resolveRange(spec, grid, themeOf(spec));
  const labelWidth = labelGutter(grid, width);
  // The space the matrix has after the label gutter and its two spaces. When the
  // headers do not fit at one cell each, the tail is hidden and noted rather
  // than drawn past the edge.
  const available = Math.max(1, width - labelWidth - 2);
  const drawn = Math.min(count, available);
  // The requested cell width, never wider than the space the row actually has.
  const fits = Math.max(1, Math.min(resolveCellWidth(spec, widestHeader(columns)), Math.floor(available / drawn)));
  return {
    width,
    low,
    high,
    min,
    max,
    span,
    labelWidth,
    drawn,
    fits,
    valueLabels: spec.valueLabels !== false,
  };
}

/* -------------------------------------------------------------------------- */
/* Notes: what the grid had to change to stay a grid                          */
/* -------------------------------------------------------------------------- */

/**
 * The lines under the map. A note wraps instead of being cut, because the
 * counts are the point of it.
 */
function noteRows(text, width) {
  return wrapText(text, width).map((line) => ({ width, runs: [{ text: line, slice: -1, kind: "legend" }] }));
}

function droppedNote(dropped) {
  return `${dropped} ${dropped === 1 ? "row has" : "rows have"} no values`;
}

function raggedNote(count, columns, index, row) {
  const side = columns.length > 0 ? "headers" : "columns";
  // The counts lead, so a narrow width wraps the sentence instead of cutting
  // the numbers off it.
  return `values for ${count} ${side}; row ${index + 1} has ${row.values.length}`;
}

function holeNote(holes) {
  return `${holes} ${holes === 1 ? "value is" : "values are"} not a number`;
}

function hiddenNote(hidden) {
  return `${hidden} ${hidden === 1 ? "column" : "columns"} hidden`;
}

function countHoles(values) {
  return values.filter((value) => value === null).length;
}

function paddedValues(values, count) {
  return Array.from({ length: count }, (_, column) => values[column] ?? null);
}

/**
 * Pad every row to the same column count, in place, and say what that changed.
 * A row the normalizer dropped is still a row the fence gave, so it is noted
 * first; then the ragged rows in order; then the holes.
 */
function padGrid(grid, count, columns) {
  const holes = grid.reduce((total, row) => total + countHoles(row.values), 0);
  const notes = [];
  grid.forEach((row, index) => {
    if (row.values.length !== count) notes.push(raggedNote(count, columns, index, row));
    row.values = paddedValues(row.values, count);
  });
  if (holes > 0) notes.push(holeNote(holes));
  return notes;
}

function gridNotes(spec, grid, columns, count) {
  const dropped = Math.max(0, declaredRows(spec).length - grid.length);
  const notes = dropped > 0 ? [droppedNote(dropped)] : [];
  return notes.concat(padGrid(grid, count, columns));
}

/* -------------------------------------------------------------------------- */
/* Painting: layout plan -> runs                                              */
/* -------------------------------------------------------------------------- */

function prelude(spec, width, empty) {
  const rows = spec.title ? [titleRow(String(spec.title), width)] : [];
  if (empty) rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
  return rows;
}

function headerRow(columns, layout) {
  // Right-aligned inside its cell, the same as the numbers below it, and cut
  // by display width so a wide glyph cannot shift the header off its column.
  const header = columns
    .slice(0, layout.drawn)
    .map((text) => padStart(truncate(text, layout.fits), layout.fits))
    .join("");
  return {
    width: layout.width,
    runs: [
      { text: BLANK.repeat(layout.labelWidth + 2), slice: -1, kind: "axis" },
      { text: header, slice: -1, kind: "axis" },
    ],
  };
}

function labelRun(label, layout) {
  return { text: ` ${padTo(truncate(label, layout.labelWidth), layout.labelWidth)} `, slice: -1, kind: "axis" };
}

function cellRun(value, layout) {
  if (value === null) {
    // A bad or missing value keeps its cell, so the columns stay aligned, but
    // it claims no colour and no number.
    return { text: BLANK.repeat(layout.fits), slice: -1, kind: "outside" };
  }
  const color = mixOklab(layout.low, layout.high, (value - layout.min) / layout.span);
  const text = formatNumber(value);
  if (layout.valueLabels && cols(text) <= layout.fits) {
    return { text: padStart(text, layout.fits), slice: -1, kind: "label", color };
  }
  // The cell itself is a colour, so the run paints its background.
  return { text: BLANK.repeat(layout.fits), slice: -1, kind: "cell", color };
}

function dataRow(row, layout) {
  const runs = [labelRun(row.label, layout)];
  for (const value of row.values.slice(0, layout.drawn)) runs.push(cellRun(value, layout));
  return { width: layout.width, runs };
}

function bodyRows(grid, columns, layout) {
  const rows = columns.length > 0 ? [headerRow(columns, layout)] : [];
  for (const row of grid) rows.push(dataRow(row, layout));
  return rows;
}

function scaleRow(layout) {
  // The two numbers share what the ramp leaves, so the scale is never wider
  // than the map above it.
  const size = Math.max(1, Math.min(12, Math.floor(layout.width * 0.25)));
  const room = Math.max(2, layout.width - size - 3);
  const minText = truncate(formatNumber(layout.min), Math.max(1, Math.floor(room / 2)));
  const maxText = truncate(formatNumber(layout.max), Math.max(1, room - cols(minText)));
  const ramp = Array.from({ length: size }, (_, index) => mixOklab(layout.low, layout.high, index / Math.max(1, size - 1)));
  return {
    width: layout.width,
    runs: [
      { text: ` ${minText} `, slice: -1, kind: "axis" },
      ...ramp.map((color) => ({ text: " ", slice: -1, kind: "cell", color })),
      { text: ` ${maxText}`, slice: -1, kind: "axis" },
    ],
  };
}

function appendNotes(rows, notes, width) {
  for (const note of notes) rows.push(...noteRows(note, width));
  return rows;
}

export function renderHeatmapRows(spec) {
  const width = resolveWidth(spec);
  const { columns, rows: grid } = normalizeGrid(spec);
  if (grid.length === 0) return prelude(spec, width, true);

  const count = countColumns(columns, grid);
  const notes = gridNotes(spec, grid, columns, count);
  const layout = heatLayout(spec, grid, columns, count, width);
  if (layout.drawn < count) notes.push(hiddenNote(count - layout.drawn));

  const rows = prelude(spec, width, false);
  rows.push(...bodyRows(grid, columns, layout));
  if (spec.scale !== false) rows.push(scaleRow(layout));
  return appendNotes(rows, notes, width);
}

export { DEFAULT_PALETTE, contrastOn };
