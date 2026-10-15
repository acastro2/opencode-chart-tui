// A gauge: one value against a maximum, with an optional target.
//
// It is one bar with a track behind it, a target marker, and the value spelled
// out, which is the shape a status row wants.

import {
  BLANK,
  SOLID,
  cols,
  formatNumber,
  formatPercent,
  padTo,
  titleRow,
  truncate,
} from "./core.js";
import { niceMax } from "./axis.js";

const LEFT = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const TRACK = "░";
const MARK = "│";

function leftGlyph(fraction) {
  const step = Math.round(Math.max(0, Math.min(1, fraction)) * 8);
  return step >= 8 ? SOLID : step <= 0 ? "" : LEFT[step - 1];
}

export function renderGaugeRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const value = Number(spec.value) || 0;
  const max = Number(spec.max) || niceMax(value) || 100;
  const target = spec.target === undefined ? null : Number(spec.target);
  const label = String(spec.label ?? "");

  const labelWidth = Math.min(cols(label), Math.max(4, Math.floor(width * 0.4)));
  const valueText = spec.percent === false ? `${formatNumber(value)}/${formatNumber(max)}` : formatPercent(value, max);
  const fullTarget = target === null ? "" : `  target ${formatNumber(target)}`;

  // Fit the row: the bar gives way first, then the target text, then the label.
  let barWidth = 3;
  let targetText = fullTarget;
  const overflows = (bar, target_) => labelWidth + 3 + bar + 1 + cols(valueText) + cols(target_) > width;
  if (overflows(barWidth, targetText)) targetText = "";
  if (overflows(barWidth, targetText)) {
    barWidth = Math.max(1, width - (labelWidth + 3) - 1 - cols(valueText));
  } else {
    barWidth = Math.max(3, width - (labelWidth + 3) - 1 - cols(valueText) - cols(targetText));
  }

  const rows = [];
  if (spec.title) rows.push(titleRow(String(spec.title), width));

  const exact = Math.max(0, Math.min(1, value / max)) * barWidth;
  const whole = Math.floor(exact);
  const edge = leftGlyph(exact - whole);
  const used = whole + (edge ? 1 : 0);
  const targetColumn = target === null ? -1 : Math.round((Math.max(0, Math.min(1, target / max)) * barWidth)) - 1;

  const runs = [{ text: ` ${padTo(truncate(label, labelWidth), labelWidth)} `, slice: -1, kind: "axis" }];
  if (whole > 0) runs.push({ text: SOLID.repeat(whole), slice: 0, kind: "fill" });
  if (edge) runs.push({ text: edge, slice: 0, kind: "fill" });

  for (let column = used; column < barWidth; column++) {
    if (column === targetColumn) {
      // The target inside the empty part of the bar: a plain marker on the track.
      runs.push({ text: MARK, slice: -1, kind: "target" });
      continue;
    }
    runs.push({ text: TRACK, slice: -1, kind: "track" });
  }

  // A target the bar has already passed sits inside the fill, so it is drawn as
  // a dark line over the bar colour, the same way a wedge boundary is drawn.
  if (targetColumn >= 0 && targetColumn < used) {
    let cursor = 0;
    for (const [index, run] of runs.entries()) {
      const length = cols(run.text);
      if (targetColumn >= cursor && targetColumn < cursor + length && index > 0) {
        const offset = targetColumn - cursor;
        const glyphs = [...run.text];
        const before = glyphs.slice(0, offset).join("");
        const after = glyphs.slice(offset + 1).join("");
        const replacement = [];
        if (before) replacement.push({ ...run, text: before });
        replacement.push({ text: MARK, slice: run.slice, kind: "line" });
        if (after) replacement.push({ ...run, text: after });
        runs.splice(index, 1, ...replacement);
        break;
      }
      cursor += length;
    }
  }

  runs.push({ text: ` ${valueText}`, slice: -1, kind: "fill" });
  if (targetText) runs.push({ text: targetText, slice: -1, kind: "axis" });

  rows.push({ width, runs });
  return rows;
}

export { BLANK };
