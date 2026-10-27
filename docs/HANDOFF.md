# Handoff

Read this first, before the code. It is the state a fresh session cannot
rediscover on its own: what is true now, how to work here, where the seams are,
and what is still open. Update it at every milestone or direction change, not at
"session end" — sessions get abandoned mid-flight.

`README.md` says what the library is. `AGENTS.md` holds the traps. `GLOSSARY.md`
fixes the words. Decisions live in `docs/adr/`; this file only points at them.

## 1. Current state

A dependency-free ES-module library that draws 23 chart families from a ```chart
fence, plus the OpenCode TUI plugin that renders it. Nothing is an image: every
family returns `{ width, runs }` rows, and plain text is those rows concatenated.

```
fence JSON -> src/chart.js (parse, coerce, fit height, note footer)
           -> src/<family>.js (a grid of cells with styled runs)
           -> rows -> renderChart() as text, or tui.js as buffer cells
```

Gates, measured on this tree (2026-10-27, Node 24.22.1):

| gate | command | result |
|---|---|---|
| unit and property | `npm test` | 503 checks, 26/26 suites |
| data, width, height | `npm run audit` | 58/58 |
| geometry vs reference | `npm run fidelity` | 45/45 |
| pictures | `npm run golden` | 954 text frames + 34 run frames |
| large inputs | `npm run perf` | 27/27 under budget |
| pie area | `npm run accuracy` | 628.3 ideal, −0.5 / −0.3 / −0.1% |
| complexity | `crapper src` | 0 functions at CRAP ≥ 10 (worst 9.4) |

## 2. How to work

```sh
npm test                 # every suite; the gate for everything
node test/<family>.test.js   # one suite, prints "N/N checks passed"
npm run audit            # corpus invariants: width, bounds, data accounting
npm run fidelity         # shape math checked against a formula, not a renderer
npm run golden           # compare text frames and styled run frames
npm run golden:update    # only after reading the diff and looking at a render
npm run perf             # timing on large inputs
npm run accuracy         # pie area and rim metrics
node scripts/dump.mjs 58        # every family as plain text -> review/renders.txt
node scripts/images.mjs 76      # every family as SVG -> assets/
npm run gallery                 # review/gallery.html, dark
```

Rules that keep the gates honest:

- **Never run `golden:update` blind.** A changed frame is a picture change.
  Render it, read it, and only then accept the diff.
- **CRAP:** target CC ≤ 5. CRAP = CC²(1−cov)³ + CC, so a CC 10 function can
  never score below 10 at any coverage, and CC 9 needs 77% coverage to pass.
  Split it or test it; do not add a test to a branchy function and hope.
- **Byte-identical refactors:** pin the old behaviour with a characterization
  test first. The goldens are the backstop, not the proof.

## 3. The five seams

After the CRAP campaign the functions were small but the modules were still
shallow: the same policy was copied into every family. These five modules are
the fix. Read the ADR before changing one.

| seam | lives in | what it owns |
|---|---|---|
| Value contract | `src/values.js` | One fate per value kind per family: `ZERO`, `HOLE`, `DROP`. The drawing and the footer read the same tally. **ADR-0001.** |
| Row ledger | `layout.js` → `layoutFor`, `plotRows` | `height` is total rows; `plotHeight` is the plot. A family declares chrome; it does not subtract. **ADR-0003.** |
| Corpus | `scripts/corpus.mjs` (`SAMPLES`, `VARIANTS`, `EDGE_SPECS`) | One spec list for every gate. Goldens compare text **and** runs (`kind`, `slice`, `fg`, `bg`). **ADR-0002.** |
| Schema contract | `scripts/schema.mjs` | Scans `src/*.js` and `tui.js` for `spec.<key>`, compares that set with the schema, and checks aliases and enums. `node scripts/schema.mjs --check`. |
| Pass-throughs | all of `src/` | A helper must add a decision, not forward an argument. The JSON reader, pie re-exports and histogram's fake spec were folded back for this reason. |

Words: fence, family, spec, row, run, frame, chrome, row budget, fate, corpus,
sample, variant. See `GLOSSARY.md`.

## 4. The plugin half

`index.js` is the server half: a default `{ id, setup }` definition. `./tui` in
`package.json` exports `tui.js`, which registers the `chart` code-block renderer
and owns one `ChartRenderable`.

- **The installed plugin is a cached copy.** OpenCode clones the GitHub repo into
  `~/.cache/opencode/npm/git-opencode-chart-tui-*/`. Editing this checkout does
  nothing until you push and run `opencode plugin update`; `plugin add` alone
  reuses the cache. To force a clean install, delete that cache directory.
- **Live loop:** symlink a directory under `~/.config/opencode/plugins/` to this
  checkout. `src/*.js` edits appear at the next render; a `tui.js` edit needs the
  TUI restarted. Never point the cache at the checkout — a plugin update writes
  into it.
  **This machine is currently in that state:** the cache entry
  `~/.cache/opencode/npm/git-opencode-chart-tui-*/…/node_modules/opencode-charts`
  is a symlink to this checkout, with the original saved beside it as
  `opencode-charts.bak`. Restore it before `opencode plugin update` or a release:
  `rm opencode-charts && mv opencode-charts.bak opencode-charts`.
- **Cell aspect** is measured from the renderer's pixel resolution and terminal
  size, so a disc is round without configuration. A fence `cellAspect` wins over
  the measurement; the measurement wins over the default of 2.
- **Resize** is debounced 250 ms and ignores a change smaller than 2 cells. A
  pasted image or a scrollbar used to shrink the pane for one frame, and the
  chart redrew small and back. The timer is cleared in `destroy()`.
- **The measure provider returns one extra row**, so consecutive fences do not
  touch: without it the next chart's title sits on the previous chart's axis.
- **A render failure becomes one row.** `drawRows` catches it and prints
  `chart: <reason>`; it runs inside the measure callback, outside the plugin's
  own `try`, so throwing there would escape into the TUI layout.
- Width: the pane, capped at 110 for grid families (`treemap`, `kanban`, `table`,
  `heatmap`) and 160 for the rest. A fence `width` wins, clipped to the pane.

OpenTUI facts that still hold: a `TextRenderable` does not measure itself in the
first layout pass (use explicit `width`/`height: 1`/`wrapMode: "none"`/
`flexShrink: 0`, or one custom renderable); passing `borderColor`/`borderStyle`
turns a border **on**; `StyledText` needs real chunks; the markdown registry is
exclusive, so this library keeps its own `chart` fence; measure in code points
with `[...text]` and `cols()`, never UTF-16 units.

The OpenTUI documentation ships as the `opentui` AI skill
(`npx skills add https://opentui.com --skill opentui -g`); when installed it
lives at `~/.agents/skills/opentui/` (index plus `docs/**/*.mdx`). It is **not**
installed on this machine, so treat the pages as a reference, not a local file.
The pages that matter for a renderer: `extend/custom-renderables`,
`core-concepts/testing`, `text-and-cells`, `layout`, and
`test-and-debug/rendering-diagnostics`. The worked example is
`packages/merman/src/` in the `anomalyco/opencode` repo: one styled grid
renderable, a directory per family, core canvas helpers, tests beside sources.

## 5. Open limits, stated plainly

- **`npm run probe:tui` skips on this machine.** OpenTUI's native FFI needs bun
  or Node ≥ 26.4; this machine has Node 24 and no bun. The TUI half is proven by
  `node --check` plus a stub harness, not by a live frame.
- **Octant font coverage is an assumption.** Sextants (Unicode 13) are the
  default; octants are Unicode 16 (2024) and opt-in.
- **The light theme is checked in SVG**, not on a physical light terminal.
- **Three deferred nits:** a second pass can spend one plot row on a note that
  turns out empty; the kanban note lands on the rule row at `height: 2`;
  `width: 0.5` counts as pinned in the plugin but unpinned in `measureWidth`.
- **Two known shape defects, both pre-existing:** `hbar` at `width: 16` emits
  25-cell rows (`clipWidth` hides it in the TUI); `waterfall` still paints a full
  block over its `0┼` row, which is the "bar starts under zero" look that `bar`
  fixed with an upper/lower half block.
- **No dependency arrows on the gantt.** Mermaid's gantt has none either; a
  terminal elbow connector would add noise. Wanted only if a user asks.

## 6. The original brief

The OpenCode terminal drew six Mermaid families and dropped the rest to raw
source. Charts had no path at all, and a pie is the thing a person types into a
chat. So: a pure function from a parsed model to a cell grid, testable without a
terminal; a `chart` fence with a JSON body, because claiming `mermaid` would
disable the built-in renderer rather than extend it; no third-party runtime
dependency; and every family readable by glyph, not only by colour. The upstream
PR plan (pie and xychart into merman, then a charts package) was never sent; this
repo is the standalone plugin that proved the drawing first.
