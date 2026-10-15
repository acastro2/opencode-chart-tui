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
    /** Axis, grid, track, legend text and other furniture. */
    muted: "#9aa0a6",
    heat: { low: "#1f3b57", high: "#e5695f" },
  },
  light: {
    name: "light",
    palette: PALETTES.light,
    background: "#ffffff",
    tint: "#ffffff",
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
 * The style a run asks for, as plain data: `{ text, fg, bg, bold }`.
 *
 * This is the whole run-kind contract in one testable function. The CLI plugin
 * turns the result into OpenTUI chunks; a test can check it without a terminal.
 * Deeper rules come first: a boundary cell carries two series, so its glyph is
 * the winner's colour and its background is the other series.
 */
export function styleOf(run, palette = THEMES.dark.palette, theme = THEMES.dark) {
  const list = palette.length > 0 ? palette : THEMES.dark.palette;
  const colour = (index) => list[((index % list.length) + list.length) % list.length];
  const own = typeof run.color === "string" ? run.color : null;
  const fill = own ?? (Number.isInteger(run.slice) && run.slice >= 0 ? colour(run.slice) : null);
  const behind =
    typeof run.background === "string"
      ? run.background
      : Number.isInteger(run.other) && run.other >= 0
        ? colour(run.other)
        : theme.background;
  const text = run.text ?? "";

  switch (run.kind) {
    case "edge":
      return { text, fg: fill ?? theme.muted, bg: behind };
    case "line":
      return { text, fg: theme.background, bg: fill ?? theme.muted };
    case "label":
      return { text, fg: contrastOn(fill ?? theme.muted), bg: fill ?? theme.muted };
    case "cell":
      return { text, bg: fill ?? theme.muted };
    case "fill":
    case "series":
    case "legend-mark":
    case "spoke":
    case "legend":
      return { text, fg: fill ?? theme.muted };
    case "title":
      return { text, fg: fill ?? undefined, bold: true };
    case "axis":
    case "grid":
    case "track":
    case "target":
      return { text, fg: theme.muted };
    default:
      return { text };
  }
}
