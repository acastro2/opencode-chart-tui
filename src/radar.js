/**
 * Radar (spider) charts.
 *
 * Design notes:
 *   1. Aspect correction. The polygon lives on an ellipse in cell space: the
 *      horizontal radius is `radiusX` cells and the vertical one is half that,
 *      so the ring looks round on screen.
 *   2. Sub-cell sampling. Every cell is sampled at mosaic resolution, which is
 *      what keeps the polygon outline smooth instead of staircased.
 *   3. Outline or fill. One series fills its polygon, which is the readable
 *      case. Several series draw a one-sub-cell outline each, so overlapping
 *      shapes stay distinguishable instead of painting over each other.
 *   4. The axis spokes are painted only where no polygon covers them, so they
 *      read as the frame of the chart rather than cutting through the data.
 */

import {
  DEFAULT_PALETTE,
  SOLID,
  blankGrid,
  cellsToRuns,
  cols,
  formatNumber,
  legendRowRuns,
  makeSampler,
  normalizeSeries,
  stampText,
  titleRow,
  truncate,
} from "./core.js";
import { themeOf } from "./theme.js";
import { plotRows as plotRowsFor } from "./layout.js";

/** A radar needs at least three axes before it is a shape. */
const MIN_AXES = 3;

/** How far outside the outer ring an axis label sits, in normalised radius. */
const LABEL_GAP = 0.14;

/** How far outside the outer ring a cell still counts as part of the polygon. */
const RIM_SLACK = 1.04;

/** Shifts tried, nearest first, when a label collides with one already placed. */
const LABEL_SHIFTS = [0, 1, -1, 2, -2, 3, -3];

/** The footer note for clamped negatives, or null when none were clamped. */
function clampNoteOf(clamped) {
  if (clamped === 0) return null;
  return `${clamped} negative ${clamped === 1 ? "value" : "values"} clamped to 0`;
}

/** How many values sit past the top of the scale and stop at the rim. */
function clippedCountOf(values, top) {
  return values.reduce((count, item) => count + item.values.filter((value) => value > top).length, 0);
}

/** The footer note for clipped values, or null when every value fits the scale. */
function clipNoteOf(clipped, top) {
  if (clipped === 0) return null;
  return `${clipped} ${clipped === 1 ? "value" : "values"} above max clipped to ${formatNumber(top)}`;
}

/**
 * The values every drawing step reads: one row per series, padded to `count`
 * axes. A radar has no axis below the centre, so a negative value is clamped to
 * the middle and counted, never quietly flipped positive.
 */
function radarValues(series, count) {
  let clamped = 0;
  const values = series.map((item) => ({
    name: item.name,
    values: Array.from({ length: count }, (_, index) => {
      const value = Number(item.values[index]) || 0;
      if (value < 0) clamped += 1;
      return Math.max(0, value);
    }),
  }));
  return { values, clamped };
}

/** One label per axis; an unnamed axis is named after its position. */
function axesOf(labels, count) {
  return Array.from({ length: count }, (_, index) => labels[index] ?? `${index + 1}`);
}

/** Notes are rows too, so reserve them before the polygon is laid out. */
function noteRowCountOf(clamped, clipped, seriesCount, filled) {
  return (clamped > 0 ? 1 : 0) + (clipped > 0 ? 1 : 0) + (seriesCount > 1 && !filled ? 1 : 0);
}

/**
 * The frame the polygon lives in: how tall the block is and where the ellipse
 * sits. A wide frame must not stretch the polygon into a pancake, so the height
 * has a cap and the horizontal radius follows it. `legendHeight` and `notes` are
 * the rows the caller reserved around the plot.
 */
function radarFrameOf(spec, { width, legendHeight, notes }) {
  const aspect = Number(spec.cellAspect) > 0 ? Number(spec.cellAspect) : 2;
  const chrome = (spec.title ? 1 : 0) + legendHeight + notes;
  const height = plotRowsFor(spec, {
    chrome,
    fallback: Math.min(22, Math.round((width - 12) / aspect) + 3),
    min: 6,
    max: 30,
  });
  const padX = Math.min(11, Math.max(4, Math.floor(width * 0.22)));
  const radiusX = Math.max(2, Math.min((width - 2 * padX) / 2, height - 1.5));
  return {
    height,
    radiusX,
    // Half a row of headroom, so the label above the top axis never lands on the
    // apex of the chart.
    radiusY: Math.max(1.5, Math.min(radiusX / aspect, (height - 1.5) / 2)),
    cx: (width - 1) / 2,
    cy: height / 2,
  };
}

/**
 * Normalised radius of a series polygon at an angle, in axis units. A radar
 * polygon is a straight segment between two axes, and the radius along a ray
 * between them is *not* linear in angle: interpolating it that way bulges every
 * side outward, so on five axes the middle of a side would sit 24% too far out
 * (cos(36°) = 0.809 is the truth for equal values). This is the radius where
 * the ray meets the segment itself.
 */
function ringRadiusOf({ count, top }) {
  const step = (2 * Math.PI) / count;
  return (theta, list) => {
    const turns = ((theta + Math.PI / 2) / (2 * Math.PI)) * count;
    const base = Math.floor(turns);
    const t = turns - base;
    const at = (index) => list[(((index % count) + count) % count)] ?? 0;
    const left = at(base);
    const right = at(base + 1);
    const denominator = left * Math.sin(t * step) + right * Math.sin((1 - t) * step);
    if (!(denominator > 0)) return 0;
    return Math.max(0, (left * right * Math.sin(step)) / denominator) / top;
  };
}

/** The one filled series owns every point inside its ring. */
function filledSliceOf(values, ringAt, theta, r) {
  return r <= ringAt(theta, values[0].values) ? 0 : -1;
}

/** Which series covers a point, or -1 when nothing does. */
function classifyCell({ values, filled, cx, cy, radiusX, radiusY, ringAt, thickness }, x, y) {
  const nx = (x - cx) / radiusX;
  const ny = (y - cy) / radiusY;
  const r = Math.hypot(nx, ny);
  if (r > RIM_SLACK) return -1;
  const theta = Math.atan2(ny, nx);

  if (filled) return filledSliceOf(values, ringAt, theta, r);

  // The ring is `thickness` cells wide whatever direction it runs in, so the
  // outline does not fatten on the steep sides of the polygon.
  const radialCells = Math.hypot(radiusX * Math.cos(theta), radiusY * Math.sin(theta));
  for (const [index, item] of values.entries()) {
    if (Math.abs(r - ringAt(theta, item.values)) * radialCells <= thickness) return index;
  }
  return -1;
}

/** Bind the frame and the values once, then classify a point at a time. */
function classifierOf(state) {
  return (x, y) => classifyCell(state, x, y);
}

/** A spoke is a radial line: inside the rings and close to an axis angle. */
function spokeTesterOf({ values, count, angleOf, cx, cy, radiusX, radiusY, sampler, ringAt }) {
  return (x, y) => {
    const nx = (x - cx) / radiusX;
    const ny = (y - cy) / radiusY;
    const r = Math.hypot(nx, ny);
    if (r > 1) return -1;
    const theta = Math.atan2(ny, nx);
    // One sub-cell of width wherever the ray is, so the tolerance is an angle
    // that shrinks as the radius grows. A constant angle fans the spoke into a
    // wedge by the time it reaches the labels.
    const tolerance = 1 / Math.max(1, r * radiusX * sampler.shape.columns);
    for (let index = 0; index < count; index++) {
      const delta = Math.abs(theta - angleOf(index));
      const wrapped = Math.min(delta, Math.abs(2 * Math.PI - delta));
      if (wrapped > tolerance) continue;
      // Only as far as the outermost shape draws: a spoke that runs past the
      // data to the labels reads as an arrow.
      const outer = Math.max(...values.map((item) => ringAt(theta, item.values)));
      return r <= outer + 1 / sampler.shape.rows ? index : -1;
    }
    return -1;
  };
}

/** The series that owns most of a cell, ties going to the lower index. */
function winnerOf(tally) {
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** The filled cell again, carrying the spoke's sub-cells over the series colour. */
function spokeOverCell({ sampler, onSpoke, muted, winner, mask, winnerMask, x, y }) {
  const over = sampler.sample(x, y, onSpoke).mask & winnerMask;
  if (over === 0) return null;
  return {
    slice: winner,
    other: winner,
    mask,
    kind: "edge",
    color: muted,
    char: sampler.glyph(over, SOLID),
  };
}

/**
 * The cell for a point the data covers, or null when it covers none. A spoke
 * behind a filled shape is invisible, so where a spoke crosses the fill the cell
 * carries both: the spoke's sub-cells as the glyph, in the muted axis colour,
 * over the series colour as the background.
 */
function dataCellOf({ sampler, classify, crossSpokes, onSpoke, muted, x, y }) {
  const { mask, tally, masks } = sampler.sample(x, y, classify);
  if (mask === 0) return null;
  const winner = winnerOf(tally);
  const winnerMask = masks.get(winner) ?? mask;
  // Always a plain fill: the glyph already carries the sub-cell shape, and an
  // `edge` cell would paint the sub-cells another series claims in the boundary
  // colour, which shows as dark notches across an outline.
  const cell = {
    slice: winner,
    mask,
    kind: "fill",
    char: sampler.glyph(winnerMask, SOLID),
  };
  if (!crossSpokes) return cell;
  return spokeOverCell({ sampler, onSpoke, muted, winner, mask, winnerMask, x, y }) ?? cell;
}

/**
 * The cell for a point a spoke crosses, or null when none does. The plugin
 * paints a colourless spoke in the default foreground, which is as loud as the
 * data, so the spoke carries its own muted colour.
 */
function spokeCellOf({ sampler, onSpoke, muted, x, y }) {
  const spoke = sampler.sample(x, y, onSpoke);
  if (spoke.mask === 0) return null;
  return { slice: -1, char: sampler.glyph(spoke.mask, SOLID), kind: "spoke", color: muted, mask: 0 };
}

/** The cell to paint at a point: the data first, a spoke only where it is bare. */
function cellAtOf({ sampler, classify, onSpoke, spokes, filled, muted, x, y }) {
  const data = dataCellOf({ sampler, classify, crossSpokes: spokes && filled, onSpoke, muted, x, y });
  if (data) return data;
  return spokes ? spokeCellOf({ sampler, onSpoke, muted, x, y }) : null;
}

/** Every cell of the block, painted data first and spokes only where it is bare. */
function radarGridOf({ width, height, sampler, classify, onSpoke, spokes, filled, muted }) {
  const grid = blankGrid(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cellAtOf({ sampler, classify, onSpoke, spokes, filled, muted, x, y });
      if (cell) grid[y][x] = cell;
    }
  }
  return grid;
}

/** Where an axis label sits: the point outside the ring, and the room its row has. */
function labelSpotOf({ index, angleOf, width, height, cx, cy, radiusX, radiusY }) {
  const theta = angleOf(index);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const x = cx + (1 + LABEL_GAP) * radiusX * cos;
  return {
    x,
    y: Math.max(0, Math.min(height - 1, Math.round(cy + (1 + LABEL_GAP) * radiusY * sin))),
    cos,
    // A label on the right grows leftwards from the rim, one on the left grows
    // rightwards, and one near the top or bottom is centred on its axis.
    room: cos > 0.35 ? width - Math.ceil(x) - 1 : cos < -0.35 ? Math.floor(x) : Math.round(x * 2) + 1,
  };
}

/** The first cell a label would like to start at, given which side it is on. */
function labelAnchorOf(x, cos, textWidth) {
  if (cos > 0.35) return Math.ceil(x);
  if (cos < -0.35) return Math.floor(x) - textWidth;
  return Math.round(x - textWidth / 2);
}

/** True when the label leaves the row or touches one already placed there. */
function collidesWith(placed, { start, y, text, width }) {
  const w = cols(text);
  return (
    start < 0 ||
    start + w > width ||
    placed.some((box) => box.y === y && start < box.x + box.w && box.x < start + w)
  );
}

/** A label starts inside the row: never before its first cell, never past its last. */
function clampStart(start, textWidth, width) {
  return Math.max(0, Math.min(start, width - textWidth));
}

/** The nearest shift that does not touch a placed label, or null when none does. */
function shiftIntoRow({ anchor, text, y, placed, width }) {
  for (const shift of LABEL_SHIFTS) {
    const start = clampStart(anchor + shift, cols(text), width);
    if (!collidesWith(placed, { start, y, text, width })) return start;
  }
  return null;
}

/** The longest prefix that fits at the anchor, or null when even one cell does not. */
function shortenIntoRow({ anchor, text, y, placed, width }) {
  let shortened = text;
  while (cols(shortened) > 1) {
    shortened = truncate(shortened, cols(shortened) - 1);
    const start = clampStart(anchor, cols(shortened), width);
    if (!collidesWith(placed, { start, y, text: shortened, width })) return { start, text: shortened };
  }
  return null;
}

/** Trim, shift, then shorten a label until it fits without touching another. */
function placeLabelOf({ label, spot, placed, width }) {
  const text = truncate(label, Math.max(1, Math.min(spot.room, width)));
  if (!text) return null;
  const anchor = labelAnchorOf(spot.x, spot.cos, cols(text));

  const shifted = shiftIntoRow({ anchor, text, y: spot.y, placed, width });
  if (shifted !== null) return { x: shifted, y: spot.y, w: cols(text), text };

  const shortened = shortenIntoRow({ anchor, text, y: spot.y, placed, width });
  if (!shortened) return null;
  return { x: shortened.start, y: spot.y, w: cols(shortened.text), text: shortened.text };
}

/**
 * Axis labels sit just outside the outer ring, aligned away from the centre. A
 * label that cannot fit without touching another one is shortened, then dropped
 * and counted, so the note row can say so instead of hiding the omission.
 */
function stampAxisLabels({ grid, axes, width, height, cx, cy, radiusX, radiusY, angleOf }) {
  const placed = [];
  let dropped = 0;
  for (const [index, label] of axes.entries()) {
    const spot = labelSpotOf({ index, angleOf, width, height, cx, cy, radiusX, radiusY });
    const fitted = placeLabelOf({ label, spot, placed, width });
    if (!fitted) {
      dropped += 1;
      continue;
    }
    placed.push({ x: fitted.x, y: fitted.y, w: fitted.w });
    stampText(grid, fitted.x, fitted.y, fitted.text, { slice: -1, kind: "axis" });
  }
  return dropped;
}

/** The drawn rows, with trailing empty ones cut: an empty row costs a line. */
function drawnRowsOf(grid, width) {
  let last = grid.length - 1;
  while (last > 0 && grid[last].every((cell) => cell.kind === "outside")) last -= 1;
  return grid.slice(0, last + 1).map((row) => ({ width, runs: cellsToRuns(row) }));
}

/** A legend-styled one-line note, clipped to the block. */
function noteRowOf(width, text) {
  return { width, runs: [{ text: truncate(text, width), slice: -1, kind: "legend" }] };
}

/** The note for labels that could not be placed, or null when none were. */
function droppedNoteOf(width, dropped) {
  if (dropped === 0) return null;
  const label = dropped === 1 ? "label" : "labels";
  return noteRowOf(width, `${dropped} axis ${label} dropped`);
}

/** The notes below the polygon, in the order they are reserved and reported. */
function noteRowsOf({ width, clampNote, clipNote, seriesCount, filled, dropped }) {
  const rows = [];
  if (clampNote) rows.push(noteRowOf(width, clampNote));
  // A value above `max` stops at the rim, so it looks the same as a value that
  // exactly fills the scale. Say that the picture ran out of room.
  if (clipNote) rows.push(noteRowOf(width, clipNote));
  // Several unfilled series draw one outline each on the same ring. Where two
  // outlines run close together the later series wins the cell, so say that an
  // overlap is possible instead of pretending the drawing is clean.
  if (seriesCount > 1 && !filled) rows.push(noteRowOf(width, "outlines may overlap"));
  const droppedNote = droppedNoteOf(width, dropped);
  if (droppedNote) rows.push(droppedNote);
  return rows;
}

/** The legend: one entry per series, summing that series' values. */
function legendRowsOf(values, width) {
  return legendRowRuns(
    values.map((item) => ({
      label: item.name,
      value: Math.round(item.values.reduce((sum, value) => sum + value, 0)),
    })),
    { width, values: false },
  );
}

/** The chart width, never narrower than the frame needs. */
function widthOf(spec) {
  return Math.max(20, Math.floor(spec.width ?? 48));
}

/** Axis names from `labels`, else `axes`, each as text. A non-array field is ignored. */
function axisLabelsOf(spec) {
  const labels = Array.isArray(spec.labels) ? spec.labels : Array.isArray(spec.axes) ? spec.axes : [];
  return labels.map(String);
}

/** The top of the scale: the spec's `max`, else the largest value drawn. */
function topOf(spec, values) {
  return Number(spec.max) > 0 ? Number(spec.max) : Math.max(...values.flatMap((item) => item.values), 1e-9);
}

/** One series always fills its shape; several fill only when asked. */
function filledOf(spec, seriesCount) {
  return spec.filled === true || seriesCount === 1;
}

/** Spokes are drawn unless the spec turns them off. */
function spokesOf(spec) {
  return spec.spokes !== false;
}

/** A legend is drawn for several series unless the spec turns it off. */
function legendOf(spec, seriesCount) {
  return seriesCount > 1 && spec.legend !== false;
}

/** True when there are enough axes and at least one positive value. */
function usableOf(values, count) {
  return count >= MIN_AXES && values.length > 0 && values.some((item) => item.values.some((value) => value > 0));
}

/** The title row, or no rows when the spec has no title. */
function titleRowsOf(spec, width) {
  return spec.title ? [titleRow(spec.title, width)] : [];
}

/** The block for a spec that cannot draw a polygon. */
function emptyRowsOf({ spec, width, clampNote, clipNote }) {
  const rows = [...titleRowsOf(spec, width), { width, runs: [{ text: "  no data", slice: -1, kind: "legend" }] }];
  if (clampNote) rows.push(noteRowOf(width, clampNote));
  if (clipNote) rows.push(noteRowOf(width, clipNote));
  return rows;
}

/** One full draw with `noteRows` reserved; the label pass reports what it dropped. */
function radarPassOf({ spec, width, axes, values, clampNote, clipNote, top, noteRows }) {
  const count = axes.length;
  const filled = filledOf(spec, values.length);
  const legend = legendOf(spec, values.length);
  const spokes = spokesOf(spec);
  const frame = radarFrameOf(spec, {
    width,
    legendHeight: legend ? values.length : 0,
    notes: noteRows,
  });

  const sampler = makeSampler(spec.mosaic);
  const angleOf = (index) => -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const ringAt = ringRadiusOf({ count, top });
  // One sub-cell of radial thickness, measured in cells so the outline is the
  // same weight on the flat sides as it is on the corners.
  const classify = classifierOf({
    values,
    filled,
    cx: frame.cx,
    cy: frame.cy,
    radiusX: frame.radiusX,
    radiusY: frame.radiusY,
    ringAt,
    thickness: 1 / sampler.shape.rows,
  });
  const onSpoke = spokes
    ? spokeTesterOf({
        values,
        count,
        angleOf,
        cx: frame.cx,
        cy: frame.cy,
        radiusX: frame.radiusX,
        radiusY: frame.radiusY,
        sampler,
        ringAt,
      })
    : null;

  const grid = radarGridOf({
    width,
    height: frame.height,
    sampler,
    classify,
    onSpoke,
    spokes,
    filled,
    muted: themeOf(spec).muted,
  });
  const dropped = stampAxisLabels({
    grid,
    axes,
    width,
    height: frame.height,
    cx: frame.cx,
    cy: frame.cy,
    radiusX: frame.radiusX,
    radiusY: frame.radiusY,
    angleOf,
  });

  const rows = titleRowsOf(spec, width);
  rows.push(...drawnRowsOf(grid, width));
  rows.push(...noteRowsOf({ width, clampNote, clipNote, seriesCount: values.length, filled, dropped }));
  if (legend) rows.push(...legendRowsOf(values, width));
  return { rows, dropped };
}

/**
 * The frame, the polygon, its axis labels, then the notes and the legend.
 *
 * The dropped count is only known after the label pass, and its note costs a
 * row. Draw once, then redraw with one more note row reserved when any label was
 * dropped, so at a fixed height the note never pushes the legend out.
 */
function radarRowsOf({ spec, width, axes, values, clamped, clampNote, clipped, clipNote, top }) {
  const notes = noteRowCountOf(clamped, clipped, values.length, filledOf(spec, values.length));
  const first = radarPassOf({ spec, width, axes, values, clampNote, clipNote, top, noteRows: notes });
  if (first.dropped === 0) return first.rows;
  return radarPassOf({ spec, width, axes, values, clampNote, clipNote, top, noteRows: notes + 1 }).rows;
}

export function renderRadarRows(spec = {}) {
  const width = widthOf(spec);
  const labels = axisLabelsOf(spec);
  const { series } = normalizeSeries(spec);
  const valueCount = Math.max(0, ...series.map((item) => item.values.length));
  const count = Math.max(labels.length, valueCount);
  const axes = axesOf(labels, count);

  const { values, clamped } = radarValues(series, count);
  const top = topOf(spec, values);
  const clipped = clippedCountOf(values, top);
  const clampNote = clampNoteOf(clamped);
  const clipNote = clipNoteOf(clipped, top);
  if (!usableOf(values, count)) return emptyRowsOf({ spec, width, clampNote, clipNote });

  return radarRowsOf({ spec, width, axes, values, clamped, clampNote, clipped, clipNote, top });
}

export const RADAR_DEFAULT_PALETTE = DEFAULT_PALETTE;
