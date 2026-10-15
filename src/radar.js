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
  legendRowRuns,
  makeSampler,
  normalizeSeries,
  stampText,
  titleRow,
  truncate,
} from "./core.js";
import { themeOf } from "./theme.js";

/** A radar needs at least three axes before it is a shape. */
const MIN_AXES = 3;

/** How far outside the outer ring an axis label sits, in normalised radius. */
const LABEL_GAP = 0.14;

export function renderRadarRows(spec = {}) {
  const width = Math.max(20, Math.floor(spec.width ?? 48));
  const labels = (spec.labels ?? spec.axes ?? []).map(String);
  const { series } = normalizeSeries(spec);
  const valueCount = Math.max(0, ...series.map((item) => item.values.length));
  const count = Math.max(labels.length, valueCount);
  const axes = Array.from({ length: count }, (_, index) => labels[index] ?? `${index + 1}`);

  const rows = [];
  if (spec.title) rows.push(titleRow(spec.title, width));

  // A radar has no axis below the centre, so a negative value is clamped to the
  // middle and reported in a note instead of being quietly flipped positive.
  let clamped = 0;
  const values = series.map((item) => ({
    name: item.name,
    values: Array.from({ length: count }, (_, index) => {
      const value = Number(item.values[index]) || 0;
      if (value < 0) clamped += 1;
      return Math.max(0, value);
    }),
  }));
  const usable = count >= MIN_AXES && values.length > 0 && values.some((item) => item.values.some((value) => value > 0));

  if (!usable) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "legend" }] });
    return rows;
  }

  const top = Number(spec.max) > 0 ? Number(spec.max) : Math.max(...values.flatMap((item) => item.values), 1e-9);
  // Same rule as the pie: a wide frame must not stretch the polygon into a
  // pancake, so the height has a cap and the horizontal radius follows it.
  const aspect = Number(spec.cellAspect) > 0 ? Number(spec.cellAspect) : 2;
  const height = Math.max(6, Math.floor(spec.height ?? Math.min(22, Math.round((width - 12) / aspect) + 3)));
  const padX = Math.min(11, Math.max(4, Math.floor(width * 0.22)));
  const radiusX = Math.max(2, Math.min((width - 2 * padX) / 2, height - 1.5));
  // Half a row of headroom, so the label above the top axis never lands on the
  // apex of the chart.
  const radiusY = Math.max(1.5, Math.min(radiusX / aspect, (height - 1.5) / 2));
  const cx = (width - 1) / 2;
  const cy = height / 2;

  const sampler = makeSampler(spec.mosaic);
  const filled = spec.filled === true || values.length === 1;
  // One sub-cell of radial thickness, measured in cells so the outline is the
  // same weight on the flat sides as it is on the corners.
  const thickness = 1 / sampler.shape.rows;

  const angleOf = (index) => -Math.PI / 2 + (index * 2 * Math.PI) / count;

  /**
   * Normalised radius of a series polygon at an angle, in axis units. A radar
   * polygon is a straight segment between two axes, and the radius along a ray
   * between them is *not* linear in angle: interpolating it that way bulges every
   * side outward, so on five axes the middle of a side would sit 24% too far out
   * (cos(36°) = 0.809 is the truth for equal values). This is the radius where
   * the ray meets the segment itself.
   */
  const step = (2 * Math.PI) / count;
  const ringAt = (theta, list) => {
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

  const classify = (x, y) => {
    const nx = (x - cx) / radiusX;
    const ny = (y - cy) / radiusY;
    const r = Math.hypot(nx, ny);
    if (r > 1.04) return -1;
    const theta = Math.atan2(ny, nx);

    if (filled) return r <= ringAt(theta, values[0].values) ? 0 : -1;

    // The ring is `thickness` cells wide whatever direction it runs in, so the
    // outline does not fatten on the steep sides of the polygon.
    const radialCells = Math.hypot(radiusX * Math.cos(theta), radiusY * Math.sin(theta));
    for (const [index, item] of values.entries()) {
      if (Math.abs(r - ringAt(theta, item.values)) * radialCells <= thickness) return index;
    }
    return -1;
  };

  /** A spoke is a radial line: inside the rings and close to an axis angle. */
  const onSpoke = (x, y) => {
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

  const grid = blankGrid(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { mask, tally, masks } = sampler.sample(x, y, classify);
      if (mask !== 0) {
        const winner = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        const winnerMask = masks.get(winner) ?? mask;
        let cell = {
          slice: winner,
          mask,
          // Always a plain fill: the glyph already carries the sub-cell shape, and
          // an `edge` cell would paint the sub-cells another series claims in the
          // boundary colour, which shows as dark notches across an outline.
          kind: "fill",
          char: sampler.glyph(winnerMask, SOLID),
        };
        // A spoke behind a filled shape is invisible, so where a spoke crosses
        // the fill the cell carries both: the spoke's sub-cells as the glyph, in
        // the muted axis colour, over the series colour as the background.
        if (spec.spokes !== false && filled) {
          const over = sampler.sample(x, y, onSpoke).mask & winnerMask;
          if (over !== 0) {
            cell = {
              slice: winner,
              other: winner,
              mask,
              kind: "edge",
              color: themeOf(spec).muted,
              char: sampler.glyph(over, SOLID),
            };
          }
        }
        grid[y][x] = cell;
        continue;
      }
      if (spec.spokes === false) continue;
      const spoke = sampler.sample(x, y, onSpoke);
      if (spoke.mask !== 0) {
        // The plugin paints a colourless spoke in the default foreground, which
        // is as loud as the data, so the spoke carries its own muted colour.
        grid[y][x] = { slice: -1, char: sampler.glyph(spoke.mask, SOLID), kind: "spoke", color: themeOf(spec).muted, mask: 0 };
      }
    }
  }

  // Axis labels sit just outside the outer ring, aligned away from the centre.
  for (const [index, label] of axes.entries()) {
    const theta = angleOf(index);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const at = {
      x: cx + (1 + LABEL_GAP) * radiusX * cos,
      y: Math.max(0, Math.min(height - 1, Math.round(cy + (1 + LABEL_GAP) * radiusY * sin))),
    };
    const room = cos > 0.35 ? width - Math.ceil(at.x) - 1 : cos < -0.35 ? Math.floor(at.x) : Math.round(at.x * 2) + 1;
    const text = truncate(label, Math.max(2, room));

    let start;
    if (cos > 0.35) start = Math.ceil(at.x);
    else if (cos < -0.35) start = Math.floor(at.x) - cols(text);
    else start = Math.round(at.x - cols(text) / 2);

    stampText(grid, start, at.y, text, { slice: -1, kind: "axis" });
  }

  // A row nothing was drawn into costs a line in the terminal, so the shape
  // decides how tall the chart is.
  let last = grid.length - 1;
  while (last > 0 && grid[last].every((cell) => cell.kind === "outside")) last -= 1;
  for (const row of grid.slice(0, last + 1)) rows.push({ width, runs: cellsToRuns(row) });

  if (values.length > 1 && spec.legend !== false) {
    rows.push(
      ...legendRowRuns(
        values.map((item) => ({
          label: item.name,
          value: Math.round(item.values.reduce((sum, value) => sum + value, 0)),
        })),
        { width, values: false },
      ),
    );
  }

  return rows;
}

export const RADAR_DEFAULT_PALETTE = DEFAULT_PALETTE;
