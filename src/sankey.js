// Sankey: flow between columns.
//
// Three ideas carry the drawing:
//
// 1. Columns come from the links (longest-path layering) unless a node names
//    its own `column`. A node's height is its flow on one scale shared by every
//    column, so heights are comparable across the chart and a column is centred
//    in the room it has.
// 2. A link is a trapezoid from its slot in the source node to its slot in the
//    target node, sampled per sub-cell. Both edges of a band therefore land on
//    the sub-cell grid instead of on cell rows, which is what makes a thin flow
//    visible at all.
// 3. Slots are ordered by the position of the other end, so bands cross only
//    where the data forces them to. The link's colour is its source node's
//    colour, dimmed, and node bars are painted over the bands afterwards, so a
//    flow always reads as going *under* a node rather than through it.

import {
  DEFAULT_PALETTE,
  SOLID,
  blankGrid,
  cellsToRuns,
  cols,
  fillRect,
  makeSampler,
  mixOklab,
  paintCell,
  stampText,
  tallyFromGrid,
  titleRow,
  truncate,
} from "./core.js";
import { paletteOf, themeOf } from "./theme.js";
import { plotRows as plotRowsFor } from "./layout.js";
import { coerce, policyFor } from "./values.js";

/** Rows left between two nodes in a column. */
const NODE_GAP = 1;
/** Bands are dimmer than node bars, so the bars still carry the shape. */
const LINK_SHADE = 0.7;
/** Widest a gap may grow; past this the bands between columns read as empty. */
const GAP_CAP = 14;
/** A node bar stops growing here; past it the flow reads as a block, not a river. */
const BAR_CAP = 8;
/** The shared fate of a link value: a blank and an unreadable one drop the link. */
const SANKEY_POLICY = policyFor("sankey");

const name = (value) => (typeof value === "string" ? value : String(value ?? ""));

/** A node seen in the spec, keyed by its id and kept in first-seen order. */
function createRegistry() {
  const table = new Map();
  const order = [];

  const ensure = (id) => {
    let node = table.get(id);
    if (!node) {
      node = { id, label: id, column: undefined, incoming: [], outgoing: [], index: order.length };
      table.set(id, node);
      order.push(node);
    }
    return node;
  };

  return { order, ensure };
}

/** The id a node is keyed by: `id` wins, and `label` stands in for it. */
const nodeIdOf = (raw) => name(raw?.id ?? raw?.label);

/** A node's label; a node without one is labelled by its id. */
const nodeLabelOf = (raw, id) => name(raw?.label ?? id);

/** Only an integer is a declared column; anything else is left to the layering. */
const declaredColumnOf = (raw) => (Number.isInteger(raw?.column) ? raw.column : undefined);

/** Declare one node: its label wins over its id, and `column` is fixed. */
function readNode(raw, ensure) {
  const id = nodeIdOf(raw);
  if (!id) return;
  const node = ensure(id);
  node.label = nodeLabelOf(raw, id);
  const column = declaredColumnOf(raw);
  if (column !== undefined) node.column = column;
}

/** One end of a link: `from`/`to`, or its `source`/`target` alias. */
const endpointOf = (raw, key, alias) => name(raw?.[key] ?? raw?.[alias]);

const linkValueOf = (raw) => coerce(raw?.value, SANKEY_POLICY).value;

const linkLabelOf = (raw) => (raw?.label == null ? null : String(raw.label));

/** A link needs both ends and a value the policy kept: finite and above zero. */
const isReadableLink = (from, to, value) =>
  Boolean(from) && Boolean(to) && value !== null && value > 0;

/** Append the link and hand it back, in the same property order as the spec. */
function addLink(raw, links, ensure, { from, to, value }) {
  const source = ensure(from);
  const target = ensure(to);
  const link = {
    index: links.length,
    from,
    to,
    value,
    source,
    target,
    label: linkLabelOf(raw),
  };
  links.push(link);
  return link;
}

/**
 * Give the link its adjacency. A self-link gets none: it is no edge for the
 * layering to place, and a node's flow is read off its edges, so it adds
 * nothing there either.
 */
function connect(link) {
  if (link.from === link.to) return;
  link.source.outgoing.push(link);
  link.target.incoming.push(link);
}

/**
 * Read one link: both ends, a finite positive value, and a label that stays
 * `null` when the spec gives none. Everything else is dropped rather than
 * guessed, so a malformed row cannot invent a node.
 */
function readLink(raw, links, ensure) {
  const from = endpointOf(raw, "from", "source");
  const to = endpointOf(raw, "to", "target");
  const value = linkValueOf(raw);
  if (!isReadableLink(from, to, value)) return;
  connect(addLink(raw, links, ensure, { from, to, value }));
}

/**
 * A cycle has no longest path. Find the edges that close a cycle first and
 * leave them out of the layering: the graph stays drawable, and the reader
 * gets a note instead of a crash or an ever-growing column.
 */
function findBackEdges(nodes) {
  const state = new Map();
  const backEdges = new Set();

  const visit = (node) => {
    state.set(node.id, 1);
    for (const link of node.outgoing) {
      const mark = state.get(link.target.id) ?? 0;
      if (mark === 1) {
        backEdges.add(link.index);
        continue;
      }
      if (mark === 0) visit(link.target);
    }
    state.set(node.id, 2);
  };

  for (const node of nodes) if (!state.get(node.id)) visit(node);
  return backEdges;
}

/** An edge the layering may follow: not a self-link, not a cycle, not into a fixed column. */
const laysOut = (link, fixed, backEdges) =>
  link.from !== link.to && !fixed.has(link.to) && !backEdges.has(link.index);

/**
 * Longest-path layering: a node sits one column right of its rightmost
 * predecessor. `nodes.length` passes are enough for the longest chain, so the
 * loop stops there or at the first pass that moves nothing.
 */
function relaxColumns(nodes, links, backEdges) {
  const fixed = new Set(nodes.filter((node) => node.column !== undefined).map((node) => node.id));
  const columns = new Map(nodes.map((node) => [node.id, node.column ?? 0]));

  for (let pass = 0; pass <= nodes.length; pass++) {
    let changed = false;
    for (const link of links) {
      if (!laysOut(link, fixed, backEdges)) continue;
      const next = (columns.get(link.from) ?? 0) + 1;
      if (next > (columns.get(link.to) ?? 0)) {
        columns.set(link.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return columns;
}

/** A fixed negative column would leave the grid, so the whole chart shifts right. */
function columnOffset(columns) {
  let min = 0;
  for (const value of columns.values()) min = Math.min(min, value);
  return min;
}

const flowOf = (node) =>
  Math.max(
    node.incoming.reduce((sum, link) => sum + link.value, 0),
    node.outgoing.reduce((sum, link) => sum + link.value, 0),
  );

/** Write the resolved column and flow back onto every node, in node order. */
function assignColumns(nodes, columns, min) {
  for (const node of nodes) {
    node.column = (columns.get(node.id) ?? 0) - min;
    node.flow = flowOf(node);
  }
}

/**
 * Read nodes and links out of a spec. `nodes` is optional: a node that only
 * appears in a link is created from it. Node columns are derived by
 * longest-path layering (a node sits one column right of its rightmost
 * predecessor) unless the node declares `column`, which is fixed. Self-links
 * count towards a node's flow but are not drawn, because a band with no
 * horizontal room has nowhere to go.
 */
export function normalizeSankey(spec) {
  const { order, ensure } = createRegistry();

  for (const raw of Array.isArray(spec.nodes) ? spec.nodes : []) readNode(raw, ensure);

  const links = [];
  for (const raw of Array.isArray(spec.links) ? spec.links : []) readLink(raw, links, ensure);

  const backEdges = findBackEdges(order);
  const columns = relaxColumns(order, links, backEdges);
  assignColumns(order, columns, columnOffset(columns));

  return { nodes: order, links, cycles: links.filter((link) => backEdges.has(link.index)) };
}

/** Group nodes into their columns, filling any hole a fixed column left. */
function groupColumns(nodes) {
  const columns = [];
  for (const node of nodes) {
    columns[node.column] ??= [];
    columns[node.column].push(node);
  }
  // A fixed node can leave a gap between columns. Fill it so the array has no
  // holes; a hole used to reach `.sort` as `undefined`.
  for (let index = 0; index < columns.length; index++) columns[index] ??= [];
  for (const list of columns) list.sort((a, b) => b.flow - a.flow || a.index - b.index);
  return columns;
}

const widestLabels = (columns) =>
  columns.map((list) => list.reduce((max, node) => Math.max(max, cols(node.label)), 0));

const spanOf = (columnCount, barWidth, gutter, gaps) =>
  gutter + columnCount * barWidth + gaps.reduce((sum, value) => sum + value, 0);

/** A wide chart can afford a two-cell bar, which reads as a bar rather than a line. */
const barWidthFor = (width, columnCount) => (width >= 44 && columnCount <= 4 ? 2 : 1);

/** The first column's label lives in the gutter, which never takes more than 30% of the width. */
const gutterFor = (widest, width) =>
  Math.min(Math.max(1, (widest ?? 0) + 1), Math.max(1, Math.floor(width * 0.3)));

/** Every later column's label lives in the gap before it, which keeps at least two cells. */
const gapsFor = (widest, columnCount) => {
  const gaps = [];
  for (let index = 1; index < columnCount; index++) gaps.push(Math.max(2, (widest[index] ?? 0) + 1));
  return gaps;
};

/** Spend the overflow on the gaps first, never below two cells, and report what is left. */
function takeFromGaps(gaps, overflow) {
  for (let index = 0; index < gaps.length && overflow > 0; index++) {
    const take = Math.min(overflow, gaps[index] - 2);
    gaps[index] -= take;
    overflow -= take;
  }
  return overflow;
}

/** Whatever the gaps cannot give comes off the gutter, which stops at one cell. */
function gutterAfter(gutter, overflow) {
  while (overflow > 0 && gutter > 1) {
    gutter -= 1;
    overflow -= 1;
  }
  return gutter;
}

/**
 * Shrink the label room and the gaps until the columns fit. The gutter owns the
 * first column's label; every later column owns the gap before it.
 */
function shrinkColumns(columns, width) {
  const columnCount = columns.length;
  const widest = widestLabels(columns);
  const barWidth = barWidthFor(width, columnCount);
  const gaps = gapsFor(widest, columnCount);
  const gutter = gutterFor(widest[0], width);
  const overflow = takeFromGaps(gaps, spanOf(columnCount, barWidth, gutter, gaps) - width);
  return { barWidth, gutter: gutterAfter(gutter, overflow), gaps };
}

/**
 * The gaps cannot shrink far enough. A narrow chart gives up the label room
 * first: one-cell bars, no gutter, then spreads the columns evenly so the
 * right-hand ones cannot fall off the grid. Two neighbouring bars keep the
 * cell between them for the link; where even that is gone, the renderer counts
 * the link and says so in the footer.
 */
function spreadColumns(columnCount, width) {
  const barWidth = 1;
  const step = columnCount > 1 ? (width - barWidth) / (columnCount - 1) : 0;
  const positions = Array.from({ length: columnCount }, (_, index) =>
    Math.max(0, Math.min(width - barWidth, Math.round(index * step))),
  );
  const gutter = positions[0] ?? 0;
  const gaps = positions.slice(1).map((x, index) => Math.max(0, x - positions[index] - barWidth));
  return { barWidth, gutter, gaps, leftPad: 0, positions };
}

/**
 * Where every column starts, in cells, and the room to its left. The columns
 * spread across the whole width instead of hugging the left: each column's
 * labels own the space to its left, and whatever is left over grows the gaps,
 * up to a cap so the bands between them stay readable.
 */
/** Fill the gaps evenly up to the readable cap; returns what is left over. */
function fillGaps(gaps, leftover) {
  let open = leftover;
  while (open > 0) {
    let grew = false;
    for (let index = 0; index < gaps.length && open > 0; index++) {
      if (gaps[index] >= GAP_CAP) continue;
      gaps[index] += 1;
      open -= 1;
      grew = true;
    }
    if (!grew) break;
  }
  return open;
}

/** After the gaps cap, widen the node bars; each step costs one cell per column. */
function fillBars(barWidth, leftover, columnCount) {
  let width = barWidth;
  let open = leftover;
  while (open >= columnCount && width < BAR_CAP) {
    width += 1;
    open -= columnCount;
  }
  return { barWidth: width, leftover: open };
}

/** Whatever is still spare widens the gaps past the cap, evenly. */
function fillRemainder(gaps, leftover) {
  let open = leftover;
  for (let index = 0; index < gaps.length && open > 0; index++) {
    const add = Math.min(open, Math.ceil(open / (gaps.length - index)));
    gaps[index] += add;
    open -= add;
  }
}

/** Where each column starts, given the settled bar width and gaps. */
function columnPositions(count, barWidth, gutter, gaps) {
  return Array.from(
    { length: count },
    (_, column) => gutter + column * barWidth + gaps.slice(0, column).reduce((sum, value) => sum + value, 0),
  );
}

function planColumns(columns, width) {
  let { barWidth, gutter, gaps } = shrinkColumns(columns, width);
  const span = () => spanOf(columns.length, barWidth, gutter, gaps);
  if (span() > width) return spreadColumns(columns.length, width);

  // The gaps are capped so bands stay readable, but the frame is not: fill the
  // gaps to the cap, widen the node bars next, then let the gaps pass the cap
  // evenly. Before this, a wide chart spent half its width on nothing.
  let leftover = fillGaps(gaps, width - span());
  const grown = fillBars(barWidth, leftover, columns.length);
  barWidth = grown.barWidth;
  leftover = grown.leftover;
  fillRemainder(gaps, leftover);

  return {
    barWidth,
    gutter,
    gaps,
    // The columns start after the first label gutter, not centred in the frame.
    leftPad: 0,
    positions: columnPositions(columns.length, barWidth, gutter, gaps),
  };
}

/** Give every node a whole-cell height and a centred top, column by column. */
function placeNodes(columns, height) {
  const gapRows = columns.reduce((max, list) => Math.max(max, Math.max(0, list.length - 1) * NODE_GAP), 0);
  const maxFlow = columns.flat().reduce((max, node) => Math.max(max, node.flow), 0) || 1;
  const scale = Math.max(0.001, (height - gapRows) / maxFlow);

  for (const list of columns) {
    let total = Math.max(0, list.length - 1) * NODE_GAP;
    for (const node of list) {
      node.height = Math.max(1, Math.round(node.flow * scale));
      total += node.height;
    }
    let y = Math.max(0, Math.round((height - total) / 2));
    for (const node of list) {
      node.top = Math.max(0, Math.min(y, height - node.height));
      y += node.height + NODE_GAP;
    }
  }
  return scale;
}

/**
 * Slots sit on the shared scale and are clipped to the bar they belong to.
 * Filling each bar with its own slots would hide the drop-off: a node that
 * takes 100 in and sends 30 out would draw a full-height band for those 30,
 * and a funnel is exactly the chart where that matters. Whole-cell bar heights
 * mean a slot can run a fraction past its bar, so the clip is what keeps every
 * band inside the node it belongs to.
 */
function placeSlots(node, links, topKey, bottomKey, scale) {
  const bottom = node.top + node.height;
  let offset = 0;
  for (const link of links) {
    link[topKey] = Math.min(node.top + offset * scale, bottom);
    link[bottomKey] = Math.min(node.top + (offset + link.value) * scale, bottom);
    offset += link.value;
  }
}

/** Sort bands by where their other end sits, so they cross only where the data forces them. */
const byOtherTop = (other) => (a, b) =>
  other(a).top + other(a).height / 2 - (other(b).top + other(b).height / 2) || a.index - b.index;

function placeSourceSlots(node, scale) {
  const outgoing = [...node.outgoing].sort(byOtherTop((link) => link.target));
  placeSlots(node, outgoing, "sourceTop", "sourceBottom", scale);
}

function placeTargetSlots(node, scale) {
  const incoming = [...node.incoming].sort(byOtherTop((link) => link.source));
  placeSlots(node, incoming, "targetTop", "targetBottom", scale);
}

/**
 * Where every node and every link sits, in cell units. Writes `top`, `height`
 * and the four band edges onto the node and link objects in place, and returns
 * the column geometry. A second call with a new height simply overwrites them.
 */
export function sankeyLayout(nodes, links, width, height) {
  const columns = groupColumns(nodes);
  const { barWidth, gutter, gaps, leftPad, positions } = planColumns(columns, width);
  const scale = placeNodes(columns, height);

  for (const node of nodes) placeSourceSlots(node, scale);
  for (const node of nodes) placeTargetSlots(node, scale);

  const barX = (column) => positions[column] ?? 0;
  return { columns, barX, gaps, gutter, barWidth, leftPad };
}

const isDrawn = (link) => link.from !== link.to;

const noDataRow = (width) => ({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });

const headRows = (title, width) => (title == null ? [] : [titleRow(title, width)]);

const noteRow = (width, text) => ({
  width,
  runs: [{ text: truncate(text, width), slice: -1, kind: "legend" }],
});

const cycleList = (cycles) => cycles.map((link) => `${link.from}->${link.to}`).join(", ");

const hiddenNote = (count, word) => `${count} ${count === 1 ? word : `${word}s`} hidden`;

/** The room left of a node's bar: the gutter for column 0, the gap before it otherwise. */
const roomIn = (layout) => (node) =>
  (node.column === 0 ? layout.gutter : layout.gaps[node.column - 1]) - 1;

/** A link with no cell between its bars cannot be drawn; a cycle edge is named, not counted. */
const lostLinkIn = (layout, cycles) => (link) =>
  !cycles.includes(link) &&
  layout.barX(link.target.column) - 1 < layout.barX(link.source.column) + layout.barWidth;

/** A label is lost when its room is under two cells or it would start left of the grid. */
const lostLabelIn = (layout, room) => (node) => {
  const space = room(node);
  return space < 2 || layout.barX(node.column) - 1 - cols(truncate(node.label, space)) < 0;
};

/** What the horizontal fit costs: the two counts behind the footer notes. */
function lossReport(layout, { nodes, cycles, drawn }) {
  const room = roomIn(layout);
  const undrawn = drawn.filter(lostLinkIn(layout, cycles)).length;
  const hiddenLabels = nodes.filter(lostLabelIn(layout, room)).length;
  return { undrawn, hiddenLabels, notes: (undrawn > 0 ? 1 : 0) + (hiddenLabels > 0 ? 1 : 0) };
}

/** One row of chrome per note, so the drawn frame still matches the declared height. */
const chromeOf = (title, cycles, extra) =>
  (title ? 1 : 0) + (cycles.length > 0 ? 1 : 0) + extra;

/**
 * Place the nodes in the plot left over by the notes. The note count comes from
 * the first fit; the counts written into the footer come from the final one, so
 * a note never shifts the layout that produced it.
 */
function planSankey(spec, width, title, parts) {
  const { nodes, links, cycles } = parts;
  const plotRows = (extra) =>
    plotRowsFor(spec, { chrome: chromeOf(title, cycles, extra), fallback: 12, min: 4, max: 30 });
  const first = sankeyLayout(nodes, links, width, plotRows(0));
  const probe = lossReport(first, parts);
  const height = plotRows(probe.notes);
  const layout = probe.notes > 0 ? sankeyLayout(nodes, links, width, height) : first;
  return { layout, height, ...lossReport(layout, parts) };
}

/** The sub-cell owner grid: one link index per sub-cell, -1 where nothing flows. */
const bandOwner = (width, height, sampler) =>
  Array.from({ length: height * sampler.shape.rows }, () =>
    new Array(width * sampler.shape.columns).fill(-1),
  );

/** Mark one column of a band, from top edge to bottom edge, on the sub-cell grid. */
function maskBandColumn(owner, link, { x, x0, x1, height, subRows, subColumns }) {
  const span = x1 - x0 + 1;
  const t = (x - x0 + 0.5) / span;
  const top = link.sourceTop + (link.targetTop - link.sourceTop) * t;
  const bottom = link.sourceBottom + (link.targetBottom - link.sourceBottom) * t;
  const first = Math.max(0, Math.floor(top));
  const last = Math.min(height - 1, Math.ceil(bottom) - 1);
  for (let y = first; y <= last; y++) {
    for (let sy = 0; sy < subRows; sy++) {
      const point = y + (sy + 0.5) / subRows;
      if (point < top || point >= bottom) continue;
      owner[y * subRows + sy].fill(link.index, x * subColumns, (x + 1) * subColumns);
    }
  }
}

/** Every band is a trapezoid: its edges are sampled per column, then per sub-cell row. */
function maskBands(owner, drawn, layout, height, sampler) {
  const { columns: subColumns, rows: subRows } = sampler.shape;
  for (const link of drawn) {
    const x0 = layout.barX(link.source.column) + layout.barWidth;
    const x1 = layout.barX(link.target.column) - 1;
    if (x1 < x0) continue;
    for (let x = x0; x <= x1; x++) {
      maskBandColumn(owner, link, { x, x0, x1, height, subRows, subColumns });
    }
  }
}

/** Turn the owner grid into tinted cells: a band carries its source node's colour, dimmed. */
function paintBands(grid, owner, links, sampler, theme, colour) {
  const glyphs = links.map(() => SOLID);
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const { mask, tally, masks } = tallyFromGrid((sx, sy) => owner[sy][sx], x, y, sampler);
      if (mask === 0) continue;
      const cell = paintCell({ sampler, mask, tally, masks, glyphs });
      const link = links[cell.slice];
      grid[y][x] = { ...cell, color: mixOklab(theme.tint, colour(link.source), LINK_SHADE) };
    }
  }
}

/** Node bars are painted over the bands, so a flow reads as going under its node. */
function paintBars(grid, nodes, layout, colour) {
  for (const node of nodes) {
    const x = layout.barX(node.column);
    fillRect(grid, x, node.top, x + layout.barWidth - 1, node.top + node.height - 1, {
      slice: node.index,
      kind: "fill",
      color: colour(node),
      char: SOLID,
    });
  }
}

/** A label sits in the room left of its bar, vertically centred on the node. */
function paintLabels(grid, nodes, layout, { height, theme, colour }) {
  const room = roomIn(layout);
  for (const node of nodes) {
    const space = room(node);
    if (space < 2) continue;
    const text = truncate(node.label, space);
    const at = layout.barX(node.column) - 1 - cols(text);
    if (at < 0) continue;
    const y = Math.max(0, Math.min(height - 1, node.top + Math.floor(node.height / 2)));
    stampText(grid, at, y, text, {
      slice: node.index,
      kind: "label",
      color: mixOklab(theme.tint, colour(node), 0.95),
    });
  }
}

/** Bands, then bars over them, then labels: that order is the drawing order. */
function paintSankey(spec, { width, height, layout, nodes, links, drawn }) {
  const theme = themeOf(spec);
  const palette = paletteOf(spec);
  const colour = (node) => palette[node.index % palette.length];
  const sampler = makeSampler(spec.mosaic);
  const owner = bandOwner(width, height, sampler);
  maskBands(owner, drawn, layout, height, sampler);
  const grid = blankGrid(width, height);
  paintBands(grid, owner, links, sampler, theme, colour);
  paintBars(grid, nodes, layout, colour);
  paintLabels(grid, nodes, layout, { height, theme, colour });
  return grid;
}

/** One note per thing the fit hid: the cycles, then the labels, then the links. */
function footerRows(width, { cycles, hiddenLabels, undrawn }) {
  const rows = [];
  if (cycles.length > 0) {
    rows.push(noteRow(width, `  cycle: ${cycleList(cycles)} ignored for layout`));
  }
  if (hiddenLabels > 0) rows.push(noteRow(width, hiddenNote(hiddenLabels, "label")));
  if (undrawn > 0) rows.push(noteRow(width, hiddenNote(undrawn, "link")));
  return rows;
}

export function renderSankeyRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 52));
  const title = spec.title == null ? null : String(spec.title);
  const { nodes, links, cycles } = normalizeSankey(spec);
  const drawn = links.filter(isDrawn);
  if (nodes.length === 0 || drawn.length === 0) {
    return [...headRows(title, width), noDataRow(width)];
  }

  const parts = { nodes, links, cycles, drawn };
  const plan = planSankey(spec, width, title, parts);
  const rows = headRows(title, width);
  const grid = paintSankey(spec, {
    width,
    height: plan.height,
    layout: plan.layout,
    nodes,
    links,
    drawn,
  });
  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });
  return [...rows, ...footerRows(width, { cycles, ...plan })];
}
