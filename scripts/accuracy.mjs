// How closely each mosaic mode follows the ideal circle.
//
// The drawn area is counted in sub-cells, so it is directly comparable to the
// analytic area of the ellipse the renderer aims for. V1 (one glyph per cell)
// is included as the baseline: it is the "all sub-cells inside" case.

import { layoutPie, normalizeSlices } from "../src/pie.js";
import { glyphFor, modeShape } from "../src/mosaic.js";

const WIDTH = 44;
const HEIGHT = 22;
const margin = 1;
// The renderer caps the horizontal radius at `height - 2`, so on a 22-row
// frame the disc is 40 x 20 cells, not 42 x 21. Using the width-only radius
// here made the script report a 9.3% error where the real error is under 1%.
const radiusX = Math.max(2, Math.min((WIDTH - 2 * margin) / 2, HEIGHT - 2));
const radiusY = radiusX / 2;
const ideal = Math.PI * radiusX * radiusY;

const glyphMasks = (mode) => {
  const { columns, rows } = modeShape(mode);
  const map = new Map();
  for (let mask = 1; mask < 2 ** (columns * rows); mask++) map.set(glyphFor(mask, mode), mask);
  return map;
};

const measure = (cells, { mode }) => {
  const { columns, rows: subRows } = modeShape(mode);
  const perCell = columns * subRows;
  const popcount = (value) => {
    let bits = 0;
    for (let bit = 0; bit < perCell; bit++) if ((value >> bit) & 1) bits += 1;
    return bits;
  };
  let filled = 0;
  let partial = 0;
  let whole = 0;
  const rim = new Set();

  for (const cell of cells.flat()) {
    const bits = popcount(cell.mask);
    if (bits === 0) continue;
    filled += bits;
    if (bits === perCell) whole += 1;
    else {
      partial += 1;
      rim.add(cell.char);
    }
  }

  return {
    areaCells: filled / perCell,
    error: (filled / perCell - ideal) / ideal,
    partial,
    whole,
    rimGlyphs: rim.size,
  };
};

const slices = normalizeSlices([["all", 100]]);
console.log(`ideal area ${ideal.toFixed(1)} cells, ${WIDTH}x${HEIGHT} grid\n`);
console.log("mode       drawn area   error     partial cells   rim glyphs");
for (const mode of ["quadrant", "sextant", "octant"]) {
  const { cells } = layoutPie(slices, { width: WIDTH, height: HEIGHT, mosaic: mode });
  const result = measure(cells, { mode });
  console.log(
    `${mode.padEnd(10)} ${result.areaCells.toFixed(1).padStart(10)}   ${(result.error * 100).toFixed(1).padStart(6)}%   ${String(result.partial).padStart(13)}   ${String(result.rimGlyphs).padStart(10)}`,
  );
}

// The internal boundary costs no cell: an edge cell keeps at least half of
// itself for the winning wedge, so the most a line can take in one cell is the
// sub-cells of the wedge behind it.
const pairs = normalizeSlices([
  ["a", 60],
  ["b", 40],
]);
console.log("\nwedge boundary (60/40)");
console.log("mode       edge cells   heaviest line share   edge cells in one row");
for (const mode of ["quadrant", "sextant", "octant"]) {
  const { cells } = layoutPie(pairs, { width: WIDTH, height: HEIGHT, mosaic: mode });
  const { columns, rows: subRows } = modeShape(mode);
  const perCell = columns * subRows;
  const inverse = glyphMasks(mode);
  const popcount = (value) => {
    let bits = 0;
    for (let bit = 0; bit < perCell; bit++) if ((value >> bit) & 1) bits += 1;
    return bits;
  };

  let edge = 0;
  let heaviest = 0;
  let widestRow = 0;
  for (const row of cells) {
    let inRow = 0;
    for (const cell of row) {
      if (cell.kind !== "edge") continue;
      edge += 1;
      inRow += 1;
      // The line inside a cell is the share the winning wedge does not own.
      const mine = inverse.get(cell.char) ?? 0;
      heaviest = Math.max(heaviest, popcount(cell.mask) - popcount(mine));
    }
    widestRow = Math.max(widestRow, inRow);
  }
  console.log(
    `${mode.padEnd(10)} ${String(edge).padStart(10)}   ${`${heaviest} of ${perCell} sub-cells`.padStart(22)}   ${String(widestRow).padStart(21)}`,
  );
}

// Show the top of the disc as a sub-cell picture: each character cell becomes
// its 2x3 sub-cells, so the arc is visible directly.
const show = (mode, rows = 5) => {
  const { columns, rows: subRows } = modeShape(mode);
  const masks = glyphMasks(mode);
  const { cells } = layoutPie(slices, { width: WIDTH, height: HEIGHT, mosaic: mode });
  console.log(`\n${mode}: top ${rows} rows, expanded to ${columns}x${subRows} sub-cells\n`);
  for (let y = 0; y < Math.min(rows, cells.length); y++) {
    const bands = Array.from({ length: subRows }, () => []);
    for (const cell of cells[y]) {
      const mask = cell.char === " " ? 0 : (masks.get(cell.char) ?? 2 ** (columns * subRows) - 1);
      for (let r = 0; r < subRows; r++) {
        let band = "";
        for (let c = 0; c < columns; c++) band += (mask >> (r * columns + c)) & 1 ? "##" : "..";
        bands[r].push(band);
      }
    }
    for (const band of bands) console.log(band.join("").replace(/\.\.$/, "").replace(/(\.\.)+$/, ""));
    console.log();
  }
};

show("quadrant", 4);
show("sextant", 4);
show("octant", 4);
