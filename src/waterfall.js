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
//
// The render is a chain of small steps, each with one job: normalise the
// steps, place the bars, paint the grid, lay the connectors and labels over it,
// then stamp the frame and the note rows. Each takes what the one before it
// produced, so every function stays readable on its own.

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
  truncate,
} from "./core.js";
import { themeOf } from "./theme.js";
import { axisRow, baseline, buildAxis, pointLabelLayout, pointLabelRow, subRowValue } from "./axis.js";
import { plotRows as plotRowsFor } from "./layout.js";

export const WATERFALL_UP = "#57c98a";
export const WATERFALL_DOWN = "#e5695f";
export const WATERFALL_TOTAL = "#4e9de0";

const UP = 0;
const DOWN = 1;
const TOTAL = 2;

// --- the steps -------------------------------------------------------------

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

/** Only the deltas that can be drawn, each with the index that names it. */
function finiteDeltas(values) {
  const pairs = [];
  for (const [index, raw] of values.entries()) {
    const delta = Number(raw);
    if (Number.isFinite(delta)) pairs.push([index, delta]);
  }
  return pairs;
}

function labelAt(labels, index) {
  return String(labels[index] ?? index + 1);
}

/** One floating step per delta, carrying the running total through. */
function stepList(labels, pairs, start) {
  const steps = [];
  let running = start;
  for (const [index, delta] of pairs) {
    steps.push({
      label: labelAt(labels, index),
      delta,
      from: running,
      to: running + delta,
      kind: delta >= 0 ? UP : DOWN,
    });
    running += delta;
  }
  return { steps, total: running };
}

/** The closing total is a level from zero, not a movement. */
function appendTotal(steps, total, spec) {
  if (spec.total === false || steps.length === 0) return steps;
  steps.push({ label: String(spec.totalLabel ?? "Total"), delta: total, from: 0, to: total, kind: TOTAL });
  return steps;
}

/** Steps from a list of deltas: where each one starts, ends and which way it went. */
export function normalizeSteps(spec) {
  const { steps, total } = stepList(arrayOf(spec.labels), finiteDeltas(arrayOf(spec.values)), Number(spec.start) || 0);
  return { steps: appendTotal(steps, total, spec), total };
}

// --- the colours -----------------------------------------------------------

function totalColour(spec) {
  return spec.totalColor ?? themeOf(spec).palette[0];
}

function upColour(spec) {
  return spec.up ?? themeOf(spec).palette[1];
}

function downColour(spec) {
  return spec.down ?? themeOf(spec).palette[3];
}

/** Colour of a step: the direction it moved the total in, or the total itself. */
function colourOf(kind, spec) {
  if (kind === TOTAL) return totalColour(spec);
  return kind === UP ? upColour(spec) : downColour(spec);
}

// --- the geometry ----------------------------------------------------------

/** A plot cell that already holds something, so a label cannot take it. */
function occupied(cell) {
  return Boolean(cell) && cell.char !== " ";
}

/**
 * Bar geometry in sub-columns. Kept separate so the category-label pre-check can
 * place the labels before the render decides whether the note row costs a row.
 */
function placeBars(count, available, columns) {
  const subColumns = available * columns;
  // One clear column between bars, and a short chart sits in the middle of a
  // wide one instead of hugging the axis. When there are more steps than
  // columns, the marks narrow to sub-cells instead of running past the grid: a
  // step that cannot fit in a column still gets a sub-column of its own.
  const perStep = Math.max(1, Math.floor(subColumns / count));
  const barGap = Math.min(columns, perStep - 1);
  const barWidth = Math.max(1, Math.min(4 * columns, perStep - barGap));
  const subStride = barWidth + barGap;
  const used = count * subStride - barGap;
  const leftPad = Math.max(0, Math.floor((subColumns - used) / 2 / columns)) * columns;
  const starts = Array.from({ length: count }, (_, index) => leftPad + index * subStride);
  // Where each bar sits, in plot cells: the labels centre on their own bar.
  const centres = starts.map((start) => (start + (barWidth - 1) / 2) / columns);
  return { subColumns, barGap, barWidth, subStride, leftPad, starts, centres };
}

function chartWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** The rows around the plot: the category row, plus the title and the legend. */
function chromeRows(spec, extraChrome) {
  const title = spec.title ? 1 : 0;
  const legend = spec.legend !== false ? 1 : 0;
  return title + legend + 1 + extraChrome;
}

/**
 * The axis, the bar slots and the category-label count, all from one plot
 * height. The label count is part of the layout because the render budgets the
 * note row from it before it knows whether it can afford one.
 */
function plotLayout(steps, spec, width, chrome) {
  const sampler = makeSampler(spec.mosaic);
  const { columns, rows: rowsPerCell } = sampler.shape;
  const values = steps.flatMap((step) => [step.from, step.to]);
  const labels = steps.map((step) => step.label);
  const plotRows = plotRowsFor(spec, { chrome, fallback: 9 });
  const axis = buildAxis({
    min: Math.min(0, ...values),
    max: Math.max(0, ...values),
    plotRows,
    ticks: spec.ticks ?? 4,
  });
  const available = Math.max(1, width - axis.gutter);
  const bars = placeBars(steps.length, available, columns);
  const hiddenLabels = pointLabelLayout(labels, available, bars.centres, { shift: true }).dropped;
  return { plotRows: axis.plotRows, axis, available, bars, hiddenLabels, sampler, columns, rowsPerCell };
}

// --- the bars --------------------------------------------------------------

/** Fill the sub-cells one step covers, between its two totals. */
function fillBar(grid, step, start, barWidth, subColumns, axis, subRows) {
  const low = Math.min(step.from, step.to);
  const high = Math.max(step.from, step.to);
  for (let x = Math.max(0, start); x < Math.min(subColumns, start + barWidth); x++) {
    // A bar must never wrap into the next row: the axis bounds the value and
    // the grid bounds the column.
    for (let y = 0; y < subRows; y++) {
      const value = subRowValue(axis, y, subRows);
      if (value >= low && value <= high) grid[y * subColumns + x] = step.kind;
    }
  }
}

function paintBars(grid, steps, bars, axis, subRows) {
  for (const [index, step] of steps.entries()) {
    fillBar(grid, step, bars.starts[index], bars.barWidth, bars.subColumns, axis, subRows);
  }
}

/** One cell from the series grid, or null when no bar reaches it. */
function sampleCell(seriesAt, x, y, sampler, spec) {
  const { mask, tally, masks } = tallyFromGrid(seriesAt, x, y, sampler);
  if (tally.size === 0) return null;
  const cell = paintCell({ sampler, mask, tally, masks, glyphs: [SOLID, SOLID, SOLID] });
  cell.color = colourOf(cell.slice, spec);
  return cell;
}

function paintSeriesCells(cells, grid, bars, plotRows, available, sampler, spec) {
  const seriesAt = (x, y) => grid[y * bars.subColumns + x] ?? -1;
  for (let y = 0; y < plotRows; y++) {
    for (let x = 0; x < available; x++) {
      const cell = sampleCell(seriesAt, x, y, sampler, spec);
      if (cell) cells[y][x] = cell;
    }
  }
}

// --- the connectors --------------------------------------------------------

/**
 * The gap between one bar and the next, in plot columns, or null when the bars
 * touch. The gap is measured in sub-columns, so a bar that fills its whole
 * column has no gap and no connector.
 */
function connectorSpan(bars, index, columns) {
  const from = bars.starts[index] + bars.barWidth;
  const to = bars.starts[index + 1];
  if (to <= from) return null;
  return { from: Math.ceil(from / columns), to: Math.floor(to / columns) - 1 };
}

/** Draw the connector across the gap, leaving any cell that already holds one. */
function paintSpan(rowCells, span, available) {
  for (let x = span.from; x <= span.to; x++) {
    if (x < 0 || x >= available || rowCells[x]) continue;
    rowCells[x] = { slice: -1, char: "─", kind: "axis" };
  }
}

/** The level the running total reached, carried across the gap to the next bar. */
function paintConnectors(cells, steps, bars, axis, plotRows, available, columns) {
  for (const [index, step] of steps.slice(0, -1).entries()) {
    const row = Math.max(0, Math.min(plotRows - 1, axis.rowOf(step.to)));
    const span = connectorSpan(bars, index, columns);
    if (!span) continue;
    paintSpan(cells[row], span, available);
  }
}

/** The zero row stays visible where no bar covers it. */
function paintZeroRow(cells, axis, available) {
  for (let x = 0; x < available && axis.zeroRow >= 0; x++) {
    if (!cells[axis.zeroRow][x]) cells[axis.zeroRow][x] = { slice: -1, char: "─", kind: "axis" };
  }
}

// --- the value labels ------------------------------------------------------

/** The sign is the story, so a delta always carries one. */
function signedValue(delta) {
  return `${delta >= 0 ? "+" : ""}${formatNumber(delta)}`;
}

/** One clear cell on each side, so the label does not touch the next one. */
function neighboursClear(rowCells, from, textWidth, available) {
  if (from > 0 && occupied(rowCells[from - 1])) return false;
  if (from + textWidth < available && occupied(rowCells[from + textWidth])) return false;
  return true;
}

function spanClear(rowCells, from, textWidth) {
  for (let offset = 0; offset < textWidth; offset++) {
    if (occupied(rowCells[from + offset])) return false;
  }
  return true;
}

/** Can the label sit in this row without covering a neighbour? */
function labelRoom(cells, { row, from, textWidth, available, barCells }) {
  // The positive form matters: a non-numeric width leaves the geometry NaN, and
  // every comparison against NaN has to fail the same way it always did.
  if (!(row >= 0 && textWidth <= barCells + 1 && from + textWidth <= available)) return false;
  const rowCells = cells[row];
  return neighboursClear(rowCells, from, textWidth, available) && spanClear(rowCells, from, textWidth);
}

function stampLabel(rowCells, from, text, color) {
  const glyphs = [...text];
  for (let offset = 0; offset < glyphs.length; offset++) {
    rowCells[from + offset] = { slice: -1, char: glyphs[offset], kind: "label", color };
  }
}

/** A delta above its own bar, or false when the row is taken. */
function placeValueLabel(cells, step, index, context) {
  const { layout, columns, spec, barCells } = context;
  const { starts, barWidth } = layout.bars;
  const text = signedValue(step.delta);
  const textWidth = cols(text);
  // Centre the label over its bar: a label pinned to the bar's left edge runs
  // into the neighbour ("+10-4" reads as one number).
  const centre = (starts[index] + (barWidth - 1) / 2) / columns;
  const from = Math.max(0, Math.min(layout.available - textWidth, Math.round(centre - (textWidth - 1) / 2)));
  const top = Math.max(0, Math.min(layout.plotRows - 1, layout.axis.rowOf(Math.max(step.from, step.to))));
  const row = top - 1;
  if (!labelRoom(cells, { row, from, textWidth, available: layout.available, barCells })) return false;
  stampLabel(cells[row], from, text, colourOf(step.kind, spec));
  return true;
}

/** Count the labels that had no room, so the footer can say how many. */
function paintValueLabels(cells, steps, layout, columns, spec) {
  if (spec.valueLabels === false) return 0;
  const barCells = Math.max(1, Math.ceil(layout.bars.barWidth / columns));
  let omitted = 0;
  for (const [index, step] of steps.entries()) {
    if (!placeValueLabel(cells, step, index, { layout, columns, spec, barCells })) omitted += 1;
  }
  return omitted;
}

// --- the rows --------------------------------------------------------------

function plotRowRuns(cells, axis, available, width) {
  const rows = [];
  for (let row = 0; row < axis.plotRows; row++) {
    const line = cells[row].map((cell) => cell ?? { slice: -1, char: BLANK, kind: "outside" });
    const frame = row === axis.zeroRow ? baseline(axis, available) : axisRow(axis, row);
    rows.push({
      width,
      runs: [{ text: `${frame.text}${frame.mark}`, slice: -1, kind: "axis" }, ...cellsToRuns(line)],
    });
  }
  return rows;
}

function categoryRowFor(steps, layout, width) {
  return {
    width,
    runs: [
      { text: " ".repeat(layout.axis.gutter), slice: -1, kind: "axis" },
      {
        text: pointLabelRow(steps.map((step) => step.label), layout.available, layout.bars.centres, { shift: true }),
        slice: -1,
        kind: "axis",
      },
    ],
  };
}

function pushNote(rows, note) {
  if (note) rows.push(note);
}

// The category row thins labels that would collide. Say so, with the count,
// because a reader cannot tell a missing step from a step that had no label.
function hiddenLabelNote(hidden, width) {
  if (hidden <= 0) return null;
  const noun = hidden === 1 ? "label" : "labels";
  return { width, runs: [{ text: truncate(`${hidden} ${noun} hidden`, width), slice: -1, kind: "legend" }] };
}

function omittedLabelNote(omitted, width) {
  if (omitted <= 0) return null;
  const noun = omitted === 1 ? "label" : "labels";
  return { width, runs: [{ text: truncate(`${omitted} value ${noun} omitted`, width), slice: -1, kind: "legend" }] };
}

// --- the legend ------------------------------------------------------------

function legendMarks(kinds, spec) {
  const marks = [];
  if (kinds.has(UP)) marks.push(["▲", "up", colourOf(UP, spec)]);
  if (kinds.has(DOWN)) marks.push(["▼", "down", colourOf(DOWN, spec)]);
  if (kinds.has(TOTAL)) marks.push(["■", "total", colourOf(TOTAL, spec)]);
  return marks;
}

function entryWidth([mark, label]) {
  return cols(mark) + 1 + cols(label);
}

function pushEntry(runs, [mark, label, color], gap) {
  if (gap > 0) runs.push({ text: "  ", slice: -1, kind: "legend" });
  runs.push({ text: `${mark} `, slice: -1, kind: "legend-mark", color });
  runs.push({ text: label, slice: -1, kind: "legend" });
}

/** The ellipsis that says an entry did not fit, as long as the width allows. */
function legendTail(used, width) {
  if (used + 2 <= width) return "  …";
  return used + 1 <= width ? " …" : "";
}

function finishLegend(runs, used, width, kept, total) {
  if (kept === 0) return null;
  if (kept < total) {
    const tail = legendTail(used, width);
    if (tail) runs.push({ text: tail, slice: -1, kind: "legend" });
  }
  return runs;
}

/**
 * The legend, cut to the width: a narrow chart keeps the entries that fit and
 * ends with an ellipsis, so the row never runs past the frame and the reader can
 * see that an entry was left out.
 */
function legendRuns(marks, width) {
  const runs = [];
  let used = 0;
  let kept = 0;
  for (const entry of marks) {
    const gap = kept > 0 ? 2 : 0;
    const entrySize = entryWidth(entry);
    if (used + gap + entrySize > width) break;
    pushEntry(runs, entry, gap);
    used += gap + entrySize;
    kept += 1;
  }
  return finishLegend(runs, used, width, kept, marks.length);
}

/** One direction needs no legend; two or more do. */
function legendRow(steps, spec, width) {
  if (spec.legend === false) return null;
  const marks = legendMarks(new Set(steps.map((step) => step.kind)), spec);
  if (marks.length <= 1) return null;
  const legend = legendRuns(marks, width);
  return legend ? { width, runs: legend } : null;
}

// --- the render ------------------------------------------------------------

function emptyRows(spec, width) {
  const rows = spec.title ? [titleRow(String(spec.title), width)] : [];
  rows.push({ width, runs: [{ text: "no data", slice: -1, kind: "legend" }] });
  return rows;
}

/** Paint every layer of the plot onto one grid of cells, in draw order. */
function paintedCells(steps, spec, layout) {
  const { sampler, columns, rowsPerCell, bars, plotRows, available, axis } = layout;
  const subRows = plotRows * rowsPerCell;
  const grid = new Int8Array(bars.subColumns * subRows).fill(-1);
  paintBars(grid, steps, bars, axis, subRows);
  const cells = Array.from({ length: plotRows }, () => Array.from({ length: available }, () => null));
  paintSeriesCells(cells, grid, bars, plotRows, available, sampler, spec);
  paintConnectors(cells, steps, bars, axis, plotRows, available, columns);
  paintZeroRow(cells, axis, available);
  const omitted = paintValueLabels(cells, steps, layout, columns, spec);
  return { cells, omitted };
}

function drawWaterfall(spec, extraChrome = 0) {
  const width = chartWidth(spec);
  const { steps } = normalizeSteps(spec);
  if (steps.length === 0) return emptyRows(spec, width);

  const layout = plotLayout(steps, spec, width, chromeRows(spec, extraChrome));
  const { cells, omitted } = paintedCells(steps, spec, layout);

  const rows = [];
  if (spec.title) rows.push(titleRow(String(spec.title), width));
  rows.push(...plotRowRuns(cells, layout.axis, layout.available, width));
  rows.push(categoryRowFor(steps, layout, width));
  pushNote(rows, hiddenLabelNote(layout.hiddenLabels, width));
  pushNote(rows, omittedLabelNote(omitted, width));
  pushNote(rows, legendRow(steps, spec, width));
  return rows;
}

function rowHeight(spec) {
  return Number(spec?.height);
}

function fixedPlotHeight(spec) {
  return Number(spec?.plotHeight) > 0;
}

/** The total block `height` allows, or null when the plot height is fixed. */
function rowBudget(spec) {
  const budget = rowHeight(spec);
  if (fixedPlotHeight(spec)) return null;
  if (!Number.isFinite(budget) || budget <= 0) return null;
  return Math.max(1, Math.floor(budget));
}

/**
 * Render the fence, keeping `height` as the total block: a note is a row too,
 * so when notes push the block past its budget the plot gives up a row or two.
 * `plotHeight` is exempt, because it names the plot rows on purpose.
 */
export function renderWaterfallRows(spec) {
  const first = drawWaterfall(spec, 0);
  const budget = rowBudget(spec);
  if (budget === null) return first;
  if (first.length <= budget) return first;
  for (let extra = 1; extra <= 3; extra++) {
    const attempt = drawWaterfall(spec, extra);
    if (attempt.length <= budget) return attempt;
  }
  // No layout fits (two notes and a minimum plot), so the first render stands
  // and the note still tells the truth about the drawing.
  return first;
}
