// Pie and donut rendering for a character grid, in plain text or in colour.
//
// Three things make this hard in a terminal.
//
// 1. A cell is taller than it is wide, so a circle drawn in cell coordinates
//    comes out as a tall ellipse. Every radius here is normalised by the cell's
//    own ratio (`cellAspect`, height over width, two by default), which is what
//    makes the rim round on screen.
// 2. A whole cell per step leaves a chewed rim. The shared sampler draws each
//    cell from its sub-cell grid (see core.js and mosaic.js), so the rim follows
//    the curve at 2x3 or 2x4 resolution.
// 3. A wedge boundary has to be sharp without spending cells on it. Blanking or
//    painting whole cells for the line is what makes a staircase. Instead, a
//    cell that the boundary crosses carries both wedges at once: the glyph fills
//    the winning wedge's sub-cells and the cell background shows the other wedge
//    behind them. Where the boundary meets the rim the winner fills the whole
//    cell instead: a background colour there would paint the sub-cells outside
//    the disc, and a dark line leaves ticks on the shape. Monochrome callers can
//    ask for drawn spokes instead.
// 4. Wedges need to be told apart. In colour that is the fill colour, so the
//    fill is uniform everywhere. Without colour the caller can pass textured
//    fills, and each wedge carries its own percentage either way.
//
// The layout is computed once into a grid of cells. Text and colour are two
// renderings of that grid, which is what keeps the geometry testable.

import { glyphFor } from "./mosaic.js";
import {
  BLANK,
  DEFAULT_PALETTE,
  SOLID,
  SPOKE,
  cellsToRuns,
  cols,
  contrastOn,
  cumulativeFractions,
  formatPercent,
  legendLines,
  legendRowRuns,
  makeSampler,
  normalizeEntries,
  secondIndex,
  seriesGlyphs,
  titleRow,
  truncate,
  winnerOf,
} from "./core.js";

// Re-exported so the plugin and the tests can keep importing from this file.
export {
  DEFAULT_PALETTE,
  contrastOn,
  formatPercent,
  seriesGlyphs,
  sliceGlyphs,
  normalizeEntries as normalizeSlices,
} from "./core.js";

/**
 * Compute the disc once: which slice owns each cell, which cells carry the
 * boundary line between slices, and where the percentage labels sit.
 *
 * @returns {{width: number, height: number, cells: {slice: number, other?: number, char: string, kind: string, mask: number}[][]}}
 *   `slice` is -1 outside the disc and `mask` is the sub-cells that fall inside
 *   it (0 outside). `kind` is "fill", "edge", "label", "spoke" or "outside".
 *   An "edge" cell is crossed by a wedge boundary and holds both wedges: `char`
 *   fills `slice`'s sub-cells, and `other` names the wedge whose sub-cells are
 *   the rest of the cell, to be drawn as its background. Boundary cells that
 *   touch the rim are "fill": the winner paints every owned sub-cell, so no
 *   background spills outside the disc and no dark tick lands on the shape.
 */
export function layoutPie(slices, options = {}) {
  const width = Math.max(5, Math.floor(options.width ?? 48));
  const margin = Math.max(0, Math.min(3, Math.floor(options.margin ?? 1)));

  // A round shape has a height of its own: without this cap a very wide frame
  // (the terminal is 140 columns, the fence says nothing) would ask for a 70-row
  // disc. The disc keeps the aspect ratio and centres itself in the width.
  const aspect = Number(options.cellAspect) > 0 ? Number(options.cellAspect) : 2;
  const height = Math.max(3, Math.floor(options.height ?? Math.min(28, Math.round((width - 2 * margin) / aspect) + 2)));
  const radiusX = Math.max(2, Math.min((width - 2 * margin) / 2, height - 2));
  // The vertical radius is half the horizontal one: that ratio is the aspect
  // correction that makes the rim round on screen.
  const radiusY = radiusX / aspect;

  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ slice: -1, char: BLANK, kind: "outside", mask: 0 })),
  );

  if (slices.length === 0) return { width, height, cells };

  const glyphs = options.glyphs ?? (options.textured ? seriesGlyphs(slices.length) : slices.map(() => SOLID));
  const bounds = cumulativeFractions(slices.map((slice) => slice.value));
  const inner = options.donut ? 0.45 : 0;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;

  const sliceAt = (x, y) => {
    const dx = (x - centerX) / radiusX;
    const dy = (y - centerY) / radiusY;
    const distance = Math.hypot(dx, dy);
    if (distance > 1 || (inner > 0 && distance < inner)) return -1;

    // Angle from twelve o'clock, clockwise, so slices read left to right.
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += Math.PI * 2;

    const fraction = angle / (Math.PI * 2);
    const index = bounds.findIndex((bound) => fraction < bound);
    return index < 0 ? slices.length - 1 : index;
  };

  const sampler = makeSampler(options.mosaic);

  // Monochrome callers can ask for drawn spokes: one line character per cell
  // that the boundary passes through.
  const spokeChars = bounds.slice(0, -1).map((bound) => {
    const angle = bound * Math.PI * 2;
    const stepX = Math.sin(angle) * radiusX;
    const stepY = -Math.cos(angle) * radiusY;
    const horizontal = Math.abs(stepX) >= Math.abs(stepY) * 1.6;
    const vertical = Math.abs(stepY) >= Math.abs(stepX) * 1.6;
    return horizontal
      ? SPOKE.horizontal
      : vertical
        ? SPOKE.vertical
        : stepX * stepY > 0
          ? SPOKE.downRight
          : SPOKE.upRight;
  });

  const spokeNear = (x, y) => {
    const dx = (x - centerX) / radiusX;
    const dy = (y - centerY) / radiusY;
    let angle = Math.atan2(dx, -dy);
    if (angle < 0) angle += Math.PI * 2;
    let nearest = 0;
    let closest = Infinity;
    for (const [index, bound] of bounds.slice(0, -1).entries()) {
      let delta = Math.abs(angle - bound * Math.PI * 2);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta < closest) {
        closest = delta;
        nearest = index;
      }
    }
    return spokeChars[nearest];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { mask, tally, masks } = sampler.sample(x, y, sliceAt);

      let inside = 0;
      for (const count of tally.values()) inside += count;
      if (inside < sampler.minimum) continue;

      const winner = winnerOf(tally);

      // The hole is a boundary like the outer rim, so it gets its own sub-cell
      // mask: the sampler only reports owned slices, and stopping the fill at a
      // whole cell leaves the soft staircase the rim no longer has.
      const shape = sampler.shape;
      let hole = 0;
      if (inner > 0) {
        for (let row = 0; row < shape.rows; row++) {
          for (let column = 0; column < shape.columns; column++) {
            const dx = (x + (column + 0.5 - shape.columns / 2) / shape.columns - centerX) / radiusX;
            const dy = (y + (row + 0.5 - shape.rows / 2) / shape.rows - centerY) / radiusY;
            if (Math.hypot(dx, dy) < inner) hole |= 1 << (row * shape.columns + column);
          }
        }
      }
      if (hole !== 0) {
        // The hole is drawn by omission, like the outside of the rim: the
        // wedge's sub-cells carry the colour and the hole's own sub-cells stay
        // unpainted, so no dark tick lands on the ring.
        cells[y][x] = { slice: winner, other: -1, char: glyphFor(mask, sampler.mosaic), kind: "fill", mask };
        continue;
      }

      // A boundary runs through this cell, so the cell carries both wedges at
      // once: its glyph fills the winning wedge's sub-cells and the cell
      // background shows the other wedge behind them. The boundary sits on the
      // sub-cell curve, at the same resolution as the rim, and costs no cell.
      const winnerMask = masks.get(winner) ?? 0;
      if (winnerMask !== mask) {
        const other = secondIndex(tally, winner);
        if (mask === sampler.solidMask) {
          cells[y][x] = { slice: winner, other, char: sampler.glyph(winnerMask), kind: "edge", mask };
        } else {
          // At the rim a background colour would paint the sub-cells outside the
          // disc, and a dark boundary glyph would leave ticks on the shape. The
          // winner fills every owned sub-cell instead: the rim stays clean, and
          // the neighbour's few sub-cells inside are absorbed by the majority
          // that already owns the cell.
          cells[y][x] = {
            slice: winner,
            other,
            char: options.spokes ? spokeNear(x, y) : glyphFor(mask, sampler.mosaic),
            kind: options.spokes ? "spoke" : "fill",
            mask,
          };
        }
        continue;
      }

      cells[y][x] = { slice: winner, char: sampler.glyph(mask, glyphs[winner]), kind: "fill", mask };
    }
  }

  if (options.labels !== false && slices.length > 1) {
    stampLabels(cells, slices, options);
  }

  return { width, height, cells };
}

/** Percentage inside the widest run of each wedge, when there is room. */
function stampLabels(cells, slices, options) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const height = cells.length;
  const width = cells[0].length;

  for (const [index, slice] of slices.entries()) {
    const label = options.labelFormat ? options.labelFormat(slice, total) : `${Math.round((slice.value / total) * 100)}%`;
    const length = cols(label);
    let best = null;

    for (let y = 0; y < height; y++) {
      let start = -1;
      for (let x = 0; x <= width; x++) {
        const mine = x < width && cells[y][x].slice === index && cells[y][x].kind !== "spoke";
        if (mine && start < 0) start = x;
        if (!mine && start >= 0) {
          const run = x - start;
          if (!best || run > best.length) best = { y, start, length: run };
          start = -1;
        }
      }
    }

    if (!best || best.length < length + 2) continue;
    const from = best.start + Math.floor((best.length - length) / 2);
    const glyphs = [...label];
    for (let offset = 0; offset < length; offset++) {
      cells[best.y][from + offset] = { slice: index, char: glyphs[offset], kind: "label" };
    }
  }
}

/** Plain text rows. No colour, so the drawn boundary and the labels carry the meaning. */
export function renderPie(slices, options = {}) {
  const { cells } = layoutPie(slices, options);
  return cells.map((row) => row.map((cell) => cell.char).join(""));
}

/**
 * The same grid as runs of characters. The caller turns each run into a styled
 * span: one span per slice, so a wedge is one colour. An "edge" run names the
 * second wedge in `other`, to be painted as the background of the run.
 */
export function renderPieRows(slices, options = {}) {
  const { width, cells } = layoutPie(slices, options);
  return cells.map((row) => ({ width, runs: cellsToRuns(row) }));
}

/** Legend rows, one slice per line, aligned on the label and the value. */
export function renderLegend(entries, glyphs, options = {}) {
  return legendLines(entries, { ...options, glyphs });
}

function resolveGlyphs(spec, slices) {
  if (spec.glyphs) return spec.glyphs;
  return spec.textured ? seriesGlyphs(slices.length) : slices.map(() => SOLID);
}

function discHeight(spec, width, margin) {
  if (spec.height != null) return Math.max(3, Math.floor(spec.height));
  const aspect = Number(spec.cellAspect) > 0 ? Number(spec.cellAspect) : 2;
  const radiusX = Math.max(2, (width - 2 * margin) / 2);
  // The same cap layoutPie applies: a wide frame gets a wide *chart*, not a
  // 70-row disc.
  return Math.max(3, Math.min(28, Math.round((2 * radiusX) / aspect) + 2));
}

export function isDonut(spec) {
  return spec.donut === true || spec.type === "donut";
}

/**
 * Title, disc, legend as plain text, padded to one width so the block keeps its
 * shape in a chat transcript.
 */
/** Slices come as `slices`, or as parallel `labels` and `values` like every other family. */
function readSlices(spec) {
  if (Array.isArray(spec.slices)) return normalizeEntries(spec.slices);
  const values = Array.isArray(spec.values) ? spec.values : [];
  return normalizeEntries(values.map((value, index) => [spec.labels?.[index] ?? `slice ${index + 1}`, value]));
}

export function renderPieChart(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const margin = Math.max(0, Math.min(3, Math.floor(spec.margin ?? 1)));
  const slices = readSlices(spec);

  const lines = [];
  if (spec.title) lines.push(truncate(spec.title, width) + BLANK.repeat(Math.max(0, width - cols(spec.title))));

  lines.push(
    ...renderPie(slices, {
      width,
      height: discHeight(spec, width, margin),
      margin,
      glyphs: resolveGlyphs(spec, slices),
      donut: isDonut(spec),
      spokes: spec.spokes,
      textured: spec.textured,
      mosaic: spec.mosaic,
      cellAspect: spec.cellAspect,
    }),
  );

  if (spec.legend !== false && slices.length > 0) {
    lines.push(...legendLines(slices, { width, glyphs: resolveGlyphs(spec, slices), markers: spec.markers }));
  }
  return lines.join("\n");
}

/**
 * The same chart as styled runs, for a renderer that can colour. Every row is
 * `{ width, runs }` and every run is `{ text, slice, kind, other }`, where
 * `slice` is -1 outside the disc, `other` is the second wedge of an "edge" run
 * (else -1), and `kind` is "fill" | "edge" | "line" | "label" | "spoke" |
 * "outside" | "title" | "legend" | "legend-mark".
 */
export function renderChartRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 48));
  const margin = Math.max(0, Math.min(3, Math.floor(spec.margin ?? 1)));
  const slices = readSlices(spec);
  const glyphs = resolveGlyphs(spec, slices);

  const rows = [];
  if (spec.title) rows.push(titleRow(String(spec.title), width));

  rows.push(
    ...renderPieRows(slices, {
      width,
      height: discHeight(spec, width, margin),
      margin,
      glyphs,
      donut: isDonut(spec),
      spokes: spec.spokes,
      textured: spec.textured,
      mosaic: spec.mosaic,
      cellAspect: spec.cellAspect,
    }),
  );

  if (spec.legend !== false && slices.length > 0 && spec.plainLegend !== true) {
    rows.push(...legendRowRuns(slices, { width, marker: "●" }));
  }

  return rows;
}
