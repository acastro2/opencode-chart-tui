// Treemap: area is value, and the box is filled completely.
//
// Three ideas carry the drawing:
//
// 1. Squarified layout (Bruls, Huizing, van Wijk). Areas are laid out in strips
//    along the shorter side of whatever rectangle is left, and the strip grows
//    only while the worst aspect ratio inside it improves. That is what keeps
//    cells readable instead of turning them into needles.
// 2. A cell is a rectangle of *background* colour, so the terminal grid itself
//    becomes the chart. The border takes the group colour as a foreground, the
//    interior takes a dimmed tint of it, and the label is written over the tint.
// 3. Groups colour the leaves. A leaf knows its top-level group, so nesting is
//    shown with colour rather than with a second layout pass, and the legend
//    names the groups that occur.

import {
  DEFAULT_PALETTE,
  blankGrid,
  cellsToRuns,
  contrastOn,
  drawBox,
  fillRect,
  formatNumber,
  legendRowRuns,
  mixOklab,
  stampText,
  titleRow,
  truncate,
} from "./core.js";
import { paletteOf, themeOf, THEMES } from "./theme.js";

/** How far a tile's interior is mixed towards the terminal background. */
const SHADE = 0.5;
/** The border is the same colour, closer to full strength. */
const EDGE = 0.85;
/** The most of a box one band of items may take, so later items still get a row. */
const ROW_LIMIT = 0.8;

/** Whether a leaf is measurand: a treemap of nothing, zero or negatives is empty. */
function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Read the tree out of a spec. Accepts `items: [{label, value, children?}]`,
 * `children`, `rows: [[label, value]]`, or `labels` + `values`. A leaf records
 * its top-level group so the whole map can be coloured by group.
 */
export function normalizeTree(spec) {
  const items = [];
  const names = [];
  const tree = [];
  let grouped = false;

  const addLeaf = (leaf, group) => {
    const pair = Array.isArray(leaf) ? leaf : null;
    const value = positive(pair ? pair[1] : leaf?.value);
    if (value === null) return -1;
    const label = pair ? pair[0] : (leaf?.label ?? leaf?.name);
    items.push({ label: String(label ?? `item ${items.length + 1}`), value, group });
    return items.length - 1;
  };

  const list = spec.items ?? spec.children;
  if (Array.isArray(list)) {
    list.forEach((item, index) => {
      const kids = item?.children;
      if (Array.isArray(kids) && kids.length > 0) {
        grouped = true;
        const label = String(item.label ?? item.name ?? `group ${index + 1}`);
        names[index] = label;
        const node = { label, value: 0, group: index, leaf: -1, children: [] };
        for (const kid of kids) {
          const at = addLeaf(kid, index);
          if (at < 0) continue;
          node.children.push(at);
          node.value += items[at].value;
        }
        if (node.children.length > 0) tree.push(node);
      } else {
        const at = addLeaf(item, index);
        if (at >= 0) tree.push({ label: items[at].label, value: items[at].value, group: index, leaf: at, children: [] });
      }
    });
  } else {
    const values = Array.isArray(spec.values) ? spec.values : [];
    values.forEach((value, index) => {
      const at = addLeaf({ label: spec.labels?.[index] ?? `item ${index + 1}`, value }, index);
      if (at >= 0) tree.push({ label: items[at].label, value: items[at].value, group: index, leaf: at, children: [] });
    });
  }

  return { items, names, grouped, tree };
}

/** Worst aspect ratio a strip of these areas has when it runs along `side`. */
function worstRatio(row, side) {
  const area = row.reduce((sum, entry) => sum + entry.area, 0);
  const thickness = area / side;
  if (!(thickness > 0)) return Infinity;
  let worst = 1;
  for (const entry of row) {
    const length = entry.area / thickness;
    if (!(length > 0)) return Infinity;
    worst = Math.max(worst, thickness / length, length / thickness);
  }
  return worst;
}

/**
 * Squarified rectangles for `items`, in cell units, inside a `width` x `height`
 * box at the origin. Returns `[{item, index, x, y, x1, y1}]` with the corners
 * clipped to the box, so nothing can paint outside it.
 */
export function squarify(items, width, height, rows = false) {
  const entries = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.value > 0);
  if (entries.length === 0 || width < 1 || height < 1) return [];

  const total = entries.reduce((sum, entry) => sum + entry.item.value, 0);
  const scale = (width * height) / total;
  const areas = entries
    .map((entry) => ({ ...entry, area: entry.item.value * scale }))
    .sort((a, b) => b.area - a.area);

  const placed = [];

  const layout = (remaining, x, y, w, h) => {
    if (remaining.length === 0 || w < 1 || h < 1) return;
    if (remaining.length === 1) {
      placed.push({ ...remaining[0], x, y, w, h });
      return;
    }
    // Squarify lays the strip along the *shorter* side of what is left: a column
    // when the box is wider than it is tall, a row when it is taller than wide.
    // `rows` forces the other choice, so a group's children read as bands of
    // items stacked downwards, the way a spreadsheet treemap shows them.
    const horizontal = rows || w < h;
    const side = horizontal ? w : h;

    let row = [remaining[0]];
    let best = worstRatio(row, side);
    for (let i = 1; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const ratio = worstRatio(candidate, side);
      if (ratio > best) break;
      // A band that eats the whole box leaves no room for the items after it, so
      // a row stops growing once it would take most of the side it runs along.
      // The last band is allowed to take what is left, so this always makes
      // progress: a rejected item simply starts the next band.
      const area = candidate.reduce((sum, entry) => sum + entry.area, 0);
      const limit = horizontal ? h : w;
      if (area / side > limit * ROW_LIMIT) break;
      row = candidate;
      best = ratio;
    }

    const rowArea = row.reduce((sum, entry) => sum + entry.area, 0);
    const thickness = rowArea / side;
    let cursor = horizontal ? x : y;
    for (const entry of row) {
      const length = entry.area / thickness;
      placed.push(horizontal ? { ...entry, x: cursor, y, w: length, h: thickness } : { ...entry, x, y: cursor, w: thickness, h: length });
      cursor += length;
    }

    const rest = remaining.slice(row.length);
    if (horizontal) layout(rest, x, y + thickness, w, h - thickness);
    else layout(rest, x + thickness, y, w - thickness, h);
  };

  layout(areas, 0, 0, width, height);

  // Cell units: round the continuous rectangles, keep them inside the box and
  // never let one vanish, because a cell smaller than one character cannot be
  // seen and would leave a hole in the map.
  return placed.map((entry) => {
    const x = Math.max(0, Math.min(width - 1, Math.round(entry.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(entry.y)));
    const x1 = Math.max(x, Math.min(width - 1, Math.round(entry.x + entry.w) - 1));
    const y1 = Math.max(y, Math.min(height - 1, Math.round(entry.y + entry.h) - 1));
    return { item: entry.item, index: entry.index, x, y, x1, y1 };
  });
}

/** The rows a treemap draws: title, the group boxes, then the legend. */
export function renderTreemapRows(spec) {
  const width = Math.max(12, Math.floor(spec.width ?? 48));
  const rows = [];
  const title = spec.title == null ? null : String(spec.title);
  if (title) rows.push(titleRow(title, width));

  const { items, names, grouped, tree } = normalizeTree(spec);
  if (items.length === 0) {
    rows.push({ width, runs: [{ text: "  no data", slice: -1, kind: "outside" }] });
    return rows;
  }

  const height = Math.max(3, Math.floor(spec.height ?? 12));
  const theme = themeOf(spec);
  const palette = paletteOf(spec);
  const grid = blankGrid(width, height);
  const rects = squarify(
    tree.map((node) => ({ value: node.value, node })),
    width,
    height,
  );

  for (const rect of rects) {
    const node = rect.item.node;
    const colour = palette[node.group % palette.length];
    const tint = mixOklab(theme.tint, colour, SHADE);
    const edge = mixOklab(theme.tint, colour, EDGE);
    const room = rect.x1 - rect.x - 1;
    const tall = rect.y1 - rect.y;

    // A group with children gets its own box and a header, and its children are
    // squarified inside what is left: that nesting is what makes a treemap read
    // as a treemap instead of a row of columns.
    if (node.children.length >= 1 && room >= 6 && tall >= 4) {
      fillRect(grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "cell", color: mixOklab(theme.tint, colour, SHADE * 0.45) });
      drawBox(grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "fill", color: edge });
      stampText(grid, rect.x + 1, rect.y + 1, truncate(`${node.label} ${formatNumber(node.value)}`, room), {
        slice: rect.index,
        kind: "title",
      });

      const innerX = rect.x + 1;
      const innerY = rect.y + 2;
      const innerWidth = rect.x1 - innerX;
      const innerHeight = rect.y1 - innerY;
      if (innerWidth >= 3 && innerHeight >= 1) {
        // A group's children are laid out as rows: bands of items stacked
        // downwards, which is what a spreadsheet treemap looks like.
        const kidRects = squarify(node.children.map((at) => ({ value: items[at].value, at })), innerWidth, innerHeight, true);
        // Boxing is a decision for the group, not for each child: when the
        // smallest of them cannot carry a box, none of them get one and the
        // siblings are told apart by their shade. A mix of boxed and unboxed
        // children in one group is what made a group look unfinished.
        const boxAll = kidRects.every((kid) => kid.x1 - kid.x >= 7 && kid.y1 - kid.y >= 3);
        for (const kid of kidRects) {
          const x = kid.x + innerX;
          const y = kid.y + innerY;
          const x1 = kid.x1 + innerX;
          const y1 = kid.y1 + innerY;
          // Siblings of one group share the hue and differ in shade, so the map
          // still reads as groups at a glance.
          // Siblings need to be told apart inside the group tint, so each rank
          // takes a brighter step than the one before it.
          const kidTint = mixOklab(theme.tint, colour, 0.45 + (kid.index % 4) * 0.14);
          // Siblings are separated by one clear column and row of the group's own
          // tint, the way a spreadsheet treemap leaves a gap between blocks, so a
          // child's area stays legible even when it is too small to carry a box.
          const gapX = x1 - x >= 3 ? 1 : 0;
          const gapY = y1 - y >= 2 ? 1 : 0;
          const bx = x1 - gapX;
          const by = y1 - gapY;
          fillRect(grid, x, y, bx, by, { slice: kid.item.at, kind: "cell", color: kidTint });
          const boxed = boxAll;
          if (boxed) {
            drawBox(grid, x, y, bx, by, { slice: kid.item.at, kind: "fill", color: mixOklab(theme.tint, colour, 0.9) });
          }
          const pad = boxed ? 1 : 0;
          const kidRoom = bx - x + 1 - 2 * pad;
          const kidTop = boxed ? y + 1 : y;
          if (kidRoom >= 4) {
            stampText(grid, x + pad, kidTop, truncate(items[kid.item.at].label, kidRoom), {
              slice: kid.item.at,
              kind: "label",
              color: kidTint,
            });
          }
          if (kidRoom >= 4 && by - kidTop >= 2) {
            stampText(grid, x + pad, kidTop + 1, truncate(formatNumber(items[kid.item.at].value), kidRoom), {
              slice: kid.item.at,
              kind: "label",
              color: kidTint,
            });
          }
        }
      }
      continue;
    }

    fillRect(grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "cell", color: tint });
    drawBox(grid, rect.x, rect.y, rect.x1, rect.y1, { slice: rect.index, kind: "fill", color: edge });

    // A label needs room for itself and the border either side.
    if (room >= 3 && tall >= 2) {
      stampText(grid, rect.x + 1, rect.y + 1, truncate(node.label, room), { slice: rect.index, kind: "label", color: tint });
      if (tall >= 3) {
        // Same kind as the label: the plugin paints a label with the tile colour
        // as its background, so the value sits on the tile instead of punching a
        // hole through it.
        stampText(grid, rect.x + 1, rect.y + 2, truncate(formatNumber(node.value), room), {
          slice: rect.index,
          kind: "label",
          color: tint,
        });
      }
    }
  }

  for (const row of grid) rows.push({ width, runs: cellsToRuns(row) });

  if (grouped && spec.legend !== false) {
    const entries = items.reduce((list, item) => {
      const at = list.findIndex((entry) => entry.group === item.group);
      if (at === -1) list.push({ group: item.group, label: names[item.group] ?? item.label, value: item.value });
      else list[at].value += item.value;
      return list;
    }, []);
    for (const [index, entry] of entries.entries()) {
      void index;
      rows.push(
        ...legendRowRuns([{ label: entry.label, value: entry.value }], {
          width,
          values: false,
        }).map((row) => ({ ...row, runs: row.runs.map((run) => (run.kind === "legend-mark" ? { ...run, slice: entry.group } : run)) })),
      );
    }
  }

  return rows;
}

/** The contrast colour for a group's tile, exposed for callers that draw their own labels. */
export function treemapContrast(colour, theme = THEMES.dark) {
  return contrastOn(mixOklab(theme.tint, colour, SHADE));
}
