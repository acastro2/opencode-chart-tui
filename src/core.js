// Shared pieces for every chart drawn in a character grid: the palette, colour
// helpers, the run model, the legend, and the sub-cell sampler that lets a curve
// follow something finer than a whole cell.
//
// Nothing here knows what a pie or a bar is. Each family imports this and adds
// its own geometry.

import { glyphFor, modeShape } from "./mosaic.js";

export const SOLID = "█";
export const BLANK = " ";

/** Textures for callers with no colour, so neighbouring series still differ. */
export const TEXTURES = {
  four: ["█", "░", "▓", "▒"],
  eight: ["█", "░", "▓", "▒", "▚", "▞", "▨", "▩"],
};

/** Line characters chosen by the direction of a boundary a cell crosses. */
export const SPOKE = {
  horizontal: "─",
  vertical: "│",
  downRight: "╲", // upper left to lower right, y grows downward
  upRight: "╱",
};

/** Default series colours, ordered for maximum separation at small sizes. */
export const DEFAULT_PALETTE = [
  "#4e9de0", // blue
  "#57c98a", // green
  "#e5b83c", // amber
  "#e5695f", // red
  "#a98bd8", // violet
  "#43b8b0", // teal
  "#e08bc0", // pink
  "#9a9a52", // olive
];

/** Dark text on a light fill, light text on a dark fill. */
export function contrastOn(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
  const red = parseInt(full.slice(0, 2), 16) || 0;
  const green = parseInt(full.slice(2, 4), 16) || 0;
  const blue = parseInt(full.slice(4, 6), 16) || 0;
  // Rec. 709 relative luminance, good enough to choose black or white.
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.45 ? "#101010" : "#ffffff";
}

/** "62.0%" */
export function formatPercent(value, total) {
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Short numbers for axes and value labels: 1234 -> "1.23k", 2500000 -> "2.5M",
 * 0.25 -> "0.25". Keeps the gutter narrow without lying about the magnitude: a
 * value under 0.01 keeps two significant digits instead of rounding to "0", and
 * 999,999 reads as "1M" rather than "1000k", because the unit is chosen after
 * the mantissa is rounded.
 */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "?";
  if (number === 0) return "0";
  const sign = number < 0 ? "-" : "";
  const size = Math.abs(number);
  const round = (scaled) => {
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
    // Strip trailing zeros after a decimal point only: 1.20 -> 1.2, but 120 stays 120.
    return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  };

  if (size < 0.01) return `${sign}${Number(size.toPrecision(2)).toString()}`;
  if (size < 1000) return `${sign}${round(size)}`;

  const units = ["", "k", "M", "G", "T", "P"];
  let power = 0;
  let scaled = size;
  while (scaled >= 1000 && power < units.length - 1) {
    scaled /= 1000;
    power += 1;
  }
  let text = round(scaled);
  if (Number(text) >= 1000 && power < units.length - 1) {
    power += 1;
    text = round(size / 1000 ** power);
  }
  return `${sign}${text}${units[power]}`;
}

/**
 * Width in code points, not UTF-16 units. The mosaic glyphs live outside the
 * basic multilingual plane, so `text.length` counts them twice.
 */
export function cols(text) {
  return [...String(text)].length;
}

/** Cut to a width in code points, with an ellipsis when it does not fit. */
export function truncate(text, width) {
  const value = String(text);
  if (width <= 0) return "";
  if (cols(value) <= width) return value;
  return [...value].slice(0, Math.max(1, width - 1)).join("") + "…";
}

/** Pad to a width in code points. */
export function padTo(text, width) {
  const value = String(text);
  const length = cols(value);
  return length >= width ? value : value + BLANK.repeat(width - length);}

/** Pad with spaces on the left, so numbers line up under each other. */
export function padStart(text, width) {
  const value = String(text);
  const pad = Math.max(0, width - cols(value));
  return BLANK.repeat(pad) + value;
}

/** Accept [[label, value]] or [{ label, value }], drop empty values, keep order. */
export function normalizeEntries(input) {
  const entries = [];
  for (const item of input ?? []) {
    const label = Array.isArray(item) ? item[0] : item?.label;
    const value = Number(Array.isArray(item) ? item[1] : item?.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    entries.push({ label: String(label ?? ""), value });
  }
  return entries;
}

/** Running totals as fractions of 1. */
export function cumulativeFractions(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  let running = 0;
  return values.map((value) => {
    running += value / total;
    return running;
  });
}

/** One glyph per series, for callers with no colour. */
export function seriesGlyphs(count) {
  if (count <= 0) return [];
  const set = count <= 4 ? TEXTURES.four : TEXTURES.eight;
  return Array.from({ length: count }, (_, index) => set[index % set.length]);
}

/** Blend two colours, for a gradient: t is 0 at `from` and 1 at `to`. */
export function mixHex(from, to, t) {
  const parse = (hex) => {
    const value = String(hex).replace("#", "");
    const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
    ];
  };
  const start = parse(from);
  const end = parse(to);
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  return `#${start
    .map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Blend two colours perceptually (OKLab) instead of channel by channel: a ramp
 * from dark blue to red through a perceptual space keeps its lightness, where
 * sRGB mixing dips through muddy browns.
 */
export function mixOklab(from, to, t) {
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  const start = oklabOf(from);
  const end = oklabOf(to);
  return hexOfOklab({
    L: start.L + (end.L - start.L) * amount,
    a: start.a + (end.a - start.a) * amount,
    b: start.b + (end.b - start.b) * amount,
  });
}

function channels(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value.slice(0, 6);
  return [
    (parseInt(full.slice(0, 2), 16) || 0) / 255,
    (parseInt(full.slice(2, 4), 16) || 0) / 255,
    (parseInt(full.slice(4, 6), 16) || 0) / 255,
  ];
}

const linear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const gamma = (channel) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** sRGB hex to OKLab (Björn Ottosson's matrices). */
function oklabOf(hex) {
  const [red, green, blue] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function hexOfOklab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channelsOut = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channelsOut
    .map((channel) => Math.round(clamp01(gamma(clamp01(channel))) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The series shape every chart family shares: labels plus one or more named
 * series of numbers. Accepts `values: [..]` for a single series or
 * `series: [{ name, values }]`, and a plain array of numbers for a series.
 * Missing labels become their position.
 */
export function normalizeSeries(spec, fallbackName = "value") {
  const raw =
    Array.isArray(spec.series) && spec.series.length > 0
      ? spec.series
      : Array.isArray(spec.values)
        ? [{ name: spec.name ?? fallbackName, values: spec.values }]
        : [];

  const series = [];
  for (const [index, item] of raw.entries()) {
    const numbers = Array.isArray(item) ? item : (item?.values ?? []);
    const values = [...numbers].map((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    });
    if (values.length === 0) continue;
    const name = Array.isArray(item) ? spec.name ?? fallbackName : item?.name ?? spec.name ?? `series ${index + 1}`;
    series.push({ name: String(name), values });
  }

  const length = Math.max(
    series.reduce((longest, item) => Math.max(longest, item.values.length), 0),
    Array.isArray(spec.labels) ? spec.labels.length : 0,
  );
  for (const item of series) while (item.values.length < length) item.values.push(0);

  const labels =
    Array.isArray(spec.labels) && spec.labels.length > 0
      ? Array.from({ length }, (_, index) => String(spec.labels[index] ?? index + 1))
      : Array.from({ length }, (_, index) => String(index + 1));

  return { labels, series };
}

/** Kept for callers that already speak of slices. */
export const sliceGlyphs = seriesGlyphs;

/**
 * Sub-cell sampler: every cell is sampled as a small grid (2x2, 2x3 or 2x4)
 * and drawn with the mosaic glyph that fills exactly the sub-cells inside the
 * shape. This is what makes a rim or a line follow the curve.
 *
 * @param {string|false} [mode] "sextant" (default), "octant", "quadrant", or
 *   false for quadrant, the universal-font fallback.
 */
export function makeSampler(mode) {
  // Sextants (Unicode 13) are the default: the glyphs are present in every
  // terminal font that draws blocks at all. Octants (Unicode 16) are smoother
  // and one field away — `"mosaic": "octant"` — but a font without them turns
  // the sub-cell rim into boxes, and a width check cannot see that.
  const mosaic = mode === false ? "quadrant" : (mode ?? "sextant");
  const shape = modeShape(mosaic);
  const subCells = shape.columns * shape.rows;

  return {
    mosaic,
    shape,
    subCells,
    solidMask: 2 ** subCells - 1,
    // A quadrant cell needs two of its four sub-cells before it joins the shape,
    // which is what the whole-cell renderer used to do. Finer modes can claim a
    // cell with a single sub-cell, because a fragment is already more faithful.
    minimum: mosaic === "quadrant" ? 2 : 1,

    /**
     * @param {number} x cell column
     * @param {number} y cell row
     * @param {(x: number, y: number) => (number|boolean)} classify returns the
     *   series index of the shape at that point, true for series 0, or a falsy
     *   value for a point outside the shape.
     */
    sample(x, y, classify) {
      const tally = new Map();
      const masks = new Map();
      let mask = 0;
      for (let row = 0; row < shape.rows; row++) {
        for (let column = 0; column < shape.columns; column++) {
          // Sub-cell centres, centred on the cell (-1/3, 0, +1/3 for a sextant).
          // Centring matters: an offset grid sampled from the cell edge is not
          // symmetric, so a rim drifts half a sub-cell.
          const value = classify(
            x + (column + 0.5 - shape.columns / 2) / shape.columns,
            y + (row + 0.5 - shape.rows / 2) / shape.rows,
          );
          if (value === false || value === null || value === undefined || value < 0) continue;
          const index = value === true ? 0 : value;
          const bit = 1 << (row * shape.columns + column);
          mask |= bit;
          masks.set(index, (masks.get(index) ?? 0) | bit);
          tally.set(index, (tally.get(index) ?? 0) + 1);
        }
      }
      return { mask, tally, masks };
    },

    /** The glyph for a mask, or the series glyph when the cell is fully filled. */
    glyph(mask, solidGlyph = SOLID) {
      return mask === 2 ** subCells - 1 ? solidGlyph : glyphFor(mask, mosaic);
    },
  };
}

/**
 * The same tally, read from a grid that already knows which series owns each
 * sub-cell: `seriesAt(subX, subY)` returns the series index or -1. Line and
 * area charts build the grid first and then ask this what each cell shows,
 * which keeps the sub-cell arithmetic in one place.
 */
export function tallyFromGrid(seriesAt, x, y, sampler) {
  const { columns, rows } = sampler.shape;
  const tally = new Map();
  const masks = new Map();
  let mask = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = seriesAt(x * columns + column, y * rows + row);
      if (!(index >= 0)) continue;
      const bit = 1 << (row * columns + column);
      mask |= bit;
      masks.set(index, (masks.get(index) ?? 0) | bit);
      tally.set(index, (tally.get(index) ?? 0) + 1);
    }
  }
  return { mask, tally, masks };
}

/**
 * What a cell shows, given the sub-cells inside it. One implementation of the
 * two-colour boundary: a cell crossed by a boundary carries both series at once,
 * the glyph filling the winning one and the cell background showing the other.
 *
 * @returns {{slice: number, other?: number, char: string, kind: string, mask: number}}
 *   kind is "fill" (also at the shape's edge, where the winner paints every
 *   owned sub-cell so nothing spills outside and no dark tick lands on the
 *   shape), "edge" (two series at once, wholly inside) or "spoke" when a
 *   `spoke` callback is supplied and the boundary meets the edge.
 */
export function paintCell({ sampler, mask, tally, masks, glyphs = [], solidGlyph = SOLID, spoke }) {
  const winner = winnerOf(tally);
  const winnerMask = masks.get(winner) ?? 0;

  if (winnerMask !== mask) {
    const other = secondIndex(tally, winner);
    if (mask === sampler.solidMask) {
      return { slice: winner, other, char: sampler.glyph(winnerMask), kind: "edge", mask };
    }
    if (spoke) return { slice: winner, other, char: spoke(winner), kind: "spoke", mask };
    return { slice: winner, other, char: sampler.glyph(mask), kind: "fill", mask };
  }

  return { slice: winner, char: sampler.glyph(mask, glyphs[winner] ?? solidGlyph), kind: "fill", mask };
}

/** Majority series of a cell, ties broken by the lower index. */
export function winnerOf(tally) {
  let winner = -1;
  let best = -1;
  for (const [index, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > best) {
      best = count;
      winner = index;
    }
  }
  return winner;
}

/** The most common series in a cell that is not the winner. */
export function secondIndex(tally, winner) {
  let other = -1;
  let best = -1;
  for (const [index, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (index === winner || count <= best) continue;
    best = count;
    other = index;
  }
  return other;
}

/**
 * Cells to runs, merged while series, kind and the second series agree. Trailing
 * blanks carry no information and only make the frame longer.
 */
export function cellsToRuns(cells) {
  const runs = [];
  let current = null;
  for (const cell of cells) {
    const other = cell.other ?? -1;
    const color = cell.color ?? null;
    const background = cell.background ?? null;
    if (
      current &&
      current.slice === cell.slice &&
      current.kind === cell.kind &&
      current.other === other &&
      (current.color ?? null) === color &&
      (current.background ?? null) === background
    ) {
      current.text += cell.char;
      continue;
    }
    current = { text: cell.char, slice: cell.slice, kind: cell.kind, other };
    // A run may carry its own colours, which is how a heat map paints a ramp
    // instead of a palette entry.
    if (color) current.color = color;
    if (background) current.background = background;
    runs.push(current);
  }
  while (runs.length > 0 && runs[runs.length - 1].text.trim() === "") runs.pop();
  return runs;
}

/** The plain text of a run row. */
export function runsText(runs) {
  return runs.map((run) => run.text).join("");
}

/** A single title row. */
export function titleRow(title, width) {
  return { width, runs: [{ text: truncate(title, width), slice: -1, kind: "title" }] };
}

function legendLayout(entries, options) {
  const width = Math.max(12, Math.floor(options.width ?? options.inner ?? 48));
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const values = entries.map((entry) => String(entry.value));
  const valueWidth = Math.max(...values.map((value) => value.length));
  const percentWidth = 6; // "100.0%"
  const indent = options.markers ? 2 : 0;
  const labelWidth = Math.max(4, width - indent - valueWidth - percentWidth - 2);
  return { width, total, values, valueWidth, percentWidth, labelWidth };
}

/** Legend lines in plain text, aligned on the label and the value. */
export function legendLines(entries, options = {}) {
  const glyphs = options.glyphs ?? [];
  const markers = options.markers ?? new Set(glyphs).size > 1;
  const { width, total, values, valueWidth, percentWidth, labelWidth } = legendLayout(entries, {
    ...options,
    markers,
  });

  return entries.map((entry, index) => {
    const prefix = markers ? `${glyphs[index] ?? "•"} ` : "";
    // A caller can drop the percentage and keep the value, which is what a 100%
    // chart wants in its legend: the shares are on the chart, not in the list.
    const tail =
      options.percent === false
        ? values[index].padStart(valueWidth)
        : `${values[index].padStart(valueWidth)} ${formatPercent(entry.value, total).padStart(percentWidth)}`;
    return padTo(`${prefix}${padTo(truncate(entry.label, labelWidth), labelWidth)}${tail}`, width);
  });
}

/** The same legend as runs, so each marker keeps its series colour. */
export function legendRowRuns(entries, options = {}) {
  // markers is true so the label width leaves room for the marker column.
  const { width, total, values, valueWidth, percentWidth, labelWidth } = legendLayout(entries, {
    ...options,
    markers: true,
  });
  const marker = options.marker ?? "●";

  if (options.values === false) {
    return entries.map((entry, index) => ({
      width,
      runs: [
        { text: `${marker} `, slice: index, kind: "legend-mark" },
        { text: truncate(entry.label, Math.max(1, width - 2)), slice: -1, kind: "legend" },
      ],
    }));
  }

  return entries.map((entry, index) => ({
    width,
    runs: [
      { text: `${marker} `, slice: index, kind: "legend-mark" },
      { text: padTo(truncate(entry.label, labelWidth), labelWidth), slice: -1, kind: "legend" },
      {
        text:
          options.percent === false
            ? values[index].padStart(valueWidth)
            : `${values[index].padStart(valueWidth)} ${formatPercent(entry.value, total).padStart(percentWidth)}`,
        slice: -1,
        kind: "legend",
      },
    ],
  }));
}

/**
 * A grid of empty cells. Every shape family draws into one of these and then
 * turns it into runs, which is what keeps text and colour two renderings of the
 * same layout.
 */
export function blankGrid(width, height) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ slice: -1, char: BLANK, kind: "outside", mask: 0 })),
  );
}

/** Write text into a grid, one cell per code point, clipped to the grid. */
export function stampText(grid, x, y, text, template = {}) {
  const row = grid[y];
  if (!row) return 0;
  let cursor = Math.max(0, Math.floor(x));
  let written = 0;
  for (const char of [...String(text)]) {
    if (cursor >= row.length) break;
    row[cursor] = { ...template, char };
    cursor += 1;
    written += 1;
  }
  return written;
}

/** Fill a rectangle of a grid, clipped to the grid. */
export function fillRect(grid, x0, y0, x1, y1, template = {}) {
  const char = template.char ?? BLANK;
  for (let y = Math.max(0, y0); y <= Math.min(grid.length - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(grid[y].length - 1, x1); x++) {
      grid[y][x] = { ...template, char, mask: 0 };
    }
  }
}

/** Draw a box border into a grid, clipped to the grid. */
export function drawBox(grid, x0, y0, x1, y1, template = {}) {
  if (x1 < x0 || y1 < y0) return;
  const glyph = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", ...(template.glyph ?? {}) };
  for (let x = x0 + 1; x < x1; x++) {
    stampText(grid, x, y0, glyph.h, template);
    if (y1 !== y0) stampText(grid, x, y1, glyph.h, template);
  }
  for (let y = y0 + 1; y < y1; y++) {
    stampText(grid, x0, y, glyph.v, template);
    if (x1 !== x0) stampText(grid, x1, y, glyph.v, template);
  }
  stampText(grid, x0, y0, glyph.tl, template);
  stampText(grid, x1, y0, glyph.tr, template);
  if (y1 !== y0) {
    stampText(grid, x0, y1, glyph.bl, template);
    stampText(grid, x1, y1, glyph.br, template);
  }
}

/**
 * Greedy word wrap. A word longer than the line is broken rather than dropped,
 * and a blank line in the text stays a blank line.
 */
export function wrapText(text, width) {
  const limit = Math.max(1, Math.floor(width));
  const lines = [];

  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (cols(rest) > limit) {
        if (line !== "") {
          lines.push(line);
          line = "";
        }
        const chars = [...rest];
        let piece = "";
        for (const char of chars) {
          if (cols(piece + char) > limit) break;
          piece += char;
        }
        if (piece === "") break;
        lines.push(piece);
        rest = chars.slice([...piece].length).join("");
      }
      if (rest === "") continue;
      if (line === "") line = rest;
      else if (cols(line) + 1 + cols(rest) <= limit) line = `${line} ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }

  return lines;
}
