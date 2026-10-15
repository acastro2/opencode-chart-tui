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

/** Rows left between two nodes in a column. */
const NODE_GAP = 1;
/** Bands are dimmer than node bars, so the bars still carry the shape. */
const LINK_SHADE = 0.7;

const name = (value) => (typeof value === "string" ? value : String(value ?? ""));

/**
 * Read nodes and links out of a spec. `nodes` is optional: a node that only
 * appears in a link is created from it. Node columns are derived by
 * longest-path layering (a node sits one column right of its rightmost
 * predecessor) unless the node declares `column`, which is fixed. Self-links
 * count towards a node's flow but are not drawn, because a band with no
 * horizontal room has nowhere to go.
 */
export function normalizeSankey(spec) {
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

  for (const raw of Array.isArray(spec.nodes) ? spec.nodes : []) {
    const id = name(raw?.id ?? raw?.label);
    if (!id) continue;
    const node = ensure(id);
    node.label = name(raw?.label ?? raw?.id ?? id);
    if (Number.isInteger(raw?.column)) node.column = raw.column;
  }

  const links = [];
  for (const raw of Array.isArray(spec.links) ? spec.links : []) {
    const from = name(raw?.from ?? raw?.source);
    const to = name(raw?.to ?? raw?.target);
    const value = Number(raw?.value);
    if (!from || !to || !Number.isFinite(value) || value <= 0) continue;
    const source = ensure(from);
    const target = ensure(to);
    const link = { index: links.length, from, to, value, source, target, label: raw?.label == null ? null : String(raw.label) };
    links.push(link);
    if (from !== to) {
      source.outgoing.push(link);
      target.incoming.push(link);
    }
  }

  const fixed = new Set(order.filter((node) => node.column !== undefined).map((node) => node.id));
  const column = new Map(order.map((node) => [node.id, node.column ?? 0]));
  for (let pass = 0; pass <= order.length; pass++) {
    let changed = false;
    for (const link of links) {
      if (link.from === link.to || fixed.has(link.to)) continue;
      const next = (column.get(link.from) ?? 0) + 1;
      if (next > (column.get(link.to) ?? 0)) {
        column.set(link.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let min = 0;
  for (const value of column.values()) min = Math.min(min, value);
  for (const node of order) {
    node.column = (column.get(node.id) ?? 0) - min;
    const incoming = node.incoming.reduce((sum, link) => sum + link.value, 0);
    const outgoing = node.outgoing.reduce((sum, link) => sum + link.value, 0);
    node.flow = Math.max(incoming, outgoing);
  }

  return { nodes: order, links };
}

/**
 * Where every node and every link sits, in cell units. Mutates nothing: the
 * result carries the same node and link objects with `top`, `height` and the
 * four band edges added as plain properties.
 */
export function sankeyLayout(nodes, links, width, height) {
  const columns = [];
  for (const node of nodes) {
    columns[node.column] ??= [];
    columns[node.column].push(node);
  }
  for (const list of columns) list.sort((a, b) => b.flow - a.flow || a.index - b.index);

  const widest = columns.map((list) => list.reduce((max, node) => Math.max(max, cols(node.label)), 0));

  // A wide chart can afford a two-cell bar, which reads as a bar rather than a
  // line. The columns then spread across the whole width instead of hugging the
  // left: each column's labels own the space to its left, and whatever is left
  // over grows the gaps, up to a cap so the bands between them stay readable.
  const barWidth = width >= 44 && columns.length <= 4 ? 2 : 1;
  let gutter = Math.min(Math.max(1, (widest[0] ?? 0) + 1), Math.max(1, Math.floor(width * 0.3)));
  const gaps = [];
  for (let index = 1; index < columns.length; index++) gaps.push(Math.max(2, (widest[index] ?? 0) + 1));

  const span = () => gutter + columns.length * barWidth + gaps.reduce((sum, value) => sum + value, 0);

  let overflow = span() - width;
  for (let index = 0; index < gaps.length && overflow > 0; index++) {
    const take = Math.min(overflow, gaps[index] - 2);
    gaps[index] -= take;
    overflow -= take;
  }
  while (overflow > 0 && gutter > 1) {
    gutter -= 1;
    overflow -= 1;
  }

  const GAP_CAP = 14;
  let leftover = width - span();
  while (leftover > 0) {
    let grew = false;
    for (let index = 0; index < gaps.length && leftover > 0; index++) {
      if (gaps[index] >= GAP_CAP) continue;
      gaps[index] += 1;
      leftover -= 1;
      grew = true;
    }
    if (!grew) break;
  }

  const leftPad = Math.max(0, Math.floor((width - span()) / 2));
  const barX = (column) =>
    leftPad + gutter + column * barWidth + gaps.slice(0, column).reduce((sum, value) => sum + value, 0);

  const gapRows = columns.reduce((max, list) => Math.max(max, Math.max(0, list.length - 1) * NODE_GAP), 0);
  const maxFlow = nodes.reduce((max, node) => Math.max(max, node.flow), 0) || 1;
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

  // Slots sit on the shared scale and are clipped to the bar they belong to.
  // Filling each bar with its own slots would hide the drop-off: a node that
  // takes 100 in and sends 30 out would draw a full-height band for those 30,
  // and a funnel is exactly the chart where that matters. Whole-cell bar heights
  // mean a slot can run a fraction past its bar, so the clip is what keeps every
  // band inside the node it belongs to.
  const slots = (node, links, topKey, bottomKey) => {
    const bottom = node.top + node.height;
    let offset = 0;
    for (const link of links) {
      link[topKey] = Math.min(node.top + offset * scale, bottom);
      link[bottomKey] = Math.min(node.top + (offset + link.value) * scale, bottom);
      offset += link.value;
    }
  };

  for (const node of nodes) {
    const outgoing = [...node.outgoing].sort(
      (a, b) => a.target.top + a.target.height / 2 - (b.target.top + b.target.height / 2) || a.index - b.index,
    );
    slots(node, outgoing, "sourceTop", "sourceBottom");
  }

  for (const node of nodes) {
    const incoming = [...node.incoming].sort(
      (a, b) => a.source.top + a.source.height / 2 - (b.source.top + b.source.height / 2) || a.index - b.index,
    );
    slots(node, incoming, "targetTop", "targetBottom");
  }

  return { columns, barX, gaps, gutter, barWidth, leftPad };
}

export function renderSankeyRows(spec) {
  const width = Math.max(16, Math.floor(spec.width ?? 52));
  const rows = [];
  const title = spec.title == null ? null : String(spec.title);
  if (title) rows.push(titleRow(title, width));

  const { nodes, links } = normalizeSankey(spec);
  const drawn = links.filter((link) => link.from !== link.to);
  if (nodes.length === 0 || drawn.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const height = Math.max(4, Math.floor(spec.height ?? 12));
  const theme = themeOf(spec);
  const palette = paletteOf(spec);
  const colourOf = (node) => palette[node.index % palette.length];
  const { barX, gaps, gutter, barWidth } = sankeyLayout(nodes, links, width, height);

  const sampler = makeSampler(spec.mosaic);
  const { columns: subColumns, rows: subRows } = sampler.shape;
  const owner = Array.from({ length: height * subRows }, () => new Array(width * subColumns).fill(-1));

  for (const link of drawn) {
    const x0 = barX(link.source.column) + barWidth;
    const x1 = barX(link.target.column) - 1;
    if (x1 < x0) continue;
    const span = x1 - x0 + 1;
    for (let x = x0; x <= x1; x++) {
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
  }

  const grid = blankGrid(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { mask, tally, masks } = tallyFromGrid((sx, sy) => owner[sy][sx], x, y, sampler);
      if (mask === 0) continue;
      const cell = paintCell({ sampler, mask, tally, masks, glyphs: links.map(() => SOLID) });
      const link = links[cell.slice];
      grid[y][x] = { ...cell, color: mixOklab(theme.tint, colourOf(link.source), LINK_SHADE) };
    }
  }

  for (const node of nodes) {
    const x = barX(node.column);
    fillRect(grid, x, node.top, x + barWidth - 1, node.top + node.height - 1, {
      slice: node.index,
      kind: "fill",
      color: colourOf(node),
    });
  }

  for (const node of nodes) {
    // The label sits in the space to the left of its bar: the gutter for the
    // first column, the gap before it for every other one.
    const room = (node.column === 0 ? gutter : gaps[node.column - 1]) - 1;
    if (room < 2) continue;
    const text = truncate(node.label, room);
    const at = barX(node.column) - 1 - cols(text);
    if (at < 0) continue;
    const y = Math.max(0, Math.min(height - 1, node.top + Math.floor(node.height / 2)));
    stampText(grid, at, y, text, {
      slice: node.index,
      kind: "label",
      color: mixOklab(theme.tint, colourOf(node), 0.95),
    });
  }

  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });
  return rows;
}
