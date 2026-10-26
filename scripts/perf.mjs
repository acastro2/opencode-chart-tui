// Performance gate: a chart is rendered on every scroll, so a family that takes
// tens of milliseconds makes the TUI feel stuck.
//
// The budget is deliberately loose: the point is to catch a quadratic loop or an
// accidental re-render, not to win a microbenchmark.

import { performance } from "node:perf_hooks";
import { SAMPLES } from "./samples.mjs";
import { renderChartRows } from "../src/chart.js";

const WIDTHS = [24, 56, 120];
const RUNS = 15;
const MEDIAN_BUDGET_MS = 30;
const MAX_BUDGET_MS = 150;
const failures = [];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const [type, sample] of Object.entries(SAMPLES)) {
  const times = [];
  for (const width of WIDTHS) {
    const spec = { ...sample, type, width };
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      renderChartRows(spec);
      times.push(performance.now() - start);
    }
  }
  const mid = median(times);
  const max = Math.max(...times);
  const flag = mid > MEDIAN_BUDGET_MS || max > MAX_BUDGET_MS ? "FAIL" : "ok";
  if (flag === "FAIL") failures.push(`${type}: median ${mid.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
  console.log(`${flag.padEnd(4)} ${type.padEnd(12)} median ${mid.toFixed(2)} ms  max ${max.toFixed(2)} ms`);
}

console.log(`perf: ${Object.keys(SAMPLES).length - failures.length}/${Object.keys(SAMPLES).length} families within budget`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`perf: ${failure}`);
  process.exitCode = 1;
}
