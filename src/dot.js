// A dot plot: one dot per value, one row per label, on one shared scale.
//
// Why: a ranking of twenty entries as horizontal bars is twenty rows of solid
// blocks, and the blocks carry more ink than the ranking. A dot puts the same
// position in one cell, so the eye reads the order, not the fill. The label
// column and the tick row are the only furniture: no track, no axis line.
//
// The scale is the plot's own: zero at the first column and the largest value at
// the last, so the dots fill the width they are given. The ticks come from
// `buildAxis`, which picks the round numbers; the placement of those ticks in
// columns, and their thinning, is this family's business.

import { BLANK, cols, formatNumber, padStart, titleRow, truncate } from "./core.js";
import { buildAxis, pointLabelLayout } from "./axis.js";
import { layoutFor } from "./layout.js";
import { coerce, policyFor } from "./values.js";

const DOT = "●";
const DOT_POLICY = policyFor("dot");
/** Below this many columns a plot says nothing about a value, so it is not drawn. */
const MIN_PLOT = 4;
/** The name column never takes more than this share of the row. */
const LABEL_SHARE = 0.3;
/** Ticks to ask `buildAxis` for. A narrow chart asks for fewer. */
const TICKS = 4;
const NARROW_TICKS = 3;
/** Below this many plot columns the tick labels need the room of fewer marks. */
const NARROW_PLOT = 20;
/** A vertical axis thins a tick per row; here the columns are the axis. */
const TALL_GRID = 40;

/** The row is 16 cells wide at the very least, whatever the fence asks. */
function readWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/**
 * The labels and their values, in the order that will be printed. A label with
 * no value is a zero, which is what the dot policy says; a value with no label
 * has nowhere to go, so it is not drawn.
 */
function readEntries(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const values = Array.isArray(spec.values) ? spec.values : [];
  const entries = labels.map((label, index) => ({
    label: String(label ?? ""),
    value: coerce(values[index], DOT_POLICY).value,
  }));
  return { entries: spec.sort === true ? rank(entries) : entries, count: values.length };
}

/** Largest first, and stable, so equal values keep the order they came in. */
function rank(entries) {
  return [...entries].sort((a, b) => b.value - a.value);
}

/** The name column: the widest label, capped so the plot keeps its room. */
function labelColumn(entries, width) {
  const widest = entries.reduce((best, entry) => Math.max(best, cols(entry.label)), 1);
  return Math.max(1, Math.min(widest, Math.floor(width * LABEL_SHARE)));
}

/** The widest value text, which is the column the labels are aligned in. */
function valueColumnWidth(texts) {
  return texts.reduce((best, text) => Math.max(best, cols(text)), 0);
}

/**
 * The row budget: the name column, the plot, and the value column when the
 * fence asks for it and the plot keeps its minimum room. A value column takes
 * its space from the plot, never from the row.
 */
function plotBudget(spec, entries, width) {
  const labelWidth = labelColumn(entries, width);
  const gutter = labelWidth + 1;
  const texts = entries.map((entry) => formatNumber(entry.value));
  const valueWidth = valueColumnWidth(texts);
  const room = width - gutter - (valueWidth + 1);
  const showValues = spec.valueLabels === true && room >= MIN_PLOT;
  const plotWidth = Math.max(1, width - gutter - (showValues ? valueWidth + 1 : 0));
  return { labelWidth, gutter, texts, valueWidth, showValues, plotWidth };
}

/** The largest value drawn: the scale's right end, never below zero. */
function maxValue(entries) {
  return entries.reduce((best, entry) => Math.max(best, entry.value), 0);
}

/**
 * The plot column of a value: the axis starts at the first column and the
 * largest value sits on the last, so the dots use the whole plot. A negative
 * value has nowhere to go on a scale from zero, so it stays at the start.
 */
function dotColumn(value, max, plotWidth) {
  if (plotWidth <= 1 || !(max > 0)) return 0;
  const fraction = Math.max(0, Math.min(1, value / max));
  return Math.round(fraction * (plotWidth - 1));
}

/**
 * The round tick values for a scale, ascending, none past the largest value.
 * `buildAxis` chooses the numbers; a grid tall enough that no tick is thinned by
 * a row keeps all of them, and the column placement below does the thinning a
 * horizontal axis needs.
 */
function tickValues(max, wanted) {
  const grid = buildAxis({ min: 0, max, plotRows: TALL_GRID, ticks: wanted });
  return grid.ticks.filter((tick) => tick.value <= max).sort((a, b) => a.value - b.value);
}

/**
 * The marks for the axis. A narrow plot asks for fewer marks so their labels can
 * fit; when that leaves fewer than three, the step was too coarse for this
 * range, so a finer step is asked for instead of a two-tick axis.
 */
function axisValues(max, plotWidth) {
  const wanted = plotWidth < NARROW_PLOT ? NARROW_TICKS : TICKS;
  const coarse = tickValues(max, wanted);
  return coarse.length >= 3 ? coarse : tickValues(max, wanted + 2);
}

/** The tick text and the plot column it belongs to: zero at the start, max at the end. */
function tickMarks(max, plotWidth, gutter) {
  return axisValues(max, plotWidth).map((tick) => ({
    text: formatNumber(tick.value),
    column: gutter + dotColumn(tick.value, max, plotWidth),
  }));
}

/** A run that carries no cells is not a run: it would only lengthen the frame. */
function keptRuns(runs) {
  return runs.filter((run) => run.text !== "");
}

/** One data row: the name in its gutter, then the dot in the shared plot. */
function dotRow(entry, index, geometry) {
  const { width, labelWidth, plotWidth, showValues, valueWidth, texts, max } = geometry;
  const column = dotColumn(entry.value, max, plotWidth);
  const runs = [
    { text: `${padStart(truncate(entry.label, labelWidth), labelWidth)} `, slice: -1, kind: "axis" },
    { text: BLANK.repeat(column), slice: -1, kind: "outside" },
    { text: DOT, slice: index, kind: "fill" },
    { text: BLANK.repeat(plotWidth - column - 1), slice: -1, kind: "outside" },
  ];
  if (showValues) runs.push({ text: ` ${padStart(texts[index], valueWidth)}`, slice: -1, kind: "axis" });
  return { width, runs: keptRuns(runs) };
}

/** The axis row: tick labels under the plot, each one centred on its column. */
function tickRow(marks, width) {
  const text = pointLabelLayout(
    marks.map((mark) => mark.text),
    width,
    marks.map((mark) => mark.column),
  ).text;
  return { width, runs: [{ text, slice: -1, kind: "axis" }] };
}

function noDataRow(width) {
  return { width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] };
}

/**
 * The rows of a dot plot: the title, one row per label, and the tick row under
 * them. `height` is the whole block, so the ledger pays for the title and the
 * tick row before the dots get their rows.
 */
export function renderDotRows(spec = {}) {
  const width = readWidth(spec);
  const title = spec.title ? [titleRow(String(spec.title), width)] : [];
  const { entries, count } = readEntries(spec);
  if (entries.length === 0) return [...title, noDataRow(width)];

  const plotRows = layoutFor(spec, {
    title: title.length,
    labels: 1,
    fallback: count + 1,
    min: 3,
    max: 30,
  }).plotRows;
  const shown = entries.slice(0, plotRows);
  const geometry = { ...plotBudget(spec, shown, width), width, max: maxValue(shown) };
  const marks = tickMarks(geometry.max, geometry.plotWidth, geometry.gutter);

  return [...title, ...shown.map((entry, index) => dotRow(entry, index, geometry)), tickRow(marks, width)];
}
