// Eyeball helper: prints sample charts with a width ruler, so alignment is visible.
//   node scripts/demo.mjs

import { renderPieChart } from "../src/pie.js";

const show = (label, spec, width = 40) => {
  console.log(`\n----- ${label} -----`);
  console.log(`|${"-".repeat(width)}|`);
  for (const line of renderPieChart({ width, ...spec }).split("\n")) console.log(`|${line}|`);
  console.log(`|${"-".repeat(width)}|`);
};

show("pipeline, 3 slices", {
  title: "Pipeline by stage",
  slices: [["Closed won", 89], ["In flight", 34], ["At risk", 12]],
});

show("arr by region, 4 slices", {
  title: "ARR by region",
  slices: [["North", 1400], ["South", 900], ["East", 500], ["West", 220]],
});

show("skewed, 3 slices", {
  title: "Effort split",
  slices: [["Build", 80], ["Test", 15], ["Ship", 5]],
});

show("donut, 5 slices", {
  title: "Spend by category",
  donut: true,
  slices: [["Cloud", 480], ["People", 320], ["Tools", 140], ["Travel", 60], ["Other", 25]],
});
