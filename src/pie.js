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
  blankGrid,
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
import { graphemeWidth, graphemes } from "./text.js";
import { plotRows as plotRowsFor } from "./layout.js";

// Re-exported so the plugin and the tests can keep importing from this file.
export {
  DEFAULT_PALETTE,
  contrastOn,
  formatPercent,
  seriesGlyphs,
  sliceGlyphs,
  normalizeEntries as normalizeSlices,
} from "./core.js";

const TAU = Math.PI * 2;

// --- Geometry -------------------------------------------------------------

/** Width in cells, never narrower than a readable disc. */
function pieWidth(options) {
  return Math.max(5, Math.floor(options.width ?? 48));
}

/** Margin in cells, clamped so a chart cannot ask for a negative or huge one. */
function pieMargin(options) {
  return Math.max(0, Math.min(3, Math.floor(options.margin ?? 1)));
}

function pieAspect(options) {
  return Number(options.cellAspect) > 0 ? Number(options.cellAspect) : 2;
}

/** A wide frame gets a wide *chart*, not a 70-row disc. */
function pieHeight(options, width, margin, aspect) {
  const fallback = Math.min(28, Math.round((width - 2 * margin) / aspect) + 2);
  return Math.max(3, Math.floor(options.height ?? fallback));
}

function pieRadiusX(width, margin, height) {
  return Math.max(2, Math.min((width - 2 * margin) / 2, height - 2));
}

/**
 * Everything the shape needs, computed once. `radiusY` is the horizontal radius
 * over the cell aspect: a cell is twice as tall as it is wide, so the vertical
 * radius is half the horizontal one and the rim looks round.
 */
function discGeometry(options) {
  const width = pieWidth(options);
  const margin = pieMargin(options);
  const aspect = pieAspect(options);
  const height = pieHeight(options, width, margin, aspect);
  const radiusX = pieRadiusX(width, margin, height);
  return {
    width,
    height,
    radiusX,
    radiusY: radiusX / aspect,
    centerX: (width - 1) / 2,
    centerY: (height - 1) / 2,
    inner: options.donut ? 0.45 : 0,
  };
}

/** True outside the rim or inside the donut hole: no wedge owns the point. */
function distanceOutside(dx, dy, inner) {
  const distance = Math.hypot(dx, dy);
  return distance > 1 || (inner > 0 && distance < inner);
}

/** Angle from twelve o'clock, clockwise, so slices read left to right. */
function clockwiseAngle(dx, dy) {
  const angle = Math.atan2(dx, -dy);
  return angle < 0 ? angle + TAU : angle;
}

/** Index of the first cumulative bound this fraction falls under. */
function firstBound(bounds, fraction) {
  for (const [index, bound] of bounds.entries()) {
    if (fraction < bound) return index;
  }
  return -1;
}

/** Which slice owns a point, or -1 outside the disc and its hole. */
function sliceAtFor(bounds, count, geometry) {
  return (x, y) => {
    const dx = (x - geometry.centerX) / geometry.radiusX;
    const dy = (y - geometry.centerY) / geometry.radiusY;
    if (distanceOutside(dx, dy, geometry.inner)) return -1;
    const index = firstBound(bounds, clockwiseAngle(dx, dy) / TAU);
    return index < 0 ? count - 1 : index;
  };
}

// --- The hole -------------------------------------------------------------

/** One sub-cell's centre, in units of the horizontal radius. */
function subCellPoint(x, y, row, column, shape, geometry) {
  const dx = (x + (column + 0.5 - shape.columns / 2) / shape.columns - geometry.centerX) / geometry.radiusX;
  const dy = (y + (row + 0.5 - shape.rows / 2) / shape.rows - geometry.centerY) / geometry.radiusY;
  return { dx, dy };
}

/** The sub-cell's bit when it falls inside the hole, else 0. */
function holeBit(x, y, row, column, shape, geometry) {
  const { dx, dy } = subCellPoint(x, y, row, column, shape, geometry);
  return Math.hypot(dx, dy) < geometry.inner ? 1 << (row * shape.columns + column) : 0;
}

/**
 * The hole is a boundary like the outer rim, so it gets its own sub-cell mask:
 * the sampler only reports owned slices, and stopping the fill at a whole cell
 * leaves the soft staircase the rim no longer has.
 */
function holeMask(sampler, x, y, geometry) {
  if (!(geometry.inner > 0)) return 0;
  const { shape } = sampler;
  let hole = 0;
  for (let row = 0; row < shape.rows; row++) {
    for (let column = 0; column < shape.columns; column++) {
      hole |= holeBit(x, y, row, column, shape, geometry);
    }
  }
  return hole;
}

// --- Cells ----------------------------------------------------------------

function insideCount(tally) {
  let inside = 0;
  for (const count of tally.values()) inside += count;
  return inside;
}

function boundaryOf(sample, winner) {
  return sample.masks.get(winner) ?? 0;
}

function holeCell(sample, winner, sampler) {
  // The hole is drawn by omission, like the outside of the rim: the wedge's
  // sub-cells carry the colour and the hole's own sub-cells stay unpainted, so
  // no dark tick lands on the ring.
  return { slice: winner, other: -1, char: glyphFor(sample.mask, sampler.mosaic), kind: "fill", mask: sample.mask };
}

function boundaryCell(sample, winner, sampler, spokeAt, x, y) {
  // A boundary runs through this cell, so the cell carries both wedges at
  // once: its glyph fills the winning wedge's sub-cells and the cell background
  // shows the other wedge behind them.
  const other = secondIndex(sample.tally, winner);
  if (sample.mask === sampler.solidMask) {
    return { slice: winner, other, char: sampler.glyph(boundaryOf(sample, winner)), kind: "edge", mask: sample.mask };
  }
  if (spokeAt) {
    return { slice: winner, other, char: spokeAt(x, y), kind: "spoke", mask: sample.mask };
  }
  // At the rim a background colour would paint the sub-cells outside the disc,
  // and a dark boundary glyph would leave ticks on the shape. The winner fills
  // every owned sub-cell instead: the rim stays clean, and the neighbour's few
  // sub-cells inside are absorbed by the majority that already owns the cell.
  return { slice: winner, other, char: glyphFor(sample.mask, sampler.mosaic), kind: "fill", mask: sample.mask };
}

function fillCell(sample, winner, sampler, glyphs) {
  return { slice: winner, char: sampler.glyph(sample.mask, glyphs[winner]), kind: "fill", mask: sample.mask };
}

/** One cell of the disc, or null when not enough sub-cells fall inside it. */
function pieCell(x, y, sampler, sliceAt, geometry, glyphs, spokeAt) {
  const sample = sampler.sample(x, y, sliceAt);
  if (insideCount(sample.tally) < sampler.minimum) return null;
  const winner = winnerOf(sample.tally);
  if (holeMask(sampler, x, y, geometry) !== 0) return holeCell(sample, winner, sampler);
  if (boundaryOf(sample, winner) !== sample.mask) return boundaryCell(sample, winner, sampler, spokeAt, x, y);
  return fillCell(sample, winner, sampler, glyphs);
}

function paintPieCells(cells, sampler, sliceAt, geometry, glyphs, spokeAt) {
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = pieCell(x, y, sampler, sliceAt, geometry, glyphs, spokeAt);
      if (cell) cells[y][x] = cell;
    }
  }
}

// --- Spokes ---------------------------------------------------------------

function angleStep(angle, radiusX, radiusY) {
  return { x: Math.sin(angle) * radiusX, y: -Math.cos(angle) * radiusY };
}

/**
 * The line character for a boundary at this angle: nearly horizontal, nearly
 * vertical, or one of the two diagonals by the sign of the step.
 */
function spokeChar(angle, radiusX, radiusY) {
  const step = angleStep(angle, radiusX, radiusY);
  const horizontal = Math.abs(step.x) >= Math.abs(step.y) * 1.6;
  const vertical = Math.abs(step.y) >= Math.abs(step.x) * 1.6;
  if (horizontal) return SPOKE.horizontal;
  if (vertical) return SPOKE.vertical;
  return step.x * step.y > 0 ? SPOKE.downRight : SPOKE.upRight;
}

function spokeCharsFor(bounds, radiusX, radiusY) {
  return bounds.slice(0, -1).map((bound) => spokeChar(bound * TAU, radiusX, radiusY));
}

function angleDelta(angle, bound) {
  const delta = Math.abs(angle - bound * TAU);
  return delta > Math.PI ? TAU - delta : delta;
}

/** A lookup from a cell to the spoke glyph of the nearest wedge boundary. */
function spokeAtFor(bounds, chars, geometry) {
  const { centerX, centerY, radiusX, radiusY } = geometry;
  return (x, y) => {
    const angle = clockwiseAngle((x - centerX) / radiusX, (y - centerY) / radiusY);
    let nearest = 0;
    let closest = Infinity;
    for (const [index, bound] of bounds.slice(0, -1).entries()) {
      const delta = angleDelta(angle, bound);
      if (delta < closest) {
        closest = delta;
        nearest = index;
      }
    }
    return chars[nearest];
  };
}

/** Null unless the caller asked for drawn spokes. */
function makeSpokeAt(options, bounds, geometry) {
  if (!options.spokes) return null;
  return spokeAtFor(bounds, spokeCharsFor(bounds, geometry.radiusX, geometry.radiusY), geometry);
}

// --- Layout ---------------------------------------------------------------

function pieGlyphs(options, slices) {
  return options.glyphs ?? (options.textured ? seriesGlyphs(slices.length) : slices.map(() => SOLID));
}

function pieBounds(slices) {
  return cumulativeFractions(slices.map((slice) => slice.value));
}

/** True when this layout should stamp percentage labels into the wedges. */
function wantsLabels(options, slices) {
  return options.labels !== false && slices.length > 1;
}

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
  const geometry = discGeometry(options);
  const { width, height } = geometry;
  const cells = blankGrid(width, height);

  if (slices.length === 0) return { width, height, cells };

  const glyphs = pieGlyphs(options, slices);
  const bounds = pieBounds(slices);
  const sliceAt = sliceAtFor(bounds, slices.length, geometry);
  const sampler = makeSampler(options.mosaic);
  paintPieCells(cells, sampler, sliceAt, geometry, glyphs, makeSpokeAt(options, bounds, geometry));

  const labelsDropped = wantsLabels(options, slices) ? stampLabels(cells, slices, options) : 0;
  return { width, height, cells, labelsDropped };
}

// --- Labels ---------------------------------------------------------------

function labelText(slice, total, options) {
  return options.labelFormat ? options.labelFormat(slice, total) : `${Math.round((slice.value / total) * 100)}%`;
}

function labelWidth(label) {
  return label ? cols(label) : 0;
}

function isOwned(cell, index) {
  return cell.slice === index && cell.kind === "fill";
}

/** Every run of fully owned cells in one row, left to right. */
function ownedRuns(row, index) {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= row.length; x++) {
    const mine = x < row.length && isOwned(row[x], index);
    if (mine === (start >= 0)) continue;
    if (mine) {
      start = x;
      continue;
    }
    runs.push({ start, length: x - start });
    start = -1;
  }
  return runs;
}

/** The longer of two runs; ties keep the first one found. */
function longerRun(best, run) {
  return !best || run.length > best.length ? run : best;
}

/** The widest run of this slice's cells across the whole grid. */
function widestRun(cells, index) {
  let best = null;
  for (let y = 0; y < cells.length; y++) {
    for (const run of ownedRuns(cells[y], index)) {
      best = longerRun(best, { ...run, y });
    }
  }
  return best;
}

function labelFits(best, length) {
  return best !== null && best.length >= length + 2;
}

/** Write the label into its run; returns the cursor after the last glyph. */
function stampRun(cells, index, best, label, from) {
  const end = best.start + best.length;
  let cursor = from;
  for (const glyph of graphemes(label)) {
    const cellsWide = graphemeWidth(glyph);
    if (cursor + cellsWide > end) break;
    cells[best.y][cursor] = { slice: index, char: glyph, kind: "label" };
    if (cellsWide === 2) {
      cells[best.y][cursor + 1] = { slice: index, char: "", kind: "label", cont: true };
    }
    cursor += cellsWide;
  }
  return cursor;
}

/** Stamp one slice's label; 0 when it fits, 1 when it is dropped. */
function stampSlice(cells, index, slice, total, options) {
  const label = labelText(slice, total, options);
  const length = labelWidth(label);
  if (length === 0) return 0;
  const best = widestRun(cells, index);
  if (!labelFits(best, length)) return 1;
  // Only a fully owned cell can carry the label. An "edge" cell belongs to two
  // wedges, so writing there would erase the boundary.
  const from = best.start + Math.floor((best.length - length) / 2);
  const cursor = stampRun(cells, index, best, label, from);
  return cursor < from + length ? 1 : 0;
}

function sliceTotal(slices) {
  return slices.reduce((sum, slice) => sum + slice.value, 0);
}

/** Percentage inside the widest run of each wedge, when there is room. */
function stampLabels(cells, slices, options) {
  const total = sliceTotal(slices);
  let dropped = 0;
  for (const [index, slice] of slices.entries()) {
    dropped += stampSlice(cells, index, slice, total, options);
  }
  return dropped;
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
  const { width, cells, labelsDropped } = layoutPie(slices, options);
  const rows = cells.map((row) => ({ width, runs: cellsToRuns(row) }));
  if (labelsDropped > 0) {
    const label = labelsDropped === 1 ? "label" : "labels";
    rows.push({
      width,
      runs: [{ text: truncate(`${labelsDropped} ${label} dropped`, width), slice: -1, kind: "legend" }],
    });
  }
  return rows;
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
  const aspect = Number(spec.cellAspect) > 0 ? Number(spec.cellAspect) : 2;
  const radiusX = Math.max(2, (width - 2 * margin) / 2);
  // The same cap layoutPie applies: a wide frame gets a wide *chart*, not a
  // 70-row disc.
  const fallback = Math.max(3, Math.min(28, Math.round((2 * radiusX) / aspect) + 2));
  const legendRows = spec.legend === false || spec.plainLegend === true ? 0 : readSlices(spec).length;
  return plotRowsFor(spec, {
    chrome: (spec.title ? 1 : 0) + legendRows,
    fallback,
    min: 3,
    max: 28,
  });
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

// --- Chart wrappers -------------------------------------------------------

function chartWidth(spec) {
  return Math.max(16, Math.floor(spec.width ?? 48));
}

function chartMargin(spec) {
  return Math.max(0, Math.min(3, Math.floor(spec.margin ?? 1)));
}

function titleLine(title, width) {
  return truncate(title, width) + BLANK.repeat(Math.max(0, width - cols(title)));
}

function hasLegend(spec, slices) {
  return spec.legend !== false && slices.length > 0;
}

function hasRowLegend(spec, slices) {
  return spec.legend !== false && slices.length > 0 && spec.plainLegend !== true;
}

export function renderPieChart(spec) {
  const width = chartWidth(spec);
  const margin = chartMargin(spec);
  const slices = readSlices(spec);
  const glyphs = resolveGlyphs(spec, slices);

  const lines = [];
  if (spec.title) lines.push(titleLine(spec.title, width));

  lines.push(
    ...renderPie(slices, {
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

  if (hasLegend(spec, slices)) {
    lines.push(...legendLines(slices, { width, glyphs, markers: spec.markers }));
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
  const width = chartWidth(spec);
  const margin = chartMargin(spec);
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

  if (hasRowLegend(spec, slices)) {
    rows.push(...legendRowRuns(slices, { width, marker: "●" }));
  }

  return rows;
}
