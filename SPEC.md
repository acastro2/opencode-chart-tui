# Spec: charts and the missing diagram families for the OpenCode TUI

Status: draft for discussion
Target: `anomalyco/opencode` (default branch `dev`)
Scope: a TUI library that expands what the terminal can draw, shaped for upstream review.

---

## 1. Why this exists

The terminal UI draws six Mermaid families today and drops the other sixteen to raw
source text. Measured, not assumed: a fence per family rendered in the TUI shows
flowchart, sequence, state, gantt, git graph and timeline as diagrams, and class, ER,
pie, journey, mindmap, quadrant, requirement, C4, sankey, XY chart, block, packet,
kanban, architecture, radar and treemap as plain text.

Charts have no path at all. There is no bar, line, sparkline or pie renderer anywhere
in the TUI, and a pie is the most requested thing a person types into a chat.

## 2. What the codebase decided before us

These findings come from reading `anomalyco/opencode` at `dev`. They constrain every
option below.

| Finding | Evidence | Consequence |
|---|---|---|
| One renderer per language, duplicates throw | `packages/tui/src/plugin/api.tsx:169` — `if (input.registry.has("markdown", name)) throw ...; registry.set("markdown", name, render)` | No overlay, no chaining, no delegating back. You either own the language or you do not touch it. |
| Built-in plugins are workspace packages | `packages/merman`, `packages/latex` | New capability = new package in the monorepo, not a config-dir plugin. |
| Mermaid coverage is six families | `packages/merman/src/{flowchart,gantt,gitgraph,sequence,state,timeline}` | Matches the six that render. Anything else must be written. |
| Diagrams render as one styled text grid | `packages/merman/src/markdown.ts` — `StaticDiagramRenderable extends TextRenderable`, `content: prepared.text`, `width: "100%"` | The idiomatic adapter is grid to `StyledText`. Per-line renderables are an anti-pattern here. |
| Theme mapping has a home | `packages/merman/src/palette.ts` → `resolveOpenCodeDiagramPalette(context.theme, context.themeMode)`, exported via `./palette` | Charts must reuse this palette, not invent colours. |
| Reusable drawing core already exists | `packages/merman/src/core/{canvas,drawing,geometry,render-grid,mermaid}.ts` + `*.test.ts` beside sources | Extract and share it; do not write a second canvas. |
| Package conventions | `packages/merman/package.json` — private, versioned with the app, `test: bun test`, `typecheck: tsgo --noEmit`, deps `@opencode/plugin` (workspace), `@opentui/core` (catalog), `entities`, `string-width` | Copy the shape exactly; a PR that deviates gets bounced. |

**The one trap to document for reviewers.** The transcript grid in the TUI does not
measure text renderables in the first layout pass: a `TextRenderable` with automatic
height collapses and paints over its neighbour's border. Pre-sizing every line, or
using one styled grid renderable with an explicit height, is required. This is the
single biggest source of wasted effort for anyone building a renderer here.

## 3. Goals

1. Draw a chart from a fence, with data that the author supplies literally.
2. Cover the Mermaid families that Mermaid defines and the TUI lacks — starting with
   `pie` and `xychart`, both of which Mermaid supports and neither of which renders.
3. Ship it in the shape upstream already uses, with zero new third-party runtime
   dependencies.
4. Keep every renderer a pure function from a parsed model to a cell grid, so it is
   unit-testable without a terminal.

## 4. Non-goals

- No interactive charts. No zoom, no tooltips, no cursor.
- No data fetching. Values are literal; anything dynamic renders as a placeholder.
- No third-party chart bundle. `beautiful-mermaid` was evaluated and rejected (see
  §9): it cannot cover the families that already work, so adopting it is a trade of
  three families for three.
- No override of the `mermaid` language. It is exclusive and the built-in is better
  at the six families it owns.

## 5. Deliverables, in review order

### Phase 1 — two families added to `packages/merman` (small, high acceptance odds)

Add the two Mermaid families that are missing and well-defined:

```
packages/merman/src/pie/
  parser.ts        pie title / "label" : value  -> { title, slices[] }
  drawing.ts       slices -> DiagramCanvas grid
  render-grid.ts   grid -> StyledText
  style.ts         theme tokens -> per-slice glyph and colour
  types.ts
  parser.test.ts   drawing.test.ts
packages/merman/src/xychart/
  parser.ts        xychart-beta: title, x-axis, y-axis, bar[], line[] -> model
  drawing.ts       axes, ticks, bars, line overlay, value labels
  render-grid.ts   grid -> StyledText
  style.ts
  types.ts
  parser.test.ts   drawing.test.ts
```

`detect.ts` learns two keywords, `plugin.ts` does not change.

A pie in a cell grid needs one honest decision, and it should be stated in the PR:
cells are about twice as tall as they are wide, so a circle is drawn as an ellipse
with half as many rows as columns, and every slice carries its own glyph so the chart
is readable without colour. Drawing a circle is worth it for pie because the shape is
the point; where proportion is the point, a stacked bar is the better answer.

### Phase 2 — `packages/charts`, a new `chart` language (bigger, new surface)

Data-driven charts from a small JSON body, for numbers that do not come from Mermaid:

~~~chart
{ "type": "bar", "title": "Revenue by month",
  "labels": ["Jul", "Aug", "Sep", "Oct"],
  "series": [{ "name": "Closed",   "values": [1180, 1320, 1460, 1580] },
             { "name": "Forecast", "values": [1200, 1400, 1500, 1700] }] }
~~~

```
packages/charts/
  package.json          mirrors packages/merman/package.json
  src/plugin.ts         Plugin.define({ id: "opencode.charts", setup }) -> registerCodeBlockRenderer("chart", ...)
  src/markdown.ts       createChartCodeBlockRenderer(renderer, () => ({ colors }))
  src/spec/             parse.ts (JSON -> model), validate.ts (typed errors with offsets)
  src/families/         bar/ line/ sparkline/ heatmap/ pie/  each parser + drawing + render-grid + style
  src/palette.ts        thin reuse of @opencode/merman/palette
  src/test/             frame snapshots
  script/layout-audit.ts
```

Types for phase 2: `bar`, `line`, `area`, `sparkline`, `heatmap`, `pie`, `donut`.
Every type is a function of a validated model to a grid, so each one is testable alone.

### Phase 0 — the shared enabler both phases need

`packages/merman/src/core` is already a general terminal drawing kit: canvas, drawing
primitives, geometry, grid-to-styled-text, tests. Extract it:

```
packages/diagram-core/     (name open for discussion)
  src/canvas.ts  drawing.ts  geometry.ts  render-grid.ts  color/
```

`packages/merman` then imports it, and `packages/charts` reuses it. This is the part
that genuinely "expands OpenCode": after it lands, a new renderer is a parser plus a
drawing function, not a new rendering stack. If maintainers would rather not split
the package in the same wave, phase 2 can import `@opencode/merman/core/*` by adding
one export to merman's `exports` map — less clean, zero risk.

## 6. Architecture

```mermaid
flowchart TB
  F["```chart fence<br/>JSON body"] --> P["spec/parse + validate<br/>pure, typed errors"]
  M["```mermaid fence<br/>pie / xychart"] --> MP["family parser<br/>pure"]
  P --> MOD["chart model"]
  MP --> MOD2["diagram model"]
  MOD --> D["drawing.ts<br/>model to cell grid"]
  MOD2 --> D
  D --> C["diagram-core canvas<br/>braille + block glyphs"]
  C --> G["render-grid.ts<br/>grid to StyledText"]
  G --> R["one TextRenderable<br/>width 100%, explicit height"]
  R --> TUI["chat transcript"]
  PAL["@opencode/merman/palette<br/>theme tokens"] --> D
```

Layering rule for review: nothing above `render-grid.ts` may import `@opentui/core`.
Everything below the canvas is pure data in, pure data out.

## 7. Testing

- Unit tests beside sources, `bun test`, in the merman style: parser tests over
  Mermaid/JSON text, drawing tests over the produced grid as plain strings.
- Frame snapshots: `@opentui/core/testing` exposes `createTestRenderer({ width, height })`,
  `renderOnce()` and `captureCharFrame()`. Render a fence body, assert the frame. This
  is how a renderer gets tested end to end without a human terminal.
- A layout audit script in the shape of merman's `audit:layouts`: render every family
  at widths 40, 80, 120 and fail on overflow, ragged rows or a row count that changes
  with no input change.
- One property worth asserting directly: no frame line exceeds the requested width,
  and no renderer emits an empty frame instead of returning "not handled".

## 8. Failure contract

- Unparseable body or unknown type: return no renderable, so the caller falls back to
  raw source. Never render a half chart.
- Streaming: a fence that is still arriving is almost always unparseable JSON; the
  same fallback covers it. The rendered block replaces the source on the next pass.
- Width: clip to the panel width and say so in the code, rather than emitting lines
  that wrap and destroy the grid.
- No silent colour loss: if a terminal cannot show the chosen glyphs, the chart must
  still be readable by glyph, which is why slices carry distinct characters.

## 9. Rejected approaches, with reasons

| Option | Verdict |
|---|---|
| Claim the `mermaid` language from a plugin | No. The registry throws on duplicates, and config plugins register before built-ins, so claiming it disables the built-in rather than extending it. |
| `beautiful-mermaid` as the engine | Renders 6 families (flowchart, sequence, state, class, ER, xychart). It rejects gantt, git graph and timeline, which the TUI draws today. Swapping loses three to gain three, and it brings `elkjs` plus `entities` into the tree. |
| `simple-ascii-chart` | Useful for data charts from numbers, irrelevant to Mermaid. Rejected for phase 1 to avoid a dependency; its axis drawing is a useful reference for `xychart`. |
| Python `termaid` (18 families) | Richest coverage found anywhere, but a fenced-code renderer must return synchronously, so it needs a background render plus cached lines, and a Python dependency. Wrong architecture for core. |
| Per-line `TextRenderable` grid | Works, but fights the layout pass and needs pre-sizing. The built-in merman pattern (one styled grid renderable) is better and is what reviewers will expect. |

## 10. PR plan

Two pull requests, smallest first.

**PR 1 — `feat(merman): render pie and xychart diagrams`**
- Files: `packages/merman/src/{pie,xychart}/*`, two keywords in `detect.ts`, tests.
- Review risks: glyph choice for slices, aspect handling, value labels on narrow
  panels. Address each in the description with a rendered frame.

**PR 2 — `feat(charts): a chart language for the TUI`** (after PR 1, or after
diagram-core lands)
- Files: `packages/charts/*`, one entry in the TUI plugin list, tests, audit script.
- Review risks: whether a new frozen language is welcome at all, and whether the spec
  belongs in `chart` or in an existing surface. Ask first.

Both PRs carry: a rendered before/after frame per family, the exact commands run
(`bun test`, `tsgo --noEmit`, the audit script), and a note that no third-party code
was vendored, so there is nothing new to license.

## 11. Open questions for maintainers

1. Is a second chart-oriented language acceptable, or should data charts be folded
   into `mermaid` via `xychart` only?
2. Should `core` move to a shared package, or stay inside merman with extra exports?
3. Pie glyph policy: distinct glyph per slice (readable without colour) or colour
   fills only (prettier, unreadable on a monochrome terminal)?
4. Is there an appetite for the remaining families — mindmap, quadrant, kanban,
   treemap, packet, block — as text summaries, in the way gantt and timeline already
   degrade gracefully?

## 12. Definition of done for phase 1

- A `pie` fence and an `xychart` fence render as diagrams in the TUI.
- `bun test` passes with parser and drawing tests for both, and frames are asserted.
- No new runtime dependency in `packages/merman`.
- The six families that render today still render identically.
