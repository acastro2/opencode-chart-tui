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
import {
  BoxRenderable,
  RGBA,
  Renderable,
  StyledText,
  TextAttributes,
  TextRenderable,
  bg,
  bold,
  fg,
} from "@opentui/core";
import { paletteOf, parseChart, renderChartRows, styleOf, themeOf } from "./src/chart.js";
import { DEFAULT_CHART_WIDTH, clipWidth, measureWidth } from "./src/layout.js";
import { graphemeWidth, graphemes } from "./src/text.js";

const LANGUAGES = ["chart"];
const LOG = "/tmp/opencode-charts.log";
/** Families drawn as a grid of blocks, which read as flat bands when over-wide. */
const GRID_FAMILIES = new Set(["treemap", "kanban", "table", "heatmap"]);
/** Those families peak lower than a chart of marks does. */
const GRID_WIDTH = 110;

// Never write to stdout: it would corrupt the terminal frame.
function debug(message) {
  if (process.env.CHART_RENDER_DEBUG !== "1") return;
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log that cannot be written must never break a render.
  }
}

/**
 * A failure as one short line. A stack trace has no place in a chart row, and a
 * wrapped message would look like several.
 */
function oneLine(failure) {
  const message = String(failure?.message ?? failure ?? "render failed").replace(/\s+/g, " ").trim();
  return message || "render failed";
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

// A fence can move the boundary line wherever it likes, but it lives on the
// theme's background by default, so the line reads as a gap in the shape.
// `gap` is the old name; the renderer renames it, but this runs on the raw spec.
function boundaryOf(spec) {
  if (typeof spec.boundaryColor === "string") return spec.boundaryColor;
  if (typeof spec.gap === "string" && !Number.isFinite(Number(spec.gap))) return spec.gap;
  return null;
}

/** The theme the fence asked for, or the one the terminal is in. */
function themeFor(spec, mode) {
  const theme = themeOf(spec.theme ? spec : { ...spec, theme: mode });
  const boundary = boundaryOf(spec);
  return boundary === null ? theme : { ...theme, background: boundary };
}

/** The plugin's own cell aspect, when its options carry one. A fence wins over it. */
function cellAspectOption(context) {
  const raw = context?.options?.cellAspect ?? context?.options?.options?.cellAspect;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 && value <= 4 ? value : undefined;
}

/**
 * The cell's own height-over-width, measured from the terminal when it reports
 * pixels. This is what makes a disc round without anyone configuring it; it is
 * absent on terminals that do not answer the pixel query, and the option and
 * the default take over then.
 */
function measuredAspect(context) {
  const renderer = context?.renderer;
  const resolution = renderer?.resolution;
  const columns = renderer?.width ?? renderer?.terminalWidth;
  const rows = renderer?.height ?? renderer?.terminalHeight;
  if (!resolution || !(columns > 0) || !(rows > 0)) return undefined;
  const aspect = (resolution.height / rows) / (resolution.width / columns);
  return Number.isFinite(aspect) && aspect >= 1 && aspect <= 4 ? Number(aspect.toFixed(2)) : undefined;
}

/**
 * One renderable owns the whole chart. A row-per-TextRenderable box looked
 * right in simple frames, but each text node measured itself and the box only
 * found the pane width after layout, so the drawing used a guessed width. This
 * draws into the buffer directly and measures its own cells, which is the
 * contract the OpenTUI docs describe for a custom renderable.
 */
class ChartRenderable extends Renderable {
  constructor(context, { spec, theme, palette, measuredAspect }) {
    super(context, { flexShrink: 0 });
    this.spec = spec;
    this.theme = theme;
    this.palette = palette;
    this.measuredAspect = measuredAspect;
    this.rows = [];
    this.renderedWidth = 0;
    this.pinned = Number(spec?.width) > 0;

    this.setMeasureProvider((width) => {
      // `width` is NaN when Yoga has no measurement to offer; measureWidth turns
      // that into the cap instead of handing NaN to every family.
      const target = this.targetWidth(width);
      return { width: target, height: this.ensureRows(target).length };
    });
  }

  /** The width to draw at: the fence's own `width`, else the box, capped. */
  targetWidth(available) {
    const cap = GRID_FAMILIES.has(this.spec?.type) ? GRID_WIDTH : DEFAULT_CHART_WIDTH;
    return measureWidth(available, { cap, pinned: this.spec?.width });
  }

  /**
   * The rows for a width, or the one row that says why they could not be drawn.
   * This runs inside the measure provider and again in `renderSelf`, both outside
   * the plugin's try/catch, so a renderer error must become a row here: thrown
   * from the measure pass it escapes into the TUI's layout instead.
   */
  drawRows(width) {
    try {
      return renderChartRows({
        ...this.spec,
        width,
        theme: this.spec?.theme ?? this.theme?.name,
        cellAspect: this.spec?.cellAspect ?? this.measuredAspect,
      });
    } catch (failure) {
      const reason = oneLine(failure);
      debug(`render failed at width ${width}: ${failure?.stack ?? reason}`);
      return [{ width, runs: [{ text: `  chart: ${reason}`, slice: -1, kind: "legend" }] }];
    }
  }

  ensureRows(width) {
    if (width !== this.renderedWidth || this.rows.length === 0) {
      this.rows = this.drawRows(width);
      this.renderedWidth = width;
    }
    return this.rows;
  }

  onResize(width) {
    if (this.pinned) return;
    const target = this.targetWidth(width);
    if (target !== this.renderedWidth) {
      this.ensureRows(target);
      this.invalidateIntrinsicSize();
      this.requestRender();
    }
  }

  renderSelf(buffer) {
    const width = this.renderedWidth || this.targetWidth(this.width || 48);
    const rows = this.ensureRows(width);
    // The box the layout gave us, or the measured width before a layout has run.
    // A family may floor its own width above the box (a radar starts at 20), so
    // every row is clipped to it rather than trusted to fit.
    const box = clipWidth(width, this.width || width);
    const originX = this.buffered ? 0 : this.screenX;
    const originY = this.buffered ? 0 : this.screenY;
    const background = RGBA.defaultBackground();
    const foreground = RGBA.fromHex(this.theme?.foreground ?? "#e6e6e6");

    for (const [rowIndex, row] of rows.entries()) {
      const rowWidth = clipWidth(row.width, box);
      let x = 0;
      for (const run of row.runs) {
        const style = styleOf(run, this.palette, this.theme);
        const fg = style.fg ? RGBA.fromHex(style.fg) : foreground;
        const bg = style.bg ? RGBA.fromHex(style.bg) : background;
        const attributes = style.bold ? TextAttributes.BOLD : 0;
        for (const glyph of graphemes(style.text ?? "")) {
          const cells = graphemeWidth(glyph);
          if (cells === 0) continue;
          if (x + cells > rowWidth) break;
          buffer.setCell(originX + x, originY + rowIndex, glyph, fg, bg, attributes);
          x += cells;
        }
      }
      // The runs stop at the last non-blank cell. Paint the rest of the row so
      // the chart has one background and a stale line cannot survive a resize.
      for (; x < rowWidth; x++) {
        buffer.setCell(originX + x, originY + rowIndex, " ", foreground, background, 0);
      }
    }
  }
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

export { ChartRenderable };

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
            return new ChartRenderable(context.renderer, {
              spec: { ...spec, theme: spec.theme ?? mode },
              theme: themed,
              palette: paletteOf(spec) ?? themed.palette,
              // An explicit option beats a measured guess: the option exists for
              // terminals whose pixel report is wrong.
              measuredAspect: spec.cellAspect ?? cellAspectOption(context) ?? measuredAspect(context),
            });
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
    debug(`cell aspect option: ${cellAspectOption(context) ?? "none"}`);
    debug(`cell aspect measured: ${measuredAspect(context) ?? "none"}`);
  },
};
