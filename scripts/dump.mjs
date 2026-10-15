// Plain-text dump of every registered family, for review and documentation.
//
//   node scripts/dump.mjs [width]
//
// Writes review/renders.txt: one section per type, using the same renderer the
// TUI plugin calls, and reports any spec that fails instead of stopping.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chartTypes, renderChart } from "../src/chart.js";

const here = dirname(fileURLToPath(import.meta.url));
const width = Number(process.argv[2]) || 58;

import { SAMPLES } from "./samples.mjs";


const out = [`Chart library plain-text renders (width ${width})`, ""];
let failed = 0;

for (const type of chartTypes()) {
  const sample = SAMPLES[type] ?? {};
  out.push(`${"═".repeat(4)} ${type} ${"═".repeat(Math.max(0, width - type.length - 6))}`);
  try {
    out.push(renderChart({ ...sample, type, width }));
  } catch (error) {
    failed += 1;
    out.push(`  RENDER FAILED: ${error?.message ?? error}`);
  }
  out.push("");
}

if (failed > 0) out.push(`${failed} of ${chartTypes().length} families failed to render.`);

const target = resolve(here, "../review/renders.txt");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${out.join("\n")}\n`);
console.log(`${chartTypes().length - failed}/${chartTypes().length} families rendered`);
console.log(target);
