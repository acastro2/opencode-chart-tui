// A waterfall: a running total drawn as floating bars.
//
// A waterfall is not a bar chart. Each step is a bar that spans from the total
// before it to the total after it, so the reader sees what moved and where it
// landed. A thin connector sits between one bar and the next at the level the
// running total reached, which is what makes the story readable. The final
// total starts from zero, because it is a level rather than a movement.
//
// Bars are sampled per sub-row against the shared axis, the same way bars and
// candles are, so both ends of a floating bar are placed at sub-cell precision.

import {
  BLANK,
  SOLID,
  cellsToRuns,
  cols,
  formatNumber,
  makeSampler,
  paintCell,
  tallyFromGrid,
  titleRow,
} from "./core.js";
import { themeOf } from "./theme.js";
import { axisRow, baseline, buildAxis, pointLabelRow, subRowValue } from "./axis.js";

export const WATERFALL_UP = "#57c98a";
export const WATERFALL_DOWN = "#e5695f";
export const WATERFALL_TOTAL = "#4e9de0";

const UP = 0;
const DOWN = 1;
const TOTAL = 2;

/** Steps from a list of deltas: where each one starts, ends and which way it went. */
export function normalizeSteps(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const values = Array.isArray(spec.values) ? spec.values : [];
  const steps = [];
  let running = Number(spec.start) || 0;

  for (const [index, raw] of values.entries()) {
    const delta = Number(raw);
    if (!Number.isFinite(delta)) continue;
    const from = running;
    running += delta;
    steps.push({
      label: String(labels[index] ?? index + 1),
      delta,
      from,
      to: running,
      kind: delta >= 0 ? UP : DOWN,
    });
  }

  if (spec.total !== false && steps.length > 0) {
    steps.push({
      label: String(spec.totalLabel ?? "Total"),
      delta: running,
      from: 0,
      to: running,
      kind: TOTAL,
    });
  }

  return { steps, total: running };
}

/** Colour of a step: the direction it moved the total in, or the total itself. */
function colourOf(kind, spec) {
  const palette = themeOf(spec).palette;
  if (kind === TOTAL) return spec.totalColor ?? palette[0];
  return kind === UP ? spec.up ?? palette[1] : spec.down ?? palette[3];
}

export function renderWaterfallRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const { steps } = normalizeSteps(spec);
  const rows = [];

  if (spec.title) rows.push(titleRow(String(spec.title), width));
  if (steps.length === 0) {
    rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const plotRows = Math.max(3, Math.min(30, Math.floor(spec.height ?? 9)));
  const values = steps.flatMap((step) => [step.from, step.to]);
  const axis = buildAxis({
    min: Math.min(0, ...values),
    max: Math.max(0, ...values),
    plotRows,
    ticks: spec.ticks ?? 4,
  });
  const available = Math.max(1, width - axis.gutter);

  // One clear column between bars, and a short chart sits in the middle of a
  // wide one instead of hugging the axis.
  const barWidth = Math.max(1, Math.min(4, Math.floor(available / Math.max(1, steps.length)) - 1)) || 1;
  const stride = barWidth + 1;
  const used = steps.length * stride - 1;
  const leftPad = Math.max(0, Math.floor((available - used) / 2));

  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: rowsPerCell } = sampler.shape;
  const subColumns = available * columns;
  const subRows = plotRows * rowsPerCell;

  const grid = new Int8Array(subColumns * subRows).fill(-1);
  const starts = [];
  for (const [index, step] of steps.entries()) {
    const start = (leftPad + index * stride) * columns;
    const end = start + barWidth * columns;
    starts.push(start / columns);
    const low = Math.min(step.from, step.to);
    const high = Math.max(step.from, step.to);
    for (let x = start; x < end; x++) {
      for (let y = 0; y < subRows; y++) {
        const value = subRowValue(axis, y, subRows);
        if (value >= low && value <= high) grid[y * subColumns + x] = step.kind;
      }
    }
  }

  const cells = Array.from({ length: plotRows }, () => Array.from({ length: available }, () => null));
  const seriesAt = (x, y) => grid[y * subColumns + x] ?? -1;
  for (let y = 0; y < plotRows; y++) {
    for (let x = 0; x < available; x++) {
      const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
      if (tally.size === 0) continue;
      const cell = paintCell({ sampler, mask, tally, masks, glyphs: [SOLID, SOLID, SOLID] });
      cell.color = colourOf(cell.slice, spec);
      cells[y][x] = cell;
    }
  }

  // The connector: the level the running total reached, carried across the gap
  // to the next bar.
  for (const [index, step] of steps.slice(0, -1).entries()) {
    const row = Math.max(0, Math.min(plotRows - 1, axis.rowOf(step.to)));
    for (let x = starts[index] + barWidth; x < starts[index + 1]; x++) {
      if (x < 0 || x >= available || cells[row][x]) continue;
      cells[row][x] = { slice: -1, char: "─", kind: "axis" };
    }
  }

  // The zero row stays visible where no bar covers it.
  for (let x = 0; x < available && axis.zeroRow >= 0; x++) {
    if (!cells[axis.zeroRow][x]) cells[axis.zeroRow][x] = { slice: -1, char: "─", kind: "axis" };
  }

  // A delta above its own bar, signed, because the sign is the story.
  if (spec.valueLabels !== false) {
    for (const [index, step] of steps.entries()) {
      const text = `${step.delta >= 0 ? "+" : ""}${formatNumber(step.delta)}`;
      if (cols(text) > barWidth + 1) continue;
      const top = Math.max(0, Math.min(plotRows - 1, axis.rowOf(Math.max(step.from, step.to))));
      const row = top - 1;
      if (row < 0) continue;
      const from = starts[index];
      if (from + cols(text) > available) continue;
      let free = true;
      for (let offset = 0; offset < cols(text); offset++) {
        const cell = cells[row][from + offset];
        if (cell && cell.char !== " ") free = false;
      }
      if (!free) continue;
      const glyphs = [...text];
      for (let offset = 0; offset < glyphs.length; offset++) {
        cells[row][from + offset] = { slice: -1, char: glyphs[offset], kind: "label", color: colourOf(step.kind, spec) };
      }
    }
  }

  for (let row = 0; row < axis.plotRows; row++) {
    const line = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
    if (row === axis.zeroRow) {
      const base = baseline(axis, available);
      rows.push({
        width,
        runs: [{ text: `${base.text}${base.mark}`, slice: -1, kind: "axis" }, ...cellsToRuns(line)],
      });
      continue;
    }
    const gutter = axisRow(axis, row);
    rows.push({
      width,
      runs: [{ text: `${gutter.text}${gutter.mark}`, slice: -1, kind: "axis" }, ...cellsToRuns(line)],
    });
  }

  rows.push({
    width,
    runs: [
      { text: " ".repeat(axis.gutter), slice: -1, kind: "axis" },
      { text: pointLabelRow(steps.map((step) => step.label), available), slice: -1, kind: "axis" },
    ],
  });

  if (spec.legend !== false) {
    const kinds = new Set(steps.map((step) => step.kind));
    const marks = [];
    if (kinds.has(UP)) marks.push(["▲", "up", colourOf(UP, spec)]);
    if (kinds.has(DOWN)) marks.push(["▼", "down", colourOf(DOWN, spec)]);
    if (kinds.has(TOTAL)) marks.push(["■", "total", colourOf(TOTAL, spec)]);
    if (marks.length > 1) {
      rows.push({
        width,
        runs: marks.flatMap(([mark, label, color]) => [
          { text: `${mark} `, slice: -1, kind: "legend-mark", color },
          { text: `${label}  `, slice: -1, kind: "legend" },
        ]),
      });
    }
  }

  return rows;
}
