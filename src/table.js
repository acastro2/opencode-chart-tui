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
  DEFAULT_PALETTE,
  cols,
  mixOklab,
  padTo,
  titleRow,
  truncate,
} from "./core.js";
import { paletteOf, themeOf } from "./theme.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const HEAT_LOW = "#1f3b57";
const HEAT_HIGH = "#e5695f";
const MIN_WIDTH = 4;

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
  return columns.map((column, index) => {
    if (typeof column === "string") {
      return { index, key: column, label: column, type: "text", width: undefined };
    }
    return {
      index,
      key: column?.key ?? column?.label ?? String(index + 1),
      label: String(column?.label ?? column?.key ?? index + 1),
      type: String(column?.type ?? "text").toLowerCase(),
      width: Number.isFinite(Number(column?.width)) ? Number(column.width) : undefined,
      color: column?.color,
      showValue: column?.showValue,
      align: column?.align,
    };
  });
}

/** Rows may be arrays in column order, or objects keyed by a column's key. */
export function normalizeRows(spec, columns) {
  const raw = Array.isArray(spec.rows) ? spec.rows : [];
  return raw.map((row) => {
    if (Array.isArray(row)) return row;
    return columns.map((column) => row?.[column.key] ?? row?.[column.label] ?? "");
  });
}

/** The text a cell shows, per column type. */
function cellText(column, value) {
  if (column.type === "number" || column.type === "bar") return exact(value);
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Column widths from the content: a declared width wins, otherwise the widest
 * cell decides, and anything elastic gives way until the table fits the chart.
 */
export function columnWidths(columns, rows, width) {
  const natural = columns.map((column) => {
    if (column.width) return Math.max(MIN_WIDTH, Math.floor(column.width));
    let need = cols(column.label);
    for (const row of rows) need = Math.max(need, cols(cellText(column, row[column.index])));
    if (column.type === "bar" || column.type === "heat") {
      // A bar needs room for the number plus the bar itself.
      need += column.type === "bar" ? 3 : 0;
    }
    return Math.max(MIN_WIDTH, need);
  });

  const separators = Math.max(0, columns.length - 1) * 2;
  let total = natural.reduce((sum, value) => sum + value, 0) + separators;
  if (total <= width) return natural;

  // Over budget: take the difference out of the elastic columns, then out of
  // everything, and never below the floor.
  const elastic = columns.map((column) => column.type === "text" || column.type === "bar");
  let overflow = total - width;
  while (overflow > 0) {
    const growing = natural.map((value, index) => (elastic[index] && value > MIN_WIDTH ? index : -1)).filter((index) => index >= 0);
    const room = growing.length > 0 ? growing : natural.map((value, index) => (value > MIN_WIDTH ? index : -1)).filter((index) => index >= 0);
    if (room.length === 0) break;
    for (const index of room) {
      if (overflow <= 0) break;
      natural[index] -= 1;
      overflow -= 1;
    }
  }
  return natural;
}

export function renderTableRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const columns = normalizeColumns(spec);
  const rows = normalizeRows(spec, columns);
  const out = [];

  if (spec.title) out.push(titleRow(String(spec.title), width));
  if (columns.length === 0 || rows.length === 0) {
    out.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return out;
  }

  const widths = columnWidths(columns, rows, width);
  const rules = spec.rules !== false;

  // Header: labels only, so the table reads the same in plain text.
  const header = [];
  const rule = [];
  for (const [index, column] of columns.entries()) {
    if (index > 0) {
      header.push({ text: "  ", slice: -1, kind: "axis" });
      rule.push({ text: "  ", slice: -1, kind: "axis" });
    }
    const number = column.type === "number";
    header.push({
      text: number ? column.label.padStart(widths[index]) : padTo(truncate(column.label, widths[index]), widths[index]),
      slice: -1,
      kind: "title",
    });
    rule.push({ text: "─".repeat(widths[index]), slice: -1, kind: "axis" });
  }
  out.push({ width, runs: header });
  if (rules) out.push({ width, runs: rule });

  // Colour for a bar column: its own, or a palette entry per column.
  const theme = themeOf(spec);
  const palette = paletteOf(spec);
  const barColours = new Map();
  for (const column of columns) {
    if (column.type !== "bar") continue;
    barColours.set(column.index, column.color ?? palette[column.index % palette.length]);
  }

  // The scale of a bar or heat column is that column's own range.
  const ranges = new Map();
  for (const column of columns) {
    if (column.type !== "bar" && column.type !== "heat") continue;
    const values = rows.map((row) => Number(row[column.index])).filter((value) => Number.isFinite(value));
    ranges.set(column.index, { low: Math.min(0, ...values), high: Math.max(...values, 0) });
  }

  for (const row of rows) {
    const runs = [];
    for (const [index, column] of columns.entries()) {
      if (index > 0) runs.push({ text: "  ", slice: -1, kind: "axis" });
      const cellWidth = widths[index];
      const value = row[index];

      if (column.type === "bar") {
        const number = exact(value);
        const numberWidth = Number.isFinite(Number(value)) ? cols(number) : 0;
        const showValue = column.showValue !== false && numberWidth > 0 && cellWidth >= numberWidth + 2;
        const barWidth = Math.max(1, cellWidth - (showValue ? numberWidth + 1 : 0));
        const range = ranges.get(column.index) ?? { low: 0, high: 1 };
        const span = range.high - range.low || 1;
        const filledWidth = Math.max(0, Math.min(1, (Number(value) || 0) / span)) * barWidth;
        const whole = Math.floor(filledWidth);
        const edge = leftBlock(filledWidth - whole);
        const colour = barColours.get(column.index);
        if (whole > 0) runs.push({ text: "█".repeat(whole), slice: -1, kind: "fill", color: colour });
        if (edge) runs.push({ text: edge, slice: -1, kind: "fill", color: colour });
        const used = whole + (edge ? 1 : 0);
        if (used < barWidth) runs.push({ text: BLANK.repeat(barWidth - used), slice: -1, kind: "outside" });
        if (showValue) {
          runs.push({ text: ` ${number.padStart(numberWidth)}`, slice: -1, kind: "label", color: colour });
        }
        continue;
      }

      if (column.type === "heat") {
        const range = ranges.get(column.index) ?? { low: 0, high: 1 };
        const span = range.high - range.low || 1;
        const colour = mixOklab(column.color ?? column.low ?? theme.heat.low, column.high ?? theme.heat.high, ((Number(value) || 0) - range.low) / span);
        runs.push({ text: exact(value).padStart(cellWidth), slice: -1, kind: "label", color: colour });
        continue;
      }

      const text = cellText(column, value);
      const clipped = truncate(text, cellWidth);
      const right = column.type === "number" || column.align === "right";
      runs.push({
        text: right ? clipped.padStart(cellWidth) : padTo(clipped, cellWidth),
        slice: -1,
        kind: "text",
      });
    }
    out.push({ width: Math.min(width, out[0].width ?? width), runs });
  }

  return out;
}
