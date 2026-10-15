import assert from "node:assert/strict";
import { renderPie, renderPieChart, renderPieRows, layoutPie, normalizeSlices, sliceGlyphs, renderLegend } from "../src/pie.js";
import { availableModes, glyphFor, isComplete, modeShape } from "../src/mosaic.js";

const WIDTH = 44;
const HEIGHT = 22;

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

// Sextant and octant glyphs live above the BMP, so a string index or `.length`
// counts two units for one cell. Every measurement goes through these.
const cols = (text) => [...text].length;
const cellsOf = (row) => [...row];
const countGlyph = (rows, glyph) => rows.join("").split(glyph).length - 1;

/** Every glyph a mode can produce, so a frame can be checked against it. */
const glyphsOf = (mode) => {
  const { columns, rows } = modeShape(mode);
  const set = new Set();
  for (let mask = 1; mask < 2 ** (columns * rows); mask++) set.add(glyphFor(mask, mode));
  return set;
};

check("every row is exactly the requested width", () => {
  const rows = renderPie(normalizeSlices([["a", 5], ["b", 3], ["c", 2]]), { width: WIDTH, height: HEIGHT });
  assert.equal(rows.length, HEIGHT);
  for (const row of rows) assert.equal(cols(row), WIDTH, `row of ${cols(row)} cells`);
});

check("the disc is round, not an ellipse", () => {
  // A circle in a cell grid is half as many rows as columns. Measured on the
  // drawn cells, not on the box, and with the rounding of a cell of slack.
  const rows = renderPie(normalizeSlices([["only", 1]]), { width: WIDTH, height: HEIGHT });
  const filled = rows.map((row, y) => (row.trim() ? y : -1)).filter((y) => y >= 0);
  const first = filled[0];
  const last = filled[filled.length - 1];
  const drawnHeight = last - first + 1;
  const widest = Math.max(...rows.map((row) => cols(row.trimEnd()) - (cols(row) - cols(row.trimStart()))));
  assert.ok(Math.abs(drawnHeight * 2 - widest) <= 4, `drawnHeight ${drawnHeight} widest ${widest}`);
});

check("a single slice fills a symmetric disc", () => {
  // Sub-cell sampling means the mirrored cell holds the mirrored glyph, not the
  // same glyph, so compare each cell against the mirror of its mask.
  const mode = "sextant";
  const shape = modeShape(mode);
  const maskOf = new Map();
  for (let mask = 1; mask < 2 ** (shape.columns * shape.rows); mask++) maskOf.set(glyphFor(mask, mode), mask);

  const rows = renderPie(normalizeSlices([["all", 100]]), { width: WIDTH, height: HEIGHT, mosaic: mode });
  for (const row of rows) {
    const cells = cellsOf(row);
    for (let x = 0; x < WIDTH; x++) {
      let mirrored = 0;
      const mask = maskOf.get(cells[x]) ?? 0;
      for (let r = 0; r < shape.rows; r++) {
        for (let c = 0; c < shape.columns; c++) {
          if ((mask >> (r * shape.columns + c)) & 1) mirrored |= 1 << (r * shape.columns + (shape.columns - 1 - c));
        }
      }
      const expected = mirrored === 0 ? " " : glyphFor(mirrored, mode);
      assert.equal(cells[WIDTH - 1 - x], expected, `cell ${x} of "${row.trim()}"`);
    }
  }
  assert.ok(countGlyph(rows, "█") > 200, "disc should be densely filled");
});

check("slice areas follow slice values", () => {
  const rows = renderPie(normalizeSlices([["big", 80], ["small", 20]]), { width: WIDTH, height: HEIGHT, textured: true });
  const glyphs = sliceGlyphs(2);
  const big = countGlyph(rows, glyphs[0]);
  const small = countGlyph(rows, glyphs[1]);
  const ratio = big / small;
  assert.ok(ratio > 3 && ratio < 5.5, `ratio ${ratio.toFixed(2)} should be near 4 for 80:20`);
});

check("equal slices get equal areas", () => {
  const rows = renderPie(normalizeSlices([["a", 1], ["b", 1]]), { width: WIDTH, height: HEIGHT, textured: true });
  const glyphs = sliceGlyphs(2);
  const first = countGlyph(rows, glyphs[0]);
  const second = countGlyph(rows, glyphs[1]);
  assert.ok(Math.abs(first - second) / first < 0.1, `${first} vs ${second}`);
});

check("a quarter slice from twelve o'clock fills the top-right quadrant only", () => {
  // Grid is even in both axes, so the centre line falls between cells and each
  // drawn cell is unambiguously left/right and above/below. Interior cells only,
  // because a rim cell can hold sub-cells of two slices.
  const rows = renderPie(normalizeSlices([["quarter", 25], ["rest", 75]]), { width: WIDTH, height: HEIGHT, textured: true });
  const glyphs = sliceGlyphs(2);
  const centreX = (WIDTH - 1) / 2;
  const centreY = (HEIGHT - 1) / 2;
  const cells = [];

  rows.forEach((row, y) => {
    cellsOf(row).forEach((cell, x) => {
      if (cell === glyphs[0]) cells.push({ x, y });
    });
  });

  assert.ok(cells.length > 20, "the quarter slice should be drawn");
  for (const { x, y } of cells) {
    assert.ok(x > centreX, `first slice cell at x=${x} sits left of centre`);
    assert.ok(y < centreY, `first slice cell at y=${y} sits below centre`);
  }

  // The rest wraps past twelve o'clock, so it appears on both sides.
  const rest = rows.flatMap((row, y) =>
    cellsOf(row)
      .map((cell, x) => ({ cell, x, y }))
      .filter(({ cell }) => cell === glyphs[1]),
  );
  assert.ok(rest.some(({ x }) => x < centreX) && rest.some(({ x }) => x > centreX), "the rest should wrap around");
});

check("a donut leaves the middle empty", () => {
  const rows = renderPie(normalizeSlices([["a", 1], ["b", 1]]), { width: WIDTH, height: HEIGHT, donut: true });
  const centreX = (WIDTH - 1) / 2;
  const centreY = (HEIGHT - 1) / 2;
  for (const y of [Math.floor(centreY), Math.ceil(centreY)]) {
    for (const x of [Math.floor(centreX), Math.ceil(centreX)]) {
      assert.equal(cellsOf(rows[y])[x], " ", `the hole should cover ${x},${y}`);
    }
  }
  assert.ok(countGlyph(rows, "█") > 20, "the ring should still be drawn");
});

check("slices with no value are dropped, order is kept", () => {
  assert.deepEqual(normalizeSlices([["a", 0], ["b", 3], ["c", -2], { label: "d", value: 4 }]), [
    { label: "b", value: 3 },
    { label: "d", value: 4 },
  ]);
});

check("glyph per slice never repeats before it must", () => {
  const four = sliceGlyphs(4);
  assert.equal(new Set(four).size, 4);
  assert.equal(sliceGlyphs(0).length, 0);
});

check("legend rows align and never exceed the width", () => {
  const slices = normalizeSlices([["Closed won", 62], ["In flight", 28], ["At risk", 10]]);
  const rows = renderLegend(slices, sliceGlyphs(slices.length), { width: WIDTH });
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(cols(row), WIDTH);
  assert.match(rows[0], /62\.0%/);
  assert.match(rows[2], /10\.0%/);
});

check("the whole chart keeps one width, including the title", () => {
  const chart = renderPieChart({
    title: "Pipeline by stage",
    slices: [["Closed won", 62], ["In flight", 28], ["At risk", 10]],
    width: WIDTH,
  });
  const lines = chart.split("\n");
  for (const line of lines) assert.ok(cols(line) <= WIDTH, `${cols(line)} > ${WIDTH}`);
  assert.equal(lines[0].trim(), "Pipeline by stage");
  const discHeight = Math.round((WIDTH - 2) / 2) + 2;
  assert.equal(lines.length, 1 + discHeight + 3);
});

check("every mosaic mode has a full glyph table", () => {
  const modes = availableModes();
  assert.ok(modes.includes("quadrant") && modes.includes("sextant") && modes.includes("octant"));
  for (const mode of modes) {
    const { columns, rows } = modeShape(mode);
    assert.ok(isComplete(mode), `${mode} should be complete`);
    assert.equal(glyphsOf(mode).size, 2 ** (columns * rows) - 1, `${mode} glyph count`);
  }
});

check("every mosaic mode renders the same box", () => {
  const slices = normalizeSlices([["a", 60], ["b", 40]]);
  for (const mode of availableModes()) {
    const rows = renderPie(slices, { width: WIDTH, height: HEIGHT, mosaic: mode });
    assert.equal(rows.length, HEIGHT, `${mode} row count`);
    for (const row of rows) assert.equal(cols(row), WIDTH, `${mode} row width`);
  }
});

check("the rim is drawn at sub-cell resolution", () => {
  for (const mode of availableModes()) {
    const rows = renderPie(normalizeSlices([["all", 100]]), { width: WIDTH, height: HEIGHT, mosaic: mode });
    const used = new Set([...rows.join("")].filter((char) => char !== " "));
    // A whole-cell disc would use one glyph only. Partial cells add the rest,
    // and every one of them must be a real pattern of its own mode.
    assert.ok(used.size > 5, `${mode}: expected a varied rim, saw ${[...used].join("")}`);

    const valid = glyphsOf(mode);
    valid.add("█");
    for (const char of used) {
      assert.ok(valid.has(char), `${mode}: ${char} U+${char.codePointAt(0).toString(16)} is not a ${mode} pattern`);
    }
  }
});

check("the default rim stays inside the safe mosaic block", () => {
  // Octants are Unicode 16: a font without them shows boxes, and a width check
  // cannot see that. Sextants (Unicode 13) are the default; octants are opt-in.
  const rows = renderPie(normalizeSlices([["all", 100]]), { width: WIDTH, height: HEIGHT });
  const points = [...new Set(rows.join(""))].map((char) => char.codePointAt(0));
  assert.ok(
    points.some((point) => point >= 0x1fb00 && point <= 0x1fb3b),
    "the default rim uses sextants",
  );
  assert.ok(
    !points.some((point) => point >= 0x1cd00 && point <= 0x1cde5),
    "the default rim avoids the Unicode 16 octants",
  );
});

check("quadrant mode stays inside the basic multilingual plane", () => {
  // The universal fallback: old fonts have quadrants, not sextants.
  const rows = renderPie(normalizeSlices([["a", 70], ["b", 30]]), { width: WIDTH, height: HEIGHT, mosaic: "quadrant" });
  for (const char of new Set(rows.join(""))) {
    if (char === " ") continue;
    assert.ok(char.codePointAt(0) < 0x10000, `${char} is outside the BMP`);
  }
});

check("octant mode reaches the octant block", () => {
  const rows = renderPie(normalizeSlices([["a", 70], ["b", 30]]), { width: WIDTH, height: HEIGHT, mosaic: "octant" });
  const octants = [...new Set(rows.join(""))].filter((char) => {
    const code = char.codePointAt(0);
    return code >= 0x1cd00 && code <= 0x1cde5;
  });
  assert.ok(octants.length > 0, "octant mode should use octant glyphs on the rim");
});

check("the wedge boundary is drawn at sub-cell resolution", () => {
  const rows = renderPieRows(normalizeSlices([["a", 60], ["b", 40]]), { width: WIDTH, height: HEIGHT, mosaic: "octant" });
  const edge = [];
  for (const row of rows) for (const run of row.runs) if (run.kind === "edge") edge.push(...run.text);
  assert.ok(edge.length > 0, "expected edge cells along the boundary");

  const valid = glyphsOf("octant");
  valid.add("█");
  const solid = glyphFor(2 ** 8 - 1, "octant");
  for (const char of edge) {
    assert.ok(valid.has(char), `${char} is not an octant pattern`);
    assert.ok(char !== solid, "an edge cell must be a partial pattern, not a full block");
  }
});

check("no cell is spent on a blank gap", () => {
  // The old boundary walk blanked whole cells, which is what made the internal
  // lines a staircase while the rim was smooth.
  const { cells } = layoutPie(normalizeSlices([["a", 60], ["b", 40]]), { width: WIDTH, height: HEIGHT, mosaic: "octant" });
  assert.equal(cells.flat().filter((cell) => cell.kind === "gap").length, 0);
  assert.equal(cells.flat().filter((cell) => cell.kind === "edge").length > 0, true);
});

check("a boundary cell carries both wedges at once", () => {
  // The line is not painted: the cell is two wedges in one glyph, so the
  // boundary lands on the sub-cell curve exactly like the rim.
  const slices = normalizeSlices([["a", 60], ["b", 40]]);
  const { cells } = layoutPie(slices, { width: WIDTH, height: HEIGHT, mosaic: "octant" });
  const flat = cells.flat();
  const edge = flat.filter((cell) => cell.kind === "edge");
  assert.ok(edge.length > 0, "expected edge cells along the boundary");

  for (const cell of edge) {
    assert.ok(Number.isInteger(cell.other) && cell.other >= 0, "an edge cell names the wedge behind it");
    assert.notEqual(cell.other, cell.slice, "the two wedges of an edge cell must differ");
    assert.equal(cell.mask, 2 ** 8 - 1, "a two-colour cell must be wholly inside the disc");
  }

  // Where a boundary meets the rim, a background colour would spill outside the
  // disc, so those cells draw the line on their own sub-cells instead.
  for (const cell of flat.filter((cell) => cell.kind === "line")) {
    assert.notEqual(cell.mask, 2 ** 8 - 1, "a drawn line is only needed at the rim");
  }

  for (const row of renderPieRows(slices, { width: WIDTH, height: HEIGHT, mosaic: "octant" })) {
    for (const run of row.runs) {
      if (run.kind !== "edge") continue;
      assert.ok(run.other >= 0, "a styled edge run carries the colour of the wedge behind it");
    }
  }
});

check("a boundary cell keeps at least half of itself for the winning wedge", () => {
  // No cell is ever spent entirely on the line, which is what a dark staircase
  // would do. The winner owns most of the cell and the other wedge takes the
  // rest, so the boundary is at most half a cell thick.
  const { cells } = layoutPie(normalizeSlices([["a", 60], ["b", 40]]), { width: WIDTH, height: HEIGHT, mosaic: "octant" });
  const inverse = new Map();
  for (let mask = 1; mask <= 2 ** 8 - 1; mask++) inverse.set(glyphFor(mask, "octant"), mask);
  const popcount = (value) => value.toString(2).split("").filter((digit) => digit === "1").length;

  let counted = 0;
  for (const cell of cells.flat()) {
    if (cell.kind !== "edge") continue;
    const mine = inverse.get(cell.char);
    assert.ok(mine !== undefined, `${cell.char} U+${cell.char.codePointAt(0).toString(16)} is not an octant pattern`);
    assert.ok(popcount(mine) >= 4, `the winning wedge covers ${popcount(mine)} of 8 sub-cells`);
    assert.ok(popcount(mine) < 8, "an edge cell always leaves sub-cells for the other wedge");
    counted += 1;
  }
  assert.ok(counted > 0, "expected edge cells to count");
});

check("nothing is drawn outside the disc", () => {
  // A glyph may only cover sub-cells that fall inside, and a two-colour cell is
  // only allowed where the whole cell is inside, so no cell can spill past the
  // rim - which is exactly the blob a background colour would make.
  const slices = normalizeSlices([["a", 55], ["b", 30], ["c", 15]]);
  for (const mode of availableModes()) {
    const { columns, rows } = modeShape(mode);
    const perCell = columns * rows;
    const inverse = new Map();
    for (let mask = 1; mask < 2 ** perCell; mask++) inverse.set(glyphFor(mask, mode), mask);

    const { cells } = layoutPie(slices, { width: WIDTH, height: HEIGHT, mosaic: mode });
    for (const cell of cells.flat()) {
      if (cell.kind === "outside") {
        assert.equal(cell.mask, 0, `${mode}: an outside cell has no sub-cells inside`);
        continue;
      }
      if (cell.kind === "label" || cell.kind === "spoke") continue;
      const mask = inverse.get(cell.char);
      assert.ok(mask !== undefined, `${mode}: ${cell.char} is not a ${mode} pattern`);
      assert.equal(mask & ~cell.mask, 0, `${mode}: a glyph covers sub-cells outside the disc`);
      if (cell.kind === "edge") {
        assert.equal(cell.mask, 2 ** perCell - 1, `${mode}: a two-colour cell must be wholly inside the disc`);
      }
    }
  }
});

check("the styled runs render the same text as the plain rows", () => {
  // One layout, two renderings: colour must never change the geometry.
  const slices = normalizeSlices([["a", 50], ["b", 50]]);
  const styled = renderPieRows(slices, { width: WIDTH, height: HEIGHT });
  const plain = renderPie(slices, { width: WIDTH, height: HEIGHT });
  assert.equal(styled.length, plain.length);
  styled.forEach((row, index) => {
    const text = row.runs.map((run) => run.text).join("");
    assert.equal(text.trimEnd(), plain[index].trimEnd(), `row ${index}`);
  });
});

check("no cell paints a dark boundary colour inside the disc", () => {
  // The boundary is two-colour at the sub-cell level everywhere; the rim cells
  // absorb the neighbour instead of drawing a "line" cell, so no black tick can
  // land on the shape at a junction.
  const slices = normalizeSlices([["a", 60], ["b", 25], ["c", 15]]);
  for (const mode of availableModes()) {
    const { cells } = layoutPie(slices, { width: WIDTH, height: HEIGHT, mosaic: mode });
    for (const row of cells) {
      for (const cell of row) {
        assert.notEqual(cell.kind, "line", `${mode}: a dark boundary cell at the rim`);
      }
    }
  }
});

check("a taller cell flattens the disc", () => {
  // The whole shape hangs on the cell's height-over-width ratio: at 2 the disc
  // is two cells wide per cell tall; at 2.4 it is 2.4.
  const slices = normalizeSlices([["a", 60], ["b", 40]]);
  for (const aspect of [2, 2.4]) {
    const { cells } = layoutPie(slices, { width: 60, mosaic: "octant", cellAspect: aspect });
    let top = Infinity;
    let bottom = -1;
    let left = Infinity;
    let right = -1;
    cells.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell.mask === 0) return;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }),
    );
    const drawnW = right - left + 1;
    const drawnH = bottom - top + 1;
    assert.ok(Math.abs(drawnH * aspect - drawnW) <= 2, `aspect ${aspect}: ${drawnW} wide, ${drawnH} tall`);
  }
});

console.log(`\n${checks}/${checks} checks passed`);
