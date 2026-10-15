// Compare pie variants side by side, so the look can be judged, not guessed.
//   node scripts/variants.mjs

import { renderPieChart } from "../src/pie.js";

const slices = [["Closed won", 89], ["In flight", 34], ["At risk", 12]];
const four = [["North", 1400], ["South", 900], ["East", 500], ["West", 220]];
const width = 56;

const show = (label, spec) => {
  console.log(`\n===== ${label} =====`);
  const lines = renderPieChart({ width, legend: false, ...spec }).split("\n");
  console.log(`+${"-".repeat(width)}+`);
  for (const line of lines) console.log(`|${line}|`);
  console.log(`+${"-".repeat(width)}+`);
};

show("A: shade per slice, spokes, labels", { title: "Pipeline by stage", slices });
show("B: solid fill, spokes, labels", {
  title: "Pipeline by stage",
  slices,
  glyphs: slices.map(() => "█"),
});
show("C: patterned fills", {
  title: "Pipeline by stage",
  slices,
  glyphs: ["█", "▚", "░"],
});
show("D: four slices, shade per slice", { title: "ARR by region", slices: four });
show("E: donut, solid fill", {
  title: "Spend by category",
  donut: true,
  slices: [["Cloud", 480], ["People", 320], ["Tools", 140], ["Travel", 60], ["Other", 25]],
  glyphs: ["█", "▓", "▒", "░", "▚"],
});
