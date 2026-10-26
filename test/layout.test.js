// The row ledger: families state chrome counts, this module does the arithmetic.
// These checks pin the two rules that kept breaking: notes are paid for before
// the plot, and the block never claims to fit when it does not.

import assert from "node:assert/strict";
import { layoutFor } from "../src/layout.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

check("height is the whole block, notes included", () => {
  const { plotRows, total, truncated } = layoutFor({ height: 10 }, { title: 1, labels: 1, legend: 2, notes: 1 });
  assert.equal(plotRows, 5, "10 − (1+1+2) − 1 note");
  assert.equal(total, 10);
  assert.equal(truncated, false);
});

check("notes are paid for before the plot", () => {
  const withoutNote = layoutFor({ height: 10 }, { title: 1, labels: 1, notes: 0 });
  const withNote = layoutFor({ height: 10 }, { title: 1, labels: 1, notes: 2 });
  assert.equal(withoutNote.plotRows - withNote.plotRows, 2, "each note costs one plot row");
  assert.equal(withNote.noteRows, 2);
});

check("plotHeight wins, and names the plot only", () => {
  const { plotRows, noteRows, total } = layoutFor({ height: 10, plotHeight: 4 }, { title: 1, notes: 2 });
  assert.equal(plotRows, 4, "the explicit plot size is honoured");
  assert.equal(noteRows, 2, "notes are still counted");
  assert.equal(total, 7, "1 title + 4 plot + 2 notes");
});

check("no height falls back", () => {
  const { plotRows, truncated } = layoutFor({}, { fallback: 9 });
  assert.equal(plotRows, 9);
  assert.equal(truncated, false);
});

check("too small to fit is reported, not hidden", () => {
  const { plotRows, total, truncated } = layoutFor({ height: 4 }, { title: 1, labels: 1, notes: 2 });
  assert.equal(plotRows, 3, "the plot keeps its minimum");
  assert.equal(total, 7);
  assert.equal(truncated, true, "the caller must know it did not fit");
});

check("a zero or negative height is ignored, not clamped to nothing", () => {
  for (const height of [0, -5, "x", null]) {
    const { plotRows } = layoutFor({ height }, { fallback: 8 });
    assert.equal(plotRows, 8, `height ${height} falls back`);
  }
});

check("chrome counts are clamped at zero", () => {
  const { chrome } = layoutFor({ height: 10 }, { title: -2, labels: -1, legend: 0 });
  assert.equal(chrome, 0);
});

console.log(`\n${checks}/${checks} checks passed`);
