// Performance gate: a chart is rendered on every scroll, so a family that takes
// tens of milliseconds makes the TUI feel stuck.
//
// The budget is deliberately loose: the point is to catch a quadratic loop or an
// accidental re-render, not to win a microbenchmark.
//
// The corpus edge specs are included where the cost profile differs from the
// gallery sample: grouped/multi-series layouts (more runs per row) and a
// packed 30-category bar (the hide-and-note second pass). Not every edge spec is
// timed, so the gate stays fast; audit and fidelity render them all.

import { performance } from "node:perf_hooks";
import { SAMPLES, edgeSpecs } from "./corpus.mjs";
import { renderChartRows } from "../src/chart.js";

const WIDTHS = [24, 56, 120];
const RUNS = 15;
const MEDIAN_BUDGET_MS = 30;
const MAX_BUDGET_MS = 150;
// At least one multi-series spec and one narrow, category-heavy spec.
const EXTRA = ["bar-grouped", "line-multi", "bar-grouped-narrow", "bar-many"];
const failures = [];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const specs = [
  ...Object.entries(SAMPLES).map(([name, spec]) => ({ name, spec })),
  ...edgeSpecs().filter(({ name }) => EXTRA.includes(name)),
];

for (const { name, spec } of specs) {
  const times = [];
  for (const width of WIDTHS) {
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      renderChartRows({ ...spec, width });
      times.push(performance.now() - start);
    }
  }
  const mid = median(times);
  const max = Math.max(...times);
  const flag = mid > MEDIAN_BUDGET_MS || max > MAX_BUDGET_MS ? "FAIL" : "ok";
  if (flag === "FAIL") failures.push(`${name}: median ${mid.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
  console.log(`${flag.padEnd(4)} ${name.padEnd(12)} median ${mid.toFixed(2)} ms  max ${max.toFixed(2)} ms`);
}

console.log(`perf: ${specs.length - failures.length}/${specs.length} specs within budget`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`perf: ${failure}`);
  process.exitCode = 1;
}
