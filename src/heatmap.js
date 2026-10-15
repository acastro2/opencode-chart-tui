// A heat map: one cell per value, coloured along a ramp, with an optional
// number inside the cell.
//
// The colour is computed per cell rather than taken from the palette, so a run
// carries its own colour (`color`) the same way a series grid carries a slice.

import {
  BLANK,
  DEFAULT_PALETTE,
  cols,
  contrastOn,
  formatNumber,
  mixOklab,
  padTo,
  titleRow,
  truncate,
} from "./core.js";
import { themeOf } from "./theme.js";

export const HEAT_LOW = "#1f3b57";
export const HEAT_HIGH = "#e5695f";

/**
 * Accept a grid of numbers, rows of { label, values }, or series where each
 * series is a row. Returns rows of labels and values plus the column labels.
 */
export function normalizeGrid(spec) {
  // "headers" is the name for a heat map's column labels; "columns" was the old
  // one and still reads, so an older fence keeps working.
  const source = Array.isArray(spec.headers) ? spec.headers : Array.isArray(spec.columns) ? spec.columns : [];
  const columns = source.map((text) => String(text));
  const rows = [];

  if (Array.isArray(spec.rows)) {
    for (const [index, row] of spec.rows.entries()) {
      const values = (Array.isArray(row) ? row : row?.values ?? []).map((value) => Number(value) || 0);
      const label = Array.isArray(row) ? String(index + 1) : String(row?.label ?? index + 1);
      if (values.length > 0) rows.push({ label, values });
    }
  } else if (Array.isArray(spec.values) && Array.isArray(spec.values[0])) {
    for (const [index, values] of spec.values.entries()) {
      rows.push({
        label: String(spec.labels?.[index] ?? index + 1),
        values: values.map((value) => Number(value) || 0),
      });
    }
  } else if (Array.isArray(spec.series)) {
    for (const [index, item] of spec.series.entries()) {
      const values = (item?.values ?? item ?? []).map((value) => Number(value) || 0);
      if (values.length > 0) rows.push({ label: String(item?.name ?? index + 1), values });
    }
  }

  return { columns, rows };
}

export function renderHeatmapRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const { columns, rows: grid } = normalizeGrid(spec);
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));
  if (grid.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  // The widest header label sets the default cell width: a column cut to "9…"
  // is a bug, not a style, so the cells grow to fit the labels unless the caller
  // pins a width. An explicit cellWidth still truncates, by design.
  const widest = columns.length > 0 ? Math.max(...columns.map((text) => cols(String(text)))) : 0;
  const cellWidth = Math.max(1, Math.min(8, Math.floor(spec.cellWidth ?? Math.max(2, widest + 1))));
  const theme = themeOf(spec);
  const low = spec.low ?? spec.from ?? theme.heat.low;
  const high = spec.high ?? spec.to ?? theme.heat.high;
  const values = grid.flatMap((row) => row.values);
  const min = spec.min !== undefined ? Number(spec.min) : Math.min(...values);
  const max = spec.max !== undefined ? Number(spec.max) : Math.max(...values);
  const span = max - min || 1;

  const labelWidth = Math.min(
    Math.max(...grid.map((row) => cols(row.label)), 1),
    Math.max(4, Math.floor(width * 0.3)),
  );
  const count = Math.max(1, columns.length || grid[0].values.length);
  // The requested cell width, never wider than the space the row actually has.
  const fits = Math.max(1, Math.min(cellWidth, Math.floor((width - labelWidth - 2) / count)));

  if (columns.length > 0) {
    const header = columns
      // Right-aligned inside its cell, the same as the numbers below it.
      .map((text) => truncate(text, fits).padStart(fits))
      .join("")
      .slice(0, width - labelWidth - 2);
    rows.push({
      width,
      runs: [
        { text: BLANK.repeat(labelWidth + 2), slice: -1, kind: "axis" },
        { text: header, slice: -1, kind: "axis" },
      ],
    });
  }

  for (const row of grid) {
    const runs = [{ text: ` ${padTo(truncate(row.label, labelWidth), labelWidth)} `, slice: -1, kind: "axis" }];
    for (const value of row.values) {
      const amount = (value - min) / span;
      const color = mixOklab(low, high, amount);
      const text = formatNumber(value);
      if (spec.valueLabels !== false && cols(text) <= fits) {
        runs.push({ text: text.padStart(fits), slice: -1, kind: "label", color });
      } else {
        // The cell itself is a colour, so the run paints its background.
        runs.push({ text: BLANK.repeat(fits), slice: -1, kind: "cell", color });
      }
    }
    rows.push({ width, runs });
  }

  if (spec.scale !== false) {
    const size = Math.max(4, Math.min(12, Math.floor(width * 0.25)));
    const ramp = Array.from({ length: size }, (_, index) => mixOklab(low, high, index / Math.max(1, size - 1)));
    rows.push({
      width,
      runs: [
        { text: ` ${padTo(formatNumber(min), 6)} `, slice: -1, kind: "axis" },
        ...ramp.map((color) => ({ text: " ", slice: -1, kind: "cell", color })),
        { text: ` ${formatNumber(max)}`, slice: -1, kind: "axis" },
      ],
    });
  }

  return rows;
}

export { DEFAULT_PALETTE, contrastOn };
