// A gauge: one value against a maximum, with an optional target.
//
// It is one bar with a track behind it, a target marker, and the value spelled
// out, which is the shape a status row wants.
//
// The row is a budget, so it never draws past its width. It gives way in this
// order: the bar, then the target text, then the label, then the value is cut,
// and only then dropped with a note. The value outlives the label because the
// value is the data.

import {
  BLANK,
  SOLID,
  cellsToRuns,
  cols,
  formatNumber,
  formatPercent,
  padTo,
  showPercentOf,
  titleRow,
  truncate,
} from "./core.js";
import { niceMax } from "./axis.js";
import { coerce, policyFor } from "./values.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const TRACK = "░";
const MARK = "│";
/** The narrowest the bar may get before the text has to give way. */
const MIN_BAR = 3;
/** Below this many cells a value says nothing useful, so it is dropped. */
const MIN_VALUE = 3;
/** The shared fate of the value: a blank and an unreadable one read as zero. */
const GAUGE_POLICY = policyFor("gauge");

function leftGlyph(fraction) {
  const step = Math.round(Math.max(0, Math.min(1, fraction)) * 8);
  return step >= 8 ? SOLID : step <= 0 ? "" : LEFT[step - 1];
}

/** The row is 16 cells wide at the very least, whatever the fence asks. */
function readWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

/** A value that is absent or unreadable reads as zero, the way the policy says. */
function readValue(spec) {
  return coerce(spec.value, GAUGE_POLICY).value;
}

/** The scale: the spec's own maximum, or one that fits the value, or 100. */
function readMax(spec, value) {
  return Number(spec.max) || niceMax(value) || 100;
}

/**
 * The target as a number, or null. An absent target is silent; an unreadable
 * one is named in a note, because guessing it would draw a lie.
 */
function readTarget(spec, notes) {
  const raw = spec.target;
  if (raw === undefined || raw === null) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    notes.push("target is not a number, ignored");
    return null;
  }
  return number;
}

/**
 * A target outside the scale still has a place on the bar: the first or the
 * last cell. It is said in a note, because the marker alone cannot show which.
 */
function clampTarget(target, max, notes) {
  if (target === null) return null;
  if (target > max) {
    notes.push(`target ${formatNumber(target)} clamped to ${formatNumber(max)}`);
    return max;
  }
  if (target < 0) {
    notes.push(`target ${formatNumber(target)} clamped to 0`);
    return 0;
  }
  return target;
}

/** The value and target text. The target text keeps the target as written. */
function gaugeTexts(spec, value, max, target) {
  const valueText = showPercentOf(spec) ? formatPercent(value, max) : `${formatNumber(value)}/${formatNumber(max)}`;
  const fullTarget = target === null ? "" : `  target ${formatNumber(target)}`;
  return { valueText, fullTarget };
}

/** The label block: the label and one space either side. */
function labelCells(labelWidth) {
  return labelWidth > 0 ? labelWidth + 2 : 0;
}

/** The value: one space, then the text. */
function valueCells(valueShown) {
  return valueShown ? 1 + cols(valueShown) : 0;
}

/** The cells left for the bar once the text has taken its share. */
function spareCells(width, labelWidth, valueShown, targetText) {
  return width - labelCells(labelWidth) - valueCells(valueShown) - cols(targetText);
}

/** The label may take two fifths of the row; a longer one is cut, not squeezed in. */
function labelWidthFor(width, label) {
  const room = Math.max(4, Math.floor(width * 0.4));
  return cols(label) === 0 ? 0 : Math.min(cols(label), room);
}

/** Cut the label until the bar has its minimum room, or until nothing is left. */
function shrinkLabel(width, labelWidth, valueText, targetText) {
  let current = labelWidth;
  while (current > 0 && spareCells(width, current, valueText, targetText) < MIN_BAR) {
    current = current <= 2 ? 0 : current - 1;
  }
  return current;
}

/** The value, cut to the room left. Too narrow to say anything: it is dropped. */
function cutValue(width, labelWidth, valueText, targetText, notes) {
  const room = width - labelCells(labelWidth) - cols(targetText) - 1 - MIN_BAR;
  if (room >= MIN_VALUE) return truncate(valueText, room);
  notes.push("value hidden at this width");
  return "";
}

/**
 * Spend the row: the target text goes first, then the label shrinks, then the
 * value is cut, and the bar takes what is left. Every step is measured with the
 * same cell count the runs will draw.
 */
function fitGauge(width, label, valueText, fullTarget, notes) {
  const natural = labelWidthFor(width, label);
  const targetText = spareCells(width, natural, valueText, fullTarget) < MIN_BAR ? "" : fullTarget;
  const labelWidth = shrinkLabel(width, natural, valueText, targetText);
  const tight = spareCells(width, labelWidth, valueText, targetText) < MIN_BAR;
  const valueShown = tight ? cutValue(width, labelWidth, valueText, targetText, notes) : valueText;
  const barWidth = Math.max(1, spareCells(width, labelWidth, valueShown, targetText));
  return { labelWidth, valueShown, targetText, barWidth };
}

/**
 * The target snaps to the cell whose left edge is nearest below it, so target 0
 * is column 0 and a target at the maximum is the bar's last cell.
 */
function targetColumnFor(targetValue, max, barWidth) {
  if (targetValue === null) return -1;
  const fraction = Math.max(0, Math.min(1, targetValue / max));
  return Math.min(barWidth - 1, Math.max(0, Math.floor(fraction * barWidth)));
}

/** How much of the bar is filled, and where the fractional end lands. */
function gaugeGeometry(value, max, barWidth, targetValue) {
  const exact = Math.max(0, Math.min(1, value / max)) * barWidth;
  const whole = Math.floor(exact);
  const edge = leftGlyph(exact - whole);
  const used = whole + (edge ? 1 : 0);
  const partial = edge && edge !== SOLID ? whole : -1;
  return { barWidth, whole, edge, used, partial, targetColumn: targetColumnFor(targetValue, max, barWidth) };
}

/** A filled cell: solid inside the whole part, the fractional glyph on its edge. */
function fillCell(column, whole, edge) {
  if (column < whole) return { char: SOLID, slice: 0, kind: "fill" };
  if (column === whole && edge) return { char: edge, slice: 0, kind: "fill" };
  return null;
}

/** One cell of the bar: the fill, the target marker, or the track. */
function barCell(column, whole, edge, targetColumn) {
  const fill = fillCell(column, whole, edge);
  if (fill) return fill;
  if (column === targetColumn) return { char: MARK, slice: -1, kind: "target" };
  return { char: TRACK, slice: -1, kind: "track" };
}

function gaugeCells(barWidth, { whole, edge, targetColumn }) {
  const cells = [];
  for (let column = 0; column < barWidth; column++) cells.push(barCell(column, whole, edge, targetColumn));
  return cells;
}

/** A target the bar has already passed sits inside the fill. */
function passedFill(targetColumn, used) {
  return targetColumn >= 0 && targetColumn < used;
}

// On the fractional end cell a line would hide the fraction, so there the
// marker moves one cell right, onto the track; with no track cell left the fill
// glyph keeps its place and takes the target colour.
function markOverFill(cells, { targetColumn, partial, barWidth, edge }) {
  if (partial === targetColumn && partial + 1 < barWidth) {
    cells[partial + 1] = { char: MARK, slice: -1, kind: "target" };
  } else if (partial === targetColumn) {
    cells[partial] = { char: edge, slice: -1, kind: "target" };
  } else {
    cells[targetColumn] = { char: MARK, slice: 0, kind: "line" };
  }
  return cells;
}

/** Draw the target: a marker on the track, or a line over the fill it passed. */
function paintTarget(cells, geometry) {
  return passedFill(geometry.targetColumn, geometry.used) ? markOverFill(cells, geometry) : cells;
}

function labelRun(label, labelWidth) {
  return { text: ` ${padTo(truncate(label, labelWidth), labelWidth)} `, slice: -1, kind: "axis" };
}

/**
 * The row's runs in order: label, bar, value, target. The value is a label, not
 * a fill: a background and a contrasting foreground make it readable on any
 * theme.
 */
function gaugeRuns({ labelWidth, label, cells, valueShown, targetText }) {
  const runs = [];
  if (labelWidth > 0) runs.push(labelRun(label, labelWidth));
  runs.push(...cellsToRuns(cells));
  if (valueShown) runs.push({ text: ` ${valueShown}`, slice: 0, kind: "label" });
  if (targetText) runs.push({ text: targetText, slice: -1, kind: "axis" });
  return runs;
}

/** One note per row, indented and cut to the row width. */
function noteRows(notes, width) {
  return notes.map((note) => ({
    width,
    runs: [{ text: truncate(`  ${note}`, width), slice: -1, kind: "legend" }],
  }));
}

export function renderGaugeRows(spec) {
  const width = readWidth(spec);
  const value = readValue(spec);
  const max = readMax(spec, value);
  const notes = [];
  const target = readTarget(spec, notes);
  const targetValue = clampTarget(target, max, notes);
  const label = String(spec.label ?? "");
  const { valueText, fullTarget } = gaugeTexts(spec, value, max, target);
  const fit = fitGauge(width, label, valueText, fullTarget, notes);
  const geometry = gaugeGeometry(value, max, fit.barWidth, targetValue);
  const cells = paintTarget(gaugeCells(fit.barWidth, geometry), geometry);
  const runs = gaugeRuns({ labelWidth: fit.labelWidth, label, cells, valueShown: fit.valueShown, targetText: fit.targetText });

  const rows = [];
  if (spec.title) rows.push(titleRow(String(spec.title), width));
  rows.push({ width, runs });
  return rows.concat(noteRows(notes, width));
}

export { BLANK };
