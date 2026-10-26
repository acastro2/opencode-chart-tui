// Canonical run frames: what each run *is* and how it *looks*, not only its
// text.
//
// Why: a text golden cannot see a kind demoted from `fill` to `outside`, a
// slice that moved to the wrong series, or a palette swap that leaves every
// glyph in place. This projects the layout through the real style contract, so
// a change in colour or ownership is a reviewable diff in
// `test/golden/_runs.json` even when every character stays the same.
//
// One shape, fixed on purpose: `{ text, kind, slice, fg, bg }`. `fg` and `bg`
// are null when a run sets no colour, so JSON has one representation of "unset"
// instead of three (undefined, omitted, null).

import { renderChartRows } from "../src/chart.js";
import { paletteOf, styleOf, themeOf } from "../src/theme.js";

/** One run as data: its text, its contract fields and the colours it resolves to. */
function frameOf(run, palette, theme) {
  const style = styleOf(run, palette, theme);
  return {
    text: style.text,
    kind: run.kind ?? null,
    slice: Number.isInteger(run.slice) ? run.slice : null,
    fg: style.fg ?? null,
    bg: style.bg ?? null,
  };
}

/**
 * The final rows of one render, as styled runs. This calls the same
 * `renderChartRows` the plugin does, so notes, height trimming and a guessed
 * type are all part of the frame.
 *
 * @param {object} spec
 * @returns {{ text: string, kind: string|null, slice: number|null, fg: string|null, bg: string|null }[][]}
 */
export function rowsFrames(spec) {
  const theme = themeOf(spec);
  const palette = paletteOf(spec);
  return renderChartRows(spec).map((row) => row.runs.map((run) => frameOf(run, palette, theme)));
}
