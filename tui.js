// Renders ```chart fences in the OpenCode TUI.
//
// The fence body is JSON, and `type` picks the family:
//
//   { "type": "pie",   "slices": [["Closed won", 89], ["At risk", 12]] }
//   { "type": "bar",   "labels": ["Jul", "Aug"], "values": [118, 132] }
//   { "type": "hbar",  "labels": ["Globex"], "values": [4200], "sort": true }
//   { "type": "line",  "labels": ["Jul", "Aug"], "values": [118, 132] }
//   { "type": "area" | "sparkline" | "scatter" | "heatmap" | "gauge" | ... }
//
// All the geometry lives in the pure modules next door, so it can be tested
// without a terminal. This file only reads the fence, picks the theme, and turns
// runs of characters into coloured spans for OpenTUI.

import { appendFileSync } from "node:fs";
import { BoxRenderable, StyledText, TextRenderable, bg, bold, fg } from "@opentui/core";
import { paletteOf, parseChart, renderChartRows, styleOf, themeOf } from "./src/chart.js";

const LANGUAGES = ["chart"];
const LOG = "/tmp/opencode-charts.log";
/** Families drawn as a grid of blocks, which read as flat bands when over-wide. */
const GRID_FAMILIES = new Set(["treemap", "kanban", "table", "heatmap"]);

// Never write to stdout: it would corrupt the terminal frame.
function debug(message) {
  if (process.env.CHART_RENDER_DEBUG !== "1") return;
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log that cannot be written must never break a render.
  }
}

/** One run of characters as an OpenTUI chunk, coloured by the theme. */
function chunkFor(run, palette, theme) {
  const style = styleOf(run, palette, theme);
  // Always a chunk: the text buffer packs a chunk's `text` field, so a bare
  // string in the array above would pack as `undefined` and throw.
  let chunk = { __isChunk: true, text: String(style.text ?? ""), attributes: 0 };
  if (style.bg) chunk = bg(style.bg)(chunk);
  if (style.fg) chunk = fg(style.fg)(chunk);
  if (style.bold) chunk = bold(chunk);
  return chunk;
}

/** The theme the fence asked for, or the one the terminal is in. */
function themeFor(spec, mode) {
  const theme = themeOf(spec.theme ? spec : { ...spec, theme: mode });
  // A fence can move the boundary line wherever it likes, but it lives on the
  // theme's background by default, so the line reads as a gap in the shape.
  if (typeof spec.boundaryColor === "string") return { ...theme, background: spec.boundaryColor };
  return theme;
}

/** The plugin's own cell aspect, when its options carry one. A fence wins over it. */
function cellAspectOption(context) {
  const raw = context?.options?.cellAspect ?? context?.options?.options?.cellAspect;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 && value <= 4 ? value : undefined;
}

function rowsNode(context, rows, palette, theme) {
  const box = new BoxRenderable(context.renderer, {
    flexDirection: "column",
    width: "100%",
    flexShrink: 0,
  });

  for (const row of rows) {
    box.add(
      new TextRenderable(context.renderer, {
        content: new StyledText(row.runs.map((run) => chunkFor(run, palette, theme))),
        // A text renderable does not measure itself in the first layout pass, so
        // every line is sized by hand.
        width: "100%",
        height: 1,
        wrapMode: "none",
        flexShrink: 0,
      }),
    );
  }

  return box;
}

/** The reason a fence could not be drawn, then the fence itself. */
function errorNode(context, reason, fallback, theme) {
  const box = new BoxRenderable(context.renderer, { flexDirection: "column", width: "100%", flexShrink: 0 });
  const run = { text: `  chart: ${reason}`, kind: "legend" };
  box.add(
    new TextRenderable(context.renderer, {
      content: new StyledText([chunkFor(run, theme.palette, theme)]),
      width: "100%",
      height: 1,
      wrapMode: "none",
      flexShrink: 0,
    }),
  );

  const raw = typeof fallback === "function" ? fallback() : null;
  if (raw) box.add(raw);
  return box;
}

export default {
  id: "opencode.charts",
  setup(context) {
    for (const language of LANGUAGES) {
      try {
        context.markdown.registerCodeBlockRenderer(language, (token, renderContext) => {
          const mode = context.themeMode === "light" ? "light" : "dark";
          const theme = themeFor({}, mode);
          try {
            const source = token?.text ?? token?.code ?? token?.raw ?? "";
            const { spec, error } = parseChart(source);
            if (error) {
              debug(`body is not a chart spec: ${error}`);
              return errorNode(context, error, renderContext?.defaultRender, theme);
            }

            const themed = themeFor({ ...spec, theme: spec.theme ?? mode }, mode);
            // A fence that names its width gets it; one that stays quiet gets the
            // whole frame. The old default of 48 is why the charts looked narrow.
            const available = Math.max(20, (context.renderer?.width ?? 80) - 6);
            // A fence that names no width uses the pane, but a grid-like family
            // stops early: a treemap or a kanban board stretched across a very
            // wide frame reads as flat bands, where bars and lines stay useful.
            const cap = GRID_FAMILIES.has(spec.type) ? 110 : 160;
            const width = Math.max(20, Math.min(Number(spec.width) || Math.min(available, cap), available));
            const rows = renderChartRows({ ...spec, theme: spec.theme ?? mode, width, cellAspect: spec.cellAspect ?? cellAspectOption(context) });
            return rowsNode(context, rows, paletteOf(spec) ?? themed.palette, themed);
          } catch (failure) {
            debug(`render failed: ${failure?.stack ?? failure?.message ?? failure}`);
            return errorNode(context, String(failure?.message ?? failure), renderContext?.defaultRender, theme);
          }
        });
        debug(`registered code block renderer for "${language}"`);
      } catch (error) {
        debug(`could not register "${language}": ${error?.message}`);
      }
    }
    debug(`cell aspect option: ${cellAspectOption(context) ?? "default 2"}`);
  },
};
