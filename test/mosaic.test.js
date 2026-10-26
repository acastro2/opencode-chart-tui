// Mosaic: the sub-cell tables behind every block glyph, and the rule that
// coarsens a pattern no mode can draw.
//
// The checks go through the public helpers, so they prove what a chart actually
// gets: the shape of a mode, the glyph for a mask, and that coarsening follows
// weight rather than growing the shape. `resample` is the fallback `resolve`
// would use; no shipped mode needs it, so it is checked directly.

import assert from "node:assert/strict";
import { FILL, MODES, availableModes, glyphFor, isComplete, modeName, modeShape, resample } from "../src/mosaic.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const fullMask = (mode) => 2 ** (mode.columns * mode.rows) - 1;
const bitCount = (mode) => mode.columns * mode.rows;

// Every coarsening the fallback chain can take: adjacent modes, the two-step
// jump, and the identity, which must not disturb a mask.
const pairs = [
  ["octant", "sextant"],
  ["octant", "quadrant"],
  ["sextant", "quadrant"],
  ["quadrant", "quadrant"],
];

check("each mode reports the shape it splits", () => {
  assert.deepEqual(modeShape("quadrant"), { columns: 2, rows: 2 });
  assert.deepEqual(modeShape("sextant"), { columns: 2, rows: 3 });
  assert.deepEqual(modeShape("octant"), { columns: 2, rows: 4 });
  // The default is the universal block, so a caller that names no mode still works.
  assert.deepEqual(modeShape(), { columns: 2, rows: 2 });
});

check("the modes are listed finest first", () => {
  const modes = availableModes();
  assert.deepEqual(modes, ["octant", "sextant", "quadrant"]);
  // Finest first is what lets `resolve` step down one level at a time.
  for (const [index, mode] of modes.entries()) {
    assert.ok(MODES[mode], `${mode} has a table`);
    const below = modes[index + 1];
    if (!below) continue;
    assert.ok(bitCount(MODES[mode]) > bitCount(MODES[below]), `${mode} is finer than ${below}`);
  }
});

check("the blank and the full mask are the same in every mode", () => {
  assert.equal(FILL, "█");
  for (const mode of availableModes()) {
    assert.equal(glyphFor(0, mode), " ", `${mode}: an empty mask is blank`);
    assert.equal(glyphFor(fullMask(MODES[mode]), mode), FILL, `${mode}: a full mask is solid`);
  }
  assert.equal(glyphFor(0), " ", "a caller may leave the mode out");
});

check("every mask belongs to its own mode's table", () => {
  // This is also the check that nothing falls through to the coarser mode
  // today: every pattern a mode can express has its own glyph.
  for (const mode of availableModes()) {
    assert.equal(isComplete(mode), true, `${mode} is complete`);
    for (let mask = 1; mask <= fullMask(MODES[mode]); mask++) {
      assert.ok(MODES[mode].glyphs.has(mask), `${mode}: mask ${mask} has a glyph`);
      assert.equal(glyphFor(mask, mode), MODES[mode].glyphs.get(mask), `${mode}: mask ${mask} is native`);
    }
  }
});

check("a mask outside the table reads as blank", () => {
  // Out-of-range masks are a caller's bug, not a crash: a chart still draws.
  for (const mode of availableModes()) {
    assert.equal(glyphFor(fullMask(MODES[mode]) + 1, mode), " ", `${mode}: one past the table`);
    assert.equal(glyphFor(-1, mode), " ", `${mode}: a negative mask`);
  }
  assert.equal(glyphFor(null, "quadrant"), " ", "a missing mask");
});

check("an unknown mode is refused", () => {
  assert.throws(() => glyphFor(1, "half"), /unknown mosaic mode: half/);
  assert.throws(() => modeShape("half"), /unknown mosaic mode: half/);
  assert.equal(isComplete("half"), false, "a mode with no table is not complete");
  // The sampler falls back instead (modeName); these two stay strict, so a
  // caller that reads the tables directly still hears about a typo. An inherited
  // object key is not a table either.
  assert.throws(() => modeShape("toString"), /unknown mosaic mode/);
  assert.throws(() => glyphFor(1, "constructor"), /unknown mosaic mode/);
});

check("a misspelt mode name falls back to the default", () => {
  // The TUI hit this as "octants": makeSampler threw out of the measure
  // provider, so the whole frame failed instead of drawing the usual grid.
  for (const mode of availableModes()) assert.equal(modeName(mode), mode, `${mode} is its own name`);
  assert.equal(modeName("octants"), "sextant", "a plural typo is the default");
  assert.equal(modeName("half"), "sextant");
  assert.equal(modeName(), "sextant", "no name is the default");
  assert.equal(modeName(null), "sextant");
  assert.equal(modeName(""), "sextant");
  assert.equal(modeName(0), "sextant");
  assert.equal(modeName("toString"), "sextant", "an inherited object key is not a mode");
  assert.equal(modeName("half", "quadrant"), "quadrant", "a caller may name its own fallback");
});

check("every glyph is one code point, even in the octant block", () => {
  for (const mode of availableModes()) {
    for (let mask = 0; mask <= fullMask(MODES[mode]); mask++) {
      const glyph = glyphFor(mask, mode);
      const points = [...glyph];
      assert.equal(points.length, 1, `${mode}: mask ${mask} gave ${points.length} code points`);
      assert.equal(glyph, points[0], `${mode}: mask ${mask} keeps its own code point`);
    }
  }
  // Octants are astral: two UTF-16 units, one code point. Slicing by length
  // would split them, which is the trap this pins.
  assert.equal(glyphFor(1, "octant").length, 2, "an octant glyph is astral in UTF-16");
  assert.equal([...glyphFor(1, "octant")].length, 1, "and a single code point");
  assert.equal(glyphFor(1, "quadrant").length, 1, "a quadrant glyph is BMP");
});

check("the shared block glyphs keep the same mask in every mode", () => {
  // Row-major numbering, two columns wide: the same pattern means the same
  // region whatever the resolution, which is what the resampler relies on.
  const same = (masks, expected) => {
    for (const [mode, mask] of Object.entries(masks)) {
      assert.equal(glyphFor(mask, mode), expected, `${mode}: mask ${mask}`);
    }
  };
  same({ quadrant: 5, sextant: 21, octant: 85 }, "▌");
  same({ quadrant: 10, sextant: 42, octant: 170 }, "▐");
  same({ quadrant: 3, octant: 15 }, "▀");
  same({ quadrant: 12, octant: 240 }, "▄");
  same({ quadrant: 6, octant: 90 }, "▞");
  same({ quadrant: 15, sextant: 63, octant: 255 }, FILL);
});

check("an empty mask resamples to empty and a full one to full", () => {
  for (const [fromName, toName] of pairs) {
    const from = MODES[fromName];
    const to = MODES[toName];
    assert.equal(resample(0, from, to), 0, `${fromName} -> ${toName}: empty`);
    assert.equal(resample(fullMask(from), from, to), fullMask(to), `${fromName} -> ${toName}: full`);
  }
});

check("resampling never leaves the coarser table", () => {
  for (const [fromName, toName] of pairs) {
    const from = MODES[fromName];
    const to = MODES[toName];
    for (let mask = 0; mask <= fullMask(from); mask++) {
      const out = resample(mask, from, to);
      assert.ok(Number.isInteger(out) && out >= 0 && out <= fullMask(to), `${fromName} -> ${toName}: ${mask} gave ${out}`);
    }
  }
});

check("resampling only adds cells", () => {
  // Filling one more sub-cell can never clear a coarse cell: the shape may grow
  // but never lose a part a reader already sees.
  for (const [fromName, toName] of pairs) {
    const from = MODES[fromName];
    const to = MODES[toName];
    for (let mask = 0; mask <= fullMask(from); mask++) {
      const coarser = resample(mask, from, to);
      for (let bit = 0; bit < bitCount(from); bit++) {
        const more = resample(mask | (1 << bit), from, to);
        assert.equal(more & coarser, coarser, `${fromName} -> ${toName}: mask ${mask} with bit ${bit} lost a cell`);
      }
    }
  }
});

check("every resampled pattern has a glyph of the coarser mode", () => {
  // The chain may step down twice, but the answer must be a real glyph, never
  // the solid fill that `resolve` returns only when every mode fails.
  for (const [fromName, toName] of pairs) {
    const from = MODES[fromName];
    const to = MODES[toName];
    for (let mask = 0; mask <= fullMask(from); mask++) {
      const out = resample(mask, from, to);
      if (out === 0) continue;
      assert.ok(to.glyphs.has(out), `${fromName} -> ${toName}: ${mask} gave ${out}, which has no glyph`);
    }
  }
});

check("a coarse cell fills when at least half of it is covered", () => {
  const resampleTo = (mask, from, to) => resample(mask, MODES[from], MODES[to]);
  // Octant to sextant: the top of the cell covers one third plus one sub-cell of
  // the first third, so it stays in the first sextant row...
  assert.equal(resampleTo(1, "octant", "sextant"), 1, "octant top-left stays in the top sextant row");
  assert.equal(glyphFor(resampleTo(1, "octant", "sextant"), "sextant"), "🬀");
  // ...while a fill in octant row 1 covers two thirds of sextant row 1.
  assert.equal(resampleTo(4, "octant", "sextant"), 4, "octant row 1 lands in sextant row 1");
  assert.equal(glyphFor(resampleTo(4, "octant", "sextant"), "sextant"), "🬃");
  assert.equal(resampleTo(8, "octant", "sextant"), 8, "and its right sub-cell too");
  // Octant to quadrant halves exactly: one of two rows is half, and half counts.
  assert.equal(resampleTo(64, "octant", "quadrant"), 4, "one of two octant rows fills a quadrant row");
  assert.equal(glyphFor(resampleTo(64, "octant", "quadrant"), "quadrant"), "▖");
  // Sextant to quadrant: a third of a row is not half, so the top stays alone.
  assert.equal(resampleTo(1, "sextant", "quadrant"), 1, "sextant top only");
  assert.equal(resampleTo(7, "sextant", "quadrant"), 3, "a full sextant top row fills the whole quadrant top");
  // A column that runs the height keeps every coarse row it covers.
  assert.equal(resampleTo(85, "octant", "sextant"), 21, "the left column stays the left half");
  assert.equal(glyphFor(resampleTo(85, "octant", "sextant"), "sextant"), "▌");
});

check("a fill below half of a coarse cell is dropped, not grown", () => {
  // One sixth of a quadrant cell is not worth a mark; growing it would make the
  // coarse drawing heavier than the fine one.
  const out = resample(4, MODES.sextant, MODES.quadrant);
  assert.equal(out, 0, "the middle sextant row alone leaves the quadrant blank");
  assert.equal(glyphFor(out, "quadrant"), " ", "so the cell stays blank");
});

check("resampling a mode into itself returns the mask unchanged", () => {
  for (const mode of availableModes()) {
    for (let mask = 0; mask <= fullMask(MODES[mode]); mask++) {
      assert.equal(resample(mask, MODES[mode], MODES[mode]), mask, `${mode}: mask ${mask}`);
    }
  }
});

check("a mode missing a pattern is reported incomplete", () => {
  // No shipped mode is incomplete, so this uses a probe table to prove the
  // contract: complete means every non-empty mask has a glyph of its own.
  const probe = { columns: 2, rows: 1, glyphs: new Map([[1, "▘"], [2, "▝"], [3, "█"]]) };
  MODES.probe = probe;
  try {
    assert.equal(isComplete("probe"), true, "the blank mask is not needed");
    probe.glyphs.delete(2);
    assert.equal(isComplete("probe"), false, "a missing mask needs the fallback");
    probe.glyphs.set(2, "▝");
    probe.glyphs.set(3, " ");
    assert.equal(isComplete("probe"), false, "a blank is not a pattern");
  } finally {
    delete MODES.probe;
  }
});

console.log(`\n${checks}/${checks} checks passed`);
