// Theme: every colour the families paint with, in one place.
//
// Why: the drawing code used to carry hexes of its own (`#0b0b0b` for a boundary
// line, `#101010` as the base of a tinted tile, `#9aa0a6` for axis text), all of
// which assume a dark terminal. A theme is a background plus the readable
// colours on it, so a spec asks for one by name and every family takes its
// colours from the same place.
//
// A fence can ask with `"theme": "light"`; the CLI plugin passes the theme the
// TUI is actually running in, so a chart follows the terminal unless the fence
// overrides it.

import { contrastOn } from "./core.js";

/** Eight series colours per theme. */
export const PALETTES = {
  // The dark set is the original palette: vivid on near-black.
  dark: ["#4e9de0", "#57c98a", "#e5b83c", "#e5695f", "#a98bd8", "#43b8b0", "#e08bc0", "#9a9a52"],
  // The light set keeps the same hues, darkened until they read on white.
  light: ["#1f6fb2", "#2f8f5b", "#a97a12", "#c0432f", "#7a5bb5", "#1f8a86", "#b3558f", "#6f6f26"],
};

export const THEMES = {
  dark: {
    name: "dark",
    palette: PALETTES.dark,
    /** Boundary lines and other "cut into the chart" marks. */
    background: "#0b0b0b",
    /** The base a translucent tile is mixed towards (the terminal background). */
    tint: "#101010",
    /** Default text when a run asks for no colour of its own. */
    foreground: "#e6e6e6",
    /** Axis, grid, track, legend text and other furniture. */
    muted: "#9aa0a6",
    heat: { low: "#1f3b57", high: "#e5695f" },
  },
  light: {
    name: "light",
    palette: PALETTES.light,
    background: "#ffffff",
    tint: "#ffffff",
    foreground: "#1f2328",
    muted: "#57606a",
    heat: { low: "#dbe7f3", high: "#c0432f" },
  },
};

/** The theme for a spec: `spec.theme` by name, dark when unset or unknown. */
export function themeOf(spec) {
  return THEMES[String(spec?.theme ?? "").toLowerCase()] ?? THEMES.dark;
}

/** The palette a spec paints with: its own, or the theme's. */
export function paletteOf(spec) {
  return Array.isArray(spec?.palette) && spec.palette.length > 0 ? spec.palette : themeOf(spec).palette;
}

/**
 * A palette lookup for one render: wraps any integer, even a negative one, and
 * ignores an empty palette instead of dividing by zero.
 */
function paletteColour(palette) {
  const list = palette.length > 0 ? palette : THEMES.dark.palette;
  return (index) => list[((index % list.length) + list.length) % list.length];
}

/** The series colour a run asks for: its own, else its slice; null for none. */
function fillOf(run, colour) {
  if (typeof run.color === "string") return run.color;
  if (!Number.isInteger(run.slice) || run.slice < 0) return null;
  return colour(run.slice);
}

/** The colour behind a run: its own, else the other series, else the theme. */
function behindOf(run, colour, theme) {
  if (typeof run.background === "string") return run.background;
  if (Number.isInteger(run.other) && run.other >= 0) return colour(run.other);
  return theme.background;
}

/**
 * Everything a handler needs, worked out once and in this order: a run that is
 * malformed fails on the same property as it always did.
 */
function contextOf(run, palette, theme) {
  const colour = paletteColour(palette);
  const fill = fillOf(run, colour);
  const behind = behindOf(run, colour, theme);
  return { run, text: run.text ?? "", fill, behind, theme };
}

/*
 * One handler per run kind. Each returns plain data and nothing else, so the
 * kind contract stays readable one case at a time and testable without a
 * terminal. Key order in the result is part of the contract: the plugin turns
 * these into OpenTUI chunks, and a test compares them whole.
 */

/** A boundary cell: two series meet, so the glyph is one and the bed the other. */
function edgeStyle({ text, fill, behind, theme }) {
  return { text, fg: fill ?? theme.muted, bg: behind };
}

/** A line is the inverse of an edge: it cuts the mark out of the background. */
function lineStyle({ text, fill, theme }) {
  return { text, fg: theme.background, bg: fill ?? theme.muted };
}

/**
 * A label contrasts against the block it sits on.
 *
 * A label outside a mark can ask for the chart background with `background`. A
 * series-coloured block there would read as another mark, so it must not fall
 * back to `other` the way an edge's bed does.
 */
function labelStyle({ text, fill, run, theme }) {
  const background = typeof run.background === "string" ? run.background : (fill ?? theme.muted);
  return { text, fg: contrastOn(background), bg: background };
}

/** A cell is a block of colour with nothing written in it, so it has no fg. */
function cellStyle({ text, fill, theme }) {
  return { text, bg: fill ?? theme.muted };
}

/** A mark's own colour, written straight onto the terminal background. */
function markStyle({ text, fill, theme }) {
  return { text, fg: fill ?? theme.muted };
}

/** The title is a mark's colour in bold; no colour of its own leaves fg unset. */
function titleStyle({ text, fill }) {
  return { text, fg: fill ?? undefined, bold: true };
}

/** Axis, grid, track and target are furniture: one muted tone for all four. */
function furnitureStyle({ text, theme }) {
  return { text, fg: theme.muted };
}

/** Anything else, `outside` included, is plain text in the theme's foreground. */
function plainStyle({ text, theme }) {
  return { text, fg: theme.foreground };
}

/**
 * The handler for each run kind. A `Map`, not an object: a fence can write any
 * string as a kind, and `"constructor"` must not find `Object.prototype` and
 * return a function where a style belongs.
 */
const RUN_STYLES = new Map([
  ["edge", edgeStyle],
  ["line", lineStyle],
  ["label", labelStyle],
  ["cell", cellStyle],
  ["fill", markStyle],
  ["series", markStyle],
  ["legend-mark", markStyle],
  ["spoke", markStyle],
  ["legend", markStyle],
  ["title", titleStyle],
  ["axis", furnitureStyle],
  ["grid", furnitureStyle],
  ["track", furnitureStyle],
  ["target", furnitureStyle],
]);

/**
 * The style a run asks for, as plain data: `{ text, fg, bg, bold }`.
 *
 * This is the whole run-kind contract. The CLI plugin turns the result into
 * OpenTUI chunks; a test can check it without a terminal. Deeper rules live in
 * the handlers: a boundary cell carries two series, so its glyph is the
 * winner's colour and its background is the other series.
 */
export function styleOf(run, palette = THEMES.dark.palette, theme = THEMES.dark) {
  const context = contextOf(run, palette, theme);
  const style = RUN_STYLES.get(run.kind) ?? plainStyle;
  return style(context);
}
