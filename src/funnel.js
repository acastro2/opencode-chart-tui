// Funnel rendering for a character grid.
//
// A funnel is one band per stage: the stage name, a bar whose length is the
// stage's value against the widest stage, and the value plus the conversion
// from the first stage. The bars are centred in the plot area, and the same bar
// is painted on every row of its band, so the bands stack into a stepped
// silhouette with vertical sides instead of a list of single bars.
//
// The conversion is measured from the first stage, not from the row above it:
// 1000, 500, 100 reads 100%, 50%, 10%. A later stage larger than the first is
// still drawn, and its conversion is above 100%, because hiding an increase
// would hide the thing a funnel is read for.

import {
  BLANK,
  SOLID,
  cols,
  formatNumber,
  formatPercent,
  padStart,
  showPercentOf,
  titleRow,
  truncate,
} from "./core.js";
import { layoutFor } from "./layout.js";
import { coerceList, policyFor } from "./values.js";
import { themeOf } from "./theme.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
/** The bar keeps at least this many cells; the text columns give way first. */
const MIN_PLOT = 3;
/** Rows a stage takes by default, so a funnel with no height still steps. */
const DEFAULT_STAGE_ROWS = 3;
/** A stage and its label are one record: a dropped value drops the label too. */
const FUNNEL_POLICY = policyFor("funnel");

/** The block that fills the left `fraction` of a cell, empty when there is none. */
function leftGlyph(fraction) {
  const step = Math.round(Math.max(0, Math.min(1, fraction)) * 8);
  return step >= 8 ? SOLID : step <= 0 ? "" : LEFT[step - 1];
}

/** Width the fence asks for, never below the library floor. */
function readWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/**
 * The stages in order, with the label that belongs to each value. A blank or
 * unreadable value is dropped with its label, the fate the value policy names.
 */
export function normalizeStages(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const raw = Array.isArray(spec.values) ? spec.values : [];
  const { values } = coerceList(raw, FUNNEL_POLICY);
  const stages = [];
  for (const [index, value] of values.entries()) {
    if (value === null) continue;
    stages.push({ label: String(labels[index] ?? index + 1), value });
  }
  return stages;
}

/**
 * The share of the first stage. `formatPercent` keeps one decimal, so a whole
 * percent drops its `.0` and the column reads `50%`, not `50.0%`.
 */
function conversion(value, base, index) {
  if (index === 0) return "100%";
  if (!(base > 0)) return "0%";
  return formatPercent(value, base).replace(/\.0%$/, "%");
}

/** The value and conversion text of every stage, before any column is cut. */
function stageTexts(stages) {
  const base = stages[0]?.value ?? 0;
  return stages.map((stage, index) => ({
    label: stage.label,
    value: stage.value,
    valueText: formatNumber(stage.value),
    percentText: conversion(stage.value, base, index),
  }));
}

function widestOf(texts) {
  return texts.reduce((widest, text) => Math.max(widest, cols(text)), 0);
}

/** The largest stage, never zero, so a bar fraction can divide by it. */
function largestOf(cells) {
  let largest = 0;
  for (const cell of cells) if (cell.value > largest) largest = cell.value;
  return largest || 1;
}

/**
 * The value and conversion columns, cut together until the bar has room. A
 * column keeps at least one cell; a pathological number is truncated rather
 * than allowed to push the row past the chart.
 */
function fitColumns(naturalValue, naturalPercent, room, showValue, showPercent) {
  const gaps = (showValue ? 1 : 0) + (showPercent ? 1 : 0);
  let value = showValue ? naturalValue : 0;
  let percent = showPercent ? naturalPercent : 0;
  while (gaps + value + percent > room) {
    if (value >= percent && value > 1) value -= 1;
    else if (percent > 1) percent -= 1;
    else break;
  }
  return { valueWidth: value, percentWidth: percent };
}

/** The gutter is the label's own width plus one space either side. */
function prefixWidth(labelWidth) {
  return labelWidth > 0 ? labelWidth + 2 : 0;
}

/** The label gutter: right-aligned, at most 40% of the chart, truncated. */
function fitLabel(widest, width, suffixWidth) {
  const cap = Math.max(4, Math.floor(width * 0.4));
  let labelWidth = Math.min(widest, cap);
  while (labelWidth > 0 && width - prefixWidth(labelWidth) - suffixWidth < MIN_PLOT) labelWidth -= 1;
  return labelWidth;
}

/** Every column width and the bar's own room, worked out once for all rows. */
function funnelGeometry(spec, stages) {
  const width = readWidth(spec);
  const showValue = spec.valueLabels !== false;
  const showPercent = showPercentOf(spec);
  const cells = stageTexts(stages);
  const naturalValue = showValue ? widestOf(cells.map((cell) => cell.valueText)) : 0;
  const naturalPercent = showPercent ? widestOf(cells.map((cell) => cell.percentText)) : 0;
  const columns = fitColumns(naturalValue, naturalPercent, width - MIN_PLOT, showValue, showPercent);
  const suffixWidth = (showValue ? 1 + columns.valueWidth : 0) + (showPercent ? 1 + columns.percentWidth : 0);
  const labelWidth = fitLabel(widestOf(cells.map((cell) => cell.label)), width, suffixWidth);
  return {
    width,
    cells,
    labelWidth,
    plotWidth: width - prefixWidth(labelWidth) - suffixWidth,
    valueWidth: columns.valueWidth,
    percentWidth: columns.percentWidth,
    showValue,
    showPercent,
    max: largestOf(cells),
  };
}

/**
 * The label gutter. Only the first row of a band carries the name; the rows
 * below it reserve the same columns as blank so the bars stay aligned.
 */
function gutterRuns(label, labelWidth) {
  if (labelWidth <= 0) return [];
  if (!label) return [{ text: BLANK.repeat(prefixWidth(labelWidth)), slice: -1, kind: "outside" }];
  return [{ text: ` ${padStart(truncate(label, labelWidth), labelWidth)} `, slice: -1, kind: "axis" }];
}

/** The bar is centred in the plot area: a funnel narrows towards the middle. */
function barRuns(cell, index, geometry) {
  const fraction = Math.max(0, Math.min(1, cell.value / geometry.max));
  const exact = fraction * geometry.plotWidth;
  const whole = Math.floor(exact);
  const edge = leftGlyph(exact - whole);
  const drawn = whole + (edge ? 1 : 0);
  const leftPad = Math.floor((geometry.plotWidth - drawn) / 2);
  const rightPad = geometry.plotWidth - leftPad - drawn;

  const runs = [];
  if (leftPad > 0) runs.push({ text: BLANK.repeat(leftPad), slice: -1, kind: "outside" });
  if (drawn > 0) runs.push({ text: `${SOLID.repeat(whole)}${edge}`, slice: index, kind: "fill" });
  if (rightPad > 0) runs.push({ text: BLANK.repeat(rightPad), slice: -1, kind: "outside" });
  return runs;
}

/**
 * The value and the conversion. The value is plain text on the chart
 * background, not a fill: a series colour there would read as another bar.
 */
function suffixRuns(cell, geometry, theme) {
  const runs = [];
  if (geometry.showValue) {
    runs.push({
      text: ` ${padStart(truncate(cell.valueText, geometry.valueWidth), geometry.valueWidth)}`,
      slice: -1,
      kind: "label",
      color: theme.foreground,
      background: theme.background,
    });
  }
  if (geometry.showPercent) {
    runs.push({
      text: ` ${padStart(truncate(cell.percentText, geometry.percentWidth), geometry.percentWidth)}`,
      slice: -1,
      kind: "axis",
    });
  }
  return runs;
}

function stageRow(cell, index, first, geometry, theme) {
  return {
    width: geometry.width,
    runs: [
      ...gutterRuns(first ? cell.label : "", geometry.labelWidth),
      ...barRuns(cell, index, geometry),
      ...(first ? suffixRuns(cell, geometry, theme) : []),
    ],
  };
}

/**
 * Rows one stage takes: the plot divided between the stages, never fewer than
 * two when two fit, and one when the height cannot give every stage two.
 */
function rowsPerStage(plotRows, stageCount) {
  if (stageCount <= 0) return 1;
  const fit = Math.floor(plotRows / stageCount);
  return fit >= 2 ? fit : 1;
}

/** A chart with no stages says so instead of drawing nothing. */
function emptyRows(width, title) {
  const head = title ? [titleRow(String(title), width)] : [];
  return [...head, { width, runs: [{ text: "  no data", slice: -1, kind: "legend" }] }];
}

export function renderFunnelRows(spec) {
  const width = readWidth(spec);
  const stages = normalizeStages(spec);
  if (stages.length === 0) return emptyRows(width, spec.title);

  // Height is the whole block. Every stage wants several rows so the bars stack
  // into a silhouette; when the plot cannot give two rows a stage, each stage
  // falls back to one row and only the stages that fit are drawn.
  const layout = layoutFor(spec, {
    title: spec.title ? 1 : 0,
    labels: 0,
    fallback: stages.length * DEFAULT_STAGE_ROWS,
    min: 3,
    max: 30,
  });
  const stageRows = rowsPerStage(layout.plotRows, stages.length);
  const drawn = stageRows > 1 ? stages.length : Math.min(stages.length, layout.plotRows);
  // Geometry is measured over every stage: the conversion base stays stage one
  // even when a tight height hides later stages.
  const geometry = funnelGeometry(spec, stages);
  const theme = themeOf(spec);
  const head = spec.title ? [titleRow(String(spec.title), width)] : [];
  const rows = [];
  for (const [index, cell] of geometry.cells.slice(0, drawn).entries()) {
    for (let line = 0; line < stageRows; line += 1) {
      rows.push(stageRow(cell, index, line === 0, geometry, theme));
    }
  }
  return [...head, ...rows];
}
