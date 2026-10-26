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
    assert.ok(flat[at].indexOf(child) >= left, `${child} stays inside the group box`);
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

check("a two-row tile shows its value under its label", () => {
  // The tile that used to lose its value: a child with a label row and one more
  // row under it. The map is the sample from the gallery, because that is the
  // shape a reader sees.
  const spend = {
    type: "treemap",
    width: 48,
    height: 12,
    items: [
      { label: "Platform", children: [{ label: "API", value: 19 }, { label: "ETL", value: 15 }, { label: "Web", value: 12 }] },
      { label: "Ops", children: [{ label: "SRE", value: 12 }, { label: "Support", value: 6 }] },
    ],
  };
  const rows = textRows(renderTreemapRows(spend));
  const at = rows.findIndex((row) => row.includes("Web"));
  assert.ok(at > 0, "the small child is labelled");
  const column = rows[at].indexOf("Web");
  assert.ok(/^12$/.test(rows[at + 1].slice(column, column + 2)), `the value sits under the label (${rows[at + 1].trim()})`);
  // And a boxed child with three text rows keeps both, one row above its border.
  const boxed = textRows(renderTreemapRows(grouped));
  const web = boxed.findIndex((row) => row.includes("Web"));
  assert.ok(boxed[web + 1].includes("25"), "the boxed tile shows its value");
  for (const row of boxed) {
    assert.ok(!/[╰╭]\d/.test(row) && !/\d[╮╯]/.test(row), `no text sits in a border corner (${row})`);
  }
});

check("a group with no room to nest keeps its total and says what it folded", () => {
  const spec = {
    type: "treemap",
    width: 40,
    height: 8,
    items: [
      { label: "Big", children: [{ label: "B1", value: 100 }, { label: "B2", value: 90 }] },
      { label: "Tiny", children: [{ label: "T1", value: 2 }, { label: "T2", value: 1 }] },
    ],
  };
  const text = textRows(renderTreemapRows(spec)).join("\n");
  // The small group cannot nest, so it becomes one tile with its total instead of
  // vanishing; the footer names the group and the children it folded.
  assert.match(text, /Tiny/, "the group keeps a tile and a legend entry");
  assert.match(text, /collapsed: Tiny \(2 children\)/, "the footer accounts for the lost children");
  assert.ok(!/T1|T2/.test(text), "and the children themselves are not drawn");
  assert.match(text, /B1/);
  assert.match(text, /B2/);
});

check("no child is dropped when the map has room for it", () => {
  const spend = {
    type: "treemap",
    width: 48,
    height: 12,
    title: "Spend by team",
    items: [
      { label: "Platform", children: [{ label: "API", value: 19 }, { label: "ETL", value: 15 }, { label: "Web", value: 12 }] },
      { label: "Ops", children: [{ label: "SRE", value: 12 }, { label: "Support", value: 6 }] },
    ],
  };
  const text = textRows(renderTreemapRows(spend)).join("\n");
  for (const label of ["API", "ETL", "Web", "SRE", "Support"]) assert.ok(text.includes(label), `${label} is drawn`);
  assert.ok(!/collapsed|no cell for/.test(text), "and nothing is reported as lost");
});

check("dropped values are counted in a note", () => {
  const spec = {
    type: "treemap",
    width: 40,
    height: 8,
    items: [
      { label: "Real", value: 10 },
      { label: "Zero", value: 0 },
      { label: "Neg", value: -4 },
      { label: "NaN", value: NaN },
      { label: "Inf", value: Infinity },
    ],
  };
  const text = textRows(renderTreemapRows(spec)).join("\n");
  assert.match(text, /4 values omitted/);
  assert.equal(normalizeTree(spec).dropped, 4);
});

check("a box is never painted over by a later tile", () => {
  // Rounding put two small neighbours on one cell and the late tile erased the
  // early one. Every tile owns whole cells now, so area only ever adds up.
  const lists = [
    Array.from({ length: 8 }, (_, index) => ({ label: `i${index}`, value: (index + 1) ** 2 })),
    Array.from({ length: 8 }, (_, index) => ({ label: `s${index}`, value: [500, 3, 2, 1, 120, 40, 7, 90][index] })),
    Array.from({ length: 12 }, (_, index) => ({ label: `t${index}`, value: [1, 1, 1, 1, 1, 1, 2, 2, 3, 5, 8, 13][index] })),
  ];
  for (const list of lists) {
    const { items } = normalizeTree({ items: list });
    for (let width = 12; width <= 48; width += 4) {
      for (let height = 3; height <= 12; height += 3) {
        const rects = squarify(items, width, height);
        let area = 0;
        for (const rect of rects) {
          assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x1 < width && rect.y1 < height, `${width}x${height} inside the box`);
          assert.ok(rect.x1 >= rect.x && rect.y1 >= rect.y, `${width}x${height} a tile is at least one cell`);
          area += (rect.x1 - rect.x + 1) * (rect.y1 - rect.y + 1);
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y, b.y);
            assert.ok(overlapX < 0 || overlapY < 0, `${width}x${height} ${a.item.label} and ${b.item.label} do not overlap`);
          }
        }
        assert.ok(area <= width * height, `${width}x${height} no cell is counted twice`);
      }
    }
  }
});

check("labels and the legend use display width", () => {
  // A CJK glyph is two cells wide. Counting code points made these rows 34 wide
  // while the box believed it was 40.
  const cjk = {
    type: "treemap",
    width: 40,
    height: 10,
    plotHeight: 8,
    items: [
      { label: "运维", children: [{ label: "部署", value: 10 }, { label: "监控", value: 6 }] },
      { label: "研发", children: [{ label: "前端", value: 8 }, { label: "后端", value: 4 }] },
    ],
  };
  const rows = textRows(renderTreemapRows(cjk));
  for (const row of rows) assert.ok(cols(row) <= 40, `a CJK row fits 40 cells (${row})`);
  // The map itself is a full rectangle; the legend rows are as long as they need.
  for (const row of rows.slice(0, 8)) assert.equal(cols(row), 40, `a CJK grid row is 40 cells (${row})`);
  assert.ok(rows.some((row) => row.includes("部署")), "a CJK child is labelled");
  assert.ok(rows.some((row) => row.includes("● 运维")), "the legend names the group");
  // The value of a CJK tile is inside the box, not over its border.
  for (const row of rows) assert.ok(!/[╰╭]\d/.test(row) && !/[\u4e00-\u9fff]╮/.test(row), `no text in a corner (${row})`);
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

check("height is the total block, not just the map", () => {
  const rows = textRows(renderTreemapRows({ ...grouped, height: 10 }));
  assert.ok(rows.length <= 10, `height 10 drew ${rows.length} rows`);
});

check("plotHeight keeps the map height while height stays total", () => {
  const rows = textRows(renderTreemapRows({ ...grouped, height: 20, plotHeight: 8 }));
  assert.ok(rows.length <= 20, `height 20 drew ${rows.length} rows`);
  assert.ok(rows.length >= 8, "the map still gets its plot rows");
});

// The reader: every shape a spec may arrive in, and what the tree says about it.

check("flat items keep their order and their group", () => {
  const tree = normalizeTree({ items: [{ label: "A", value: 3 }, { label: "B", value: 5 }] });
  assert.deepEqual(tree.items, [
    { label: "A", value: 3, group: 0 },
    { label: "B", value: 5, group: 1 },
  ]);
  assert.deepEqual(tree.tree, [
    { label: "A", value: 3, group: 0, leaf: 0, children: [] },
    { label: "B", value: 5, group: 1, leaf: 1, children: [] },
  ]);
  assert.equal(tree.grouped, false, "a flat list is not grouped");
  assert.equal(tree.dropped, 0);
  assert.equal(tree.names.length, 0, "a flat list has no group names");
});

check("an item with children becomes one total plus its leaves", () => {
  const tree = normalizeTree(grouped);
  assert.equal(tree.grouped, true);
  assert.deepEqual(tree.items.slice(0, 2), [
    { label: "API", value: 40, group: 0 },
    { label: "Web", value: 25, group: 0 },
  ]);
  assert.deepEqual(tree.tree[0], { label: "Platform", value: 65, group: 0, leaf: -1, children: [0, 1] });
  assert.equal(tree.names[0], "Platform", "the group is named for the legend");
  const leaves = tree.items.reduce((sum, item) => sum + item.value, 0);
  const nodes = tree.tree.reduce((sum, node) => sum + node.value, 0);
  assert.equal(nodes, leaves, "the tree accounts for every leaf");
  for (const node of tree.tree) {
    for (const at of node.children) assert.ok(at >= 0 && at < tree.items.length, `child ${at} exists`);
  }
});

check("a pair row is read as a label and a value", () => {
  const rows = normalizeTree({ items: [["Alpha", 30], ["Beta", 20]] });
  assert.deepEqual(rows.items, [
    { label: "Alpha", value: 30, group: 0 },
    { label: "Beta", value: 20, group: 1 },
  ]);
  const nested = normalizeTree({ items: [{ label: "Group", children: [["x", 2], ["y", 3]] }] });
  assert.deepEqual(nested.items, [
    { label: "x", value: 2, group: 0 },
    { label: "y", value: 3, group: 0 },
  ]);
  assert.equal(nested.tree[0].value, 5, "a pair group totals its children");
});

check("an empty spec yields an empty tree", () => {
  for (const spec of [{}, { items: [] }, { children: [] }, { values: [] }, { items: null }, { values: null }]) {
    const tree = normalizeTree(spec);
    assert.deepEqual(tree.items, [], JSON.stringify(spec));
    assert.deepEqual(tree.tree, []);
    assert.equal(tree.grouped, false);
    assert.equal(tree.dropped, 0);
    assert.equal(tree.names.length, 0);
  }
});

check("only a positive finite number takes area", () => {
  const tree = normalizeTree({
    items: [
      { label: "ok", value: 10 },
      { label: "zero", value: 0 },
      { label: "neg", value: -4 },
      { label: "nan", value: NaN },
      { label: "inf", value: Infinity },
      { label: "ninf", value: -Infinity },
      { label: "text", value: "abc" },
      { label: "numeric text", value: "12" },
    ],
  });
  assert.deepEqual(tree.items.map((item) => item.label), ["ok", "numeric text"], "a numeric string counts, junk does not");
  assert.equal(tree.items[1].value, 12, "a numeric string is read as a number");
  assert.equal(tree.dropped, 6, "six entries cannot take area");
});

check("a missing label is numbered by its place among the drawn leaves", () => {
  const tree = normalizeTree({ items: [{ value: 4 }, { label: "Named", value: 5 }, { value: 6 }] });
  assert.deepEqual(tree.items.map((item) => item.label), ["item 1", "Named", "item 3"]);
  // A dropped entry takes no number, so the count follows the leaves that are drawn.
  const holes = normalizeTree({ items: [{ value: 0 }, { value: 5 }] });
  assert.deepEqual(holes.items, [{ label: "item 1", value: 5, group: 1 }], "the dropped entry does not take a number");
  // `name` is the other accepted spelling.
  const named = normalizeTree({ items: [{ name: "By name", value: 2 }] });
  assert.equal(named.items[0].label, "By name");
  const fromValues = normalizeTree({ values: [1, 2] });
  assert.deepEqual(fromValues.items.map((item) => item.label), ["item 1", "item 2"]);
  const fromLabels = normalizeTree({ labels: ["L"], values: [1, 2] });
  assert.deepEqual(fromLabels.items.map((item) => item.label), ["L", "item 2"], "a missing label falls back by position");
});

check("duplicate labels stay separate leaves", () => {
  const spec = { items: [{ label: "Same", value: 1 }, { label: "Same", value: 2 }, { label: "Same", value: 3 }] };
  const tree = normalizeTree(spec);
  assert.equal(tree.items.length, 3, "no label is merged away");
  assert.deepEqual(tree.items.map((item) => item.group), [0, 1, 2], "each row keeps its own group");
  assert.deepEqual(tree.items.map((item) => item.value), [1, 2, 3]);
  const text = textRows(renderTreemapRows({ ...spec, width: 60, height: 12 })).join("\n");
  assert.ok((text.match(/Same/g) ?? []).length >= 2, "the duplicates are drawn");
  assert.ok(!/omitted|collapsed/.test(text), "nothing is lost");
});

check("malformed children fall back to a leaf or are dropped", () => {
  // `children` that is not an array is not nesting: the entry is a plain leaf.
  const notArray = normalizeTree({ items: [{ label: "Flat", value: 5, children: "nope" }] });
  assert.deepEqual(notArray.tree, [{ label: "Flat", value: 5, group: 0, leaf: 0, children: [] }]);
  assert.equal(notArray.grouped, false);
  // An empty `children` reads as a leaf, which has no value, so it is dropped.
  const emptyKids = normalizeTree({ items: [{ label: "Empty", children: [] }] });
  assert.equal(emptyKids.items.length, 0);
  assert.equal(emptyKids.dropped, 1);
  assert.equal(emptyKids.tree.length, 0);
  // A group whose children are all junk keeps no node, and the junk is counted.
  const junkKids = normalizeTree({
    items: [{ label: "Junk", children: [null, 0, { label: "x", value: 0 }] }, { label: "Real", value: 2 }],
  });
  assert.deepEqual(junkKids.tree, [{ label: "Real", value: 2, group: 1, leaf: 0, children: [] }]);
  assert.equal(junkKids.dropped, 3, "every unusable child is counted");
  assert.equal(junkKids.names[0], "Junk", "the group still has its name");
  // Good and bad children together: only the usable ones become leaves.
  const mixed = normalizeTree({
    items: [{ label: "Mixed", children: [{ label: "keep", value: 2 }, null, { label: "keep2", value: 3 }] }],
  });
  assert.deepEqual(mixed.items.map((item) => item.label), ["keep", "keep2"]);
  assert.deepEqual(mixed.tree[0].children, [0, 1]);
  assert.equal(mixed.tree[0].value, 5);
  assert.equal(mixed.dropped, 1);
});

check("a group with no usable child leaves no legend entry", () => {
  const spec = { width: 40, height: 8, items: [{ label: "Junk", children: [null] }, { label: "Real", value: 4 }] };
  const text = textRows(renderTreemapRows(spec)).join("\n");
  assert.match(text, /1 value omitted/, "the unusable child is counted, not silent");
  assert.ok(!text.includes("● Junk"), "a group with no leaf has no colour to name");
  assert.ok(text.includes("● Real"), "the group with a leaf is named");
});

check("a group without a label is numbered, and `name` is accepted", () => {
  const tree = normalizeTree({
    items: [{ children: [{ value: 3 }] }, { name: "By name", children: [{ value: 4 }] }],
  });
  assert.deepEqual(tree.names, ["group 1", "By name"], "a group takes its label from label, name, or its place");
  assert.deepEqual(tree.tree.map((node) => node.label), ["group 1", "By name"]);
  assert.deepEqual(tree.tree.map((node) => node.value), [3, 4]);
});

check("normalizeTree leaves the spec alone and repeats itself", () => {
  const spec = {
    items: [{ label: "A", value: 3, children: [{ label: "a", value: 2 }] }, { label: "B", value: 4 }],
    labels: ["x"],
    values: [1],
  };
  const snapshot = JSON.stringify(spec);
  const first = normalizeTree(spec);
  const second = normalizeTree(spec);
  assert.equal(JSON.stringify(spec), snapshot, "the spec is not mutated");
  assert.deepEqual(first, second, "the same spec gives the same tree");
});

console.log(`\n${checks}/${checks} checks passed`);
