import assert from "node:assert/strict";
import { cols, runsText } from "../src/core.js";
import { normalizeTree, renderTreemapRows, squarify } from "../src/treemap.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const textRows = (rows) => rows.map((row) => runsText(row.runs));
const cellsOf = (row) => [...row];

const grouped = {
  type: "treemap",
  width: 58,
  height: 14,
  title: "Portfolio",
  items: [
    { label: "Platform", children: [{ label: "API", value: 40 }, { label: "Web", value: 25 }] },
    { label: "Data", children: [{ label: "ETL", value: 30 }] },
    { label: "Ops", children: [{ label: "SRE", value: 15 }, { label: "Support", value: 10 }] },
  ],
};

check("a treemap fills its box", () => {
  const { items } = normalizeTree(grouped);
  const rects = squarify(items, 58, 14);
  let area = 0;
  for (const rect of rects) {
    assert.ok(rect.x >= 0 && rect.y >= 0, "inside the box");
    assert.ok(rect.x1 < 58 && rect.y1 < 14, "inside the box");
    assert.ok(rect.x1 > rect.x && rect.y1 > rect.y, "a cell needs two corners");
    area += (rect.x1 - rect.x + 1) * (rect.y1 - rect.y + 1);
  }
  assert.equal(area, 58 * 14, `every cell of the box belongs to one item (${area})`);
});

check("rectangles never overlap", () => {
  const { items } = normalizeTree(grouped);
  const rects = squarify(items, 58, 14);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const x = Math.min(a.x1, b.x1) - Math.max(a.x, b.x);
      const y = Math.min(a.y1, b.y1) - Math.max(a.y, b.y);
      assert.ok(x < 0 || y < 0, `${a.item.label} and ${b.item.label} do not overlap`);
    }
  }
});

check("cells stay readable rather than becoming needles", () => {
  const { items } = normalizeTree(grouped);
  for (const rect of squarify(items, 58, 14)) {
    const wide = rect.x1 - rect.x + 1;
    const tall = rect.y1 - rect.y + 1;
    const ratio = Math.max(wide / tall, tall / wide);
    assert.ok(ratio <= 5, `${rect.item.label} is ${wide}x${tall} (ratio ${ratio.toFixed(1)})`);
  }
});

check("a bigger value gets a bigger cell", () => {
  const { items } = normalizeTree(grouped);
  const rects = squarify(items, 58, 14).sort((a, b) => b.item.value - a.item.value);
  const areas = rects.map((rect) => (rect.x1 - rect.x + 1) * (rect.y1 - rect.y + 1));
  for (let i = 1; i < areas.length; i++) {
    assert.ok(areas[i] <= areas[i - 1], `area follows value (${areas.join(", ")})`);
  }
  assert.ok(areas[0] > areas[areas.length - 1], "the biggest value is not the smallest cell");
});

check("groups colour their leaves", () => {
  const rows = renderTreemapRows(grouped);
  const colours = new Set(
    rows.flatMap((row) => row.runs).filter((run) => run.kind === "cell" && run.color).map((run) => run.color),
  );
  // One hue per group, and siblings inside a group are shaded apart, so the map
  // reads as groups of cells instead of one flat field.
  assert.ok(colours.size >= 3, `one hue per group, saw ${colours.size}`);
  assert.ok(colours.size > 3, `siblings differ in shade, saw ${colours.size}`);
  const legend = textRows(rows).join("\n");
  for (const name of ["Platform", "Data", "Ops"]) {
    assert.ok(legend.includes(name), `the legend names ${name}`);
  }
});

check("a group holds its children inside its own box", () => {
  const flat = textRows(renderTreemapRows(grouped));
  const header = flat.findIndex((row) => row.includes("Platform"));
  assert.ok(header > 0, "the group header is drawn");
  assert.ok(/\d/.test(flat[header]), `the header carries the group total (${flat[header].trim()})`);
  const left = flat[header].indexOf("Platform");
  for (const child of ["API", "ETL", "Web"]) {
    const at = flat.findIndex((row) => row.includes(child));
    assert.ok(at > header, `${child} sits below the group header`);
    assert.ok(flat[at].indexOf(child) > left, `${child} sits to the right of the group label`);
  }
});

check("a label and a value are drawn inside a cell that fits, and a small cell gets none", () => {
  const big = textRows(renderTreemapRows(grouped)).join("\n");
  assert.ok(big.includes("API"), "the biggest cell is labelled");
  assert.ok(big.includes("40"), "and carries its value");

  const many = {
    type: "treemap",
    width: 26,
    height: 4,
    items: Array.from({ length: 12 }, (_, index) => ({ label: `item${index}`, value: index + 1 })),
  };
  const small = textRows(renderTreemapRows(many)).join("\n");
  assert.ok(!small.includes("item0"), "a cell with no room stays blank");
});

check("non-positive values are dropped", () => {
  const spec = {
    type: "treemap",
    width: 40,
    height: 8,
    items: [
      { label: "Real", value: 10 },
      { label: "Zero", value: 0 },
      { label: "Negative", value: -4 },
    ],
  };
  const { items } = normalizeTree(spec);
  assert.equal(items.length, 1, "only the positive value is laid out");
  const text = textRows(renderTreemapRows(spec)).join("\n");
  assert.ok(text.includes("Real"));
  assert.ok(!text.includes("Zero") && !text.includes("Negative"));
});

check("every row is the chart width", () => {
  for (const width of [26, 40, 58]) {
    for (const row of renderTreemapRows({ ...grouped, width })) {
      assert.equal(row.width, width, `width ${width}`);
      assert.ok(cols(runsText(row.runs)) <= width, "nothing runs past the width");
    }
  }
});

check("an empty treemap says so", () => {
  const rows = textRows(renderTreemapRows({ type: "treemap", width: 40, height: 6 }));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /no data/);
});

check("the drawing only uses canvas and label cells", () => {
  const allowed = new Set(["╭", "╮", "╰", "╯", "─", "│"]);
  for (const row of textRows(renderTreemapRows(grouped))) {
    for (const cell of cellsOf(row)) {
      // Box glyphs, text and the legend marker; anything else is a drawing bug.
      if (cell === " " || /[0-9a-zA-Z+.,%#@/·-]/.test(cell) || "●".includes(cell)) continue;
      assert.ok(allowed.has(cell), `"${cell}" is not a box or a label`);
    }
  }
});

console.log(`\n${checks}/${checks} checks passed`);
