# Working notes for whoever picks this up next

This file is for the *next agent* (or the next me): how to change this repo
without breaking it, and the traps that cost hours the first time.

## Start here

Read [`docs/HANDOFF.md`](docs/HANDOFF.md) before anything else. It holds the
current state, the gate numbers, the five seams, the plugin load path and the
open limits. Then:

- **Update `docs/HANDOFF.md` at every milestone or direction change**, not at
  "session end". Current state, next actions, blockers. Write it for a session
  with zero memory: pointers to paths and commands, not copied content.
- **Decisions go in `docs/adr/`**, with a pointer from the handoff. The three
  accepted ones are the value contract (0001), the corpus and run goldens
  (0002) and the row ledger (0003).
- `README.md` says what the library is. `GLOSSARY.md` fixes the words. Read this
  file before editing, and keep the traps below.

---

## 1. The shape of the thing

```
tui.js              the OpenCode plugin half: the custom ChartRenderable
index.js            the server half: a default { id, setup } definition
src/chart.js        dispatcher, tolerant fence parser, note footer
src/values.js       one value fate per family (ADR-0001)
src/layout.js       row ledger, width measurement, clipping (ADR-0003)
src/text.js         grapheme display width, slice, pad, wrap
src/core.js         cells, runs, the sub-cell sampler, wrapping, colour mixes
src/theme.js        dark/light palettes, muted tones, styleOf(run) -> colours
src/mosaic.js       quadrant / sextant / octant glyph tables
src/axis.js         nice bounds, the box-model axis, label rows
src/<family>.js     one module per chart family (23 registered types)
test/*.test.js      one suite per family plus core/parse/theme/chart/layout/values/schema
scripts/corpus.mjs  SAMPLES + VARIANTS + EDGE_SPECS: read by every gate
scripts/            audit, fidelity, golden, perf, schema, dump, images, gallery
```

Two rules hold the design together. Break either and the repo gets worse:

1. **Every family renders from a grid of cells.** `renderChartRows(spec)`
   returns `[{ width, runs }]` where a run is `{ text, slice, kind, color? }`.
   `renderChart(spec)` is the same layout as text. Never compute geometry twice.
2. **A run's colour comes from its `kind`.** `theme.js` decides every colour, so
   the library never hardcodes a theme anywhere else. A new kind needs a branch
   in `styleOf` and in the plugin's expectations, or it silently falls through.

## 2. The commands that matter

Full list and what each gate proves: `docs/HANDOFF.md` §2.

```sh
npm test                    # 503 checks in 26/26 suites, the gate for everything
node test/gantt.test.js     # one suite, prints "N/N checks passed"
npm run audit               # 58/58: width, bounds, data accounting, no crash
npm run fidelity            # 45/45: geometry against a formula
npm run golden              # 954 text + 34 run frames; --update only after review
npm run perf                # 27/27 on large inputs
npm run accuracy            # pie rim: 628.3 ideal, <=0.5% error
crapper src                 # 0 functions at CRAP >= 10 (worst 9.4)
node scripts/dump.mjs 58    # every family as plain text -> review/renders.txt
node scripts/images.mjs 76  # every family as SVG            -> assets/*.svg
```

`review/renders.txt` is how you *look* at a change without a terminal.
`assets/*.svg` is how a human looks at it. Regenerate both when a family's
output changes, or the README gallery starts lying.

## 3. Adding a family (the recipe that worked, 23 times)

1. **Normalize the input in its own exported function** (`normalizeTasks`,
   `normalizeCandles`, `normalizeTree`). Drop rows that cannot be drawn instead
   of guessing; the tests call this function directly.
2. **Compute positions in cells, allocate one grid with `blankGrid(width, height)`.**
3. **Paint with the sampler**, not with ad-hoc loops: `sampler.sample(x, y, classify)`
   for shapes, `tallyFromGrid` + `paintCell` when you have a sub-cell grid.
   This is what gives partial blocks at the edges for free.
4. **Stamp text with `wrapText` + `stampText`**, clipped to the box you reserved.
5. **Only use run kinds that exist:** `fill, edge, line, label, cell, title,
   axis, grid, track, target, legend, legend-mark, spoke, series, outside`.
   Check `styleOf` before inventing one.
6. **Register it** in `CHART_TYPES` (`src/chart.js`) and add a sample to
   `SAMPLES` (`scripts/corpus.mjs`). Every gate, the dump, the images and the
   README gallery read that map, so a family without a sample is invisible.
7. **Add a spec to the smoke test's `specs` map** in `test/chart.test.js`, or the
   suite crashes with `Cannot read properties of undefined (reading 'width')`.
8. **Write the suite** with property checks, not snapshots. The ones that
   actually caught bugs: a label's centre equals its mark's centre; a drawn
   height matches its value within a sub-cell; nothing is drawn outside the
   shape; every row is at most the chart width; every glyph is a real block from
   the expected Unicode ranges; a scalar taken from the layout (`height`,
   `zeroRow`) agrees with the drawing.
9. **Look at it.** Render the dump, then render the SVG to PNG
   (`qlmanage -t -s 1000 -o /tmp/check assets/<type>.svg`) and actually read the
   picture. Every visual defect found so far — chunky rims, bowed radar sides,
   flat treemaps, hidden drop-off — was invisible in the test suite.
10. **Update** `README.md` (intro count, gallery grid, family table, the
    `<details>` fence block) and `skills/opencode-charts/SKILL.md` (add the
    family and one fence), then regenerate the gallery.

## 4. Traps, with the symptom that finds them

**The cell is not square.** A cell is about twice as tall as it is wide. Any
circle drawn without correcting for it is a tall ellipse: the radius used
vertically is half the horizontal one (`radiusY = radiusX / 2`). A "round" test
compares drawn width against height.

**The axis runs through the middle of a row.** A full block on the zero row hangs
half a cell below the line, which reads as "the bar starts under zero". A bar
that rises owns the upper half of the baseline cell, one that falls owns the
lower half, and a bar crossing zero keeps a full block. `bar` and `histogram` do
this; `waterfall` still does not.

**A width check cannot see a missing glyph.** `captureSpans()` proves one cell
per glyph, not that the font draws it. Octants are Unicode 16 (2024); sextants
are Unicode 13 and the default; `"mosaic": "octant"` opts in.

**Property tests do not check geometry.** 137 checks passed while labels sat 19
columns from their bars, the zero row swallowed small values, radar sides bowed
out by 24% and the treemap never nested. Add the position check for any family
that places text next to a mark.

**A zero row is a data row.** Replacing it with the axis line hides every value
smaller than one row. Merge instead (`cells[y][x] ?? axisGlyph`).

**Labels must use the same centring as their marks.** If bars are centred with a
`leftPad`, `categoryRow` needs `slotOffset` and `pointLabelRow` needs explicit
positions. The failure mode looks like "the labels are just wrong". Marks start
at the axis now; do not reintroduce centring a capped layout.

**Squarify lays a strip along the shorter side.** In a wide box that means
columns, never rows. `squarify(items, w, h, true)` forces bands along the width,
and `ROW_LIMIT` stops one band from eating the box (otherwise a three-item group
is three full-height columns).

**The markdown registry is exclusive.** One renderer per language. Config plugins
register *before* the built-ins, so claiming `mermaid` **disables** OpenCode's
own diagram renderer instead of extending it. That is why this library keeps its
own `chart` fence.

**OpenTUI specifics that bit, in order of annoyance:** see `docs/HANDOFF.md` §4.
The short version: a text renderable does not measure itself in the first layout
pass; passing `borderColor`/`borderStyle` flips a border **on**; `StyledText`
needs real chunks (a bare string throws `Packing non-optional field 'text'`);
a local `cli.json` entry must be a **directory** with a `tui.js`.

**Measure in code points, never UTF-16 units.** `text.length`, `str[i]` and
`.slice()` break every astral mosaic glyph. Use `[...text]` and `cols()`.

**A harness that calls `process.exit(0)` kills the user's terminal.** Run
throwaway plugins in a private server, never from `cli.json`:
```sh
mkdir -p ~/.config/opencode/probe   # then write tui.js there
cd ~/.config/opencode
OPENCODE_CLI_CONFIG_CONTENT='{"plugins":["./probe"]}' \
  script -q /tmp/probe-run.txt ~/.opencode/bin/opencode --standalone < /dev/null &
# wait with:  perl -e 'select(undef,undef,undef,0.5)'   (sleep is denied by policy)
pkill -f "opencode --standalone"; rm -rf ~/.config/opencode/probe
```
The probe imports the real plugin, stubs
`markdown.registerCodeBlockRenderer`, renders fences through
`@opentui/core/testing` and reports `width mismatches` per frame. Any change to
`tui.js` deserves that run before you claim it works.

**The installed plugin is a cached copy, not this checkout.** OpenCode clones
`acastro2/opencode-chart-tui` into `~/.cache/opencode/npm/git-opencode-chart-tui-*/`.
It loads `index.js` from the package root and `tui.js` through the `./tui`
export — a package whose root is not a plugin definition fails with
`Plugin must export a default definition`. Editing this checkout changes nothing
until you push and run `opencode plugin update`; `plugin add` alone reuses the
cache, so delete the cache directory to force a clean install. For a live loop
use a discovery symlink under `~/.config/opencode/plugins/`, never a symlink from
the cache: a plugin update writes through it into this repo.

**Releases.** Tag a pushed commit (`git tag -a vX.Y.Z -m "…"` then
`git push origin vX.Y.Z`) and `gh release create vX.Y.Z`. Installers pin with
`#vX.Y.Z`; git installs display the resolved ref in the plugin list — the tag for
a pinned spec, the branch's commit sha while tracking `main`. Pushing needs the
personal account: `gh auth switch -u acastro2` before, back to
`AlexandreCastro_attain` after, or GitHub returns a 403 naming the work account.

## 5. Verification discipline (what "done" means here)

- `npm test` green, and the new behaviour covered by a check that fails without
  the fix.
- `npm run audit`, `fidelity`, `golden` and `perf` green together, not one at a
  time: a change can pass the suite and still move a picture.
- The plain-text dump regenerated and read.
- The SVG regenerated and *looked at* as a PNG for anything shape-related.
- The private probe run for plugin or library changes, with `width mismatches 0`
  (it skips on Node 24 — say so rather than claiming a live frame).
- What you could not verify is stated as such. Never describe a picture you have
  not seen; say "the colours are right in the data, I have not looked at a light
  terminal" instead.

Ask a fresh reviewer (the `ask-claude` subagent works well) to read the source
and the renders and try to break it. Its first review found ten real defects, one
wrong claim, and the most valuable finding of all: the test suite's blind spot.

## 6. Where the truth lives

| question | file |
|---|---|
| what it is, how to install, the family table | `README.md` |
| current state, gates, seams, plugin load path, limits | `docs/HANDOFF.md` |
| the fence contract, one example per family | `skills/opencode-charts/SKILL.md` |
| every key, described, checked against the source | `schema/chart.schema.json` |
| what the output looks like right now | `review/renders.txt` |
| how the drawing works, with pictures | `review/anatomy.html` |
| the words, and the decisions | `GLOSSARY.md`, `docs/adr/` |

## 7. Open threads

- **`hbar` at `width: 16` emits rows wider than the chart** (pre-existing; the
  TUI clips it, the library does not). Fix the width rule, then add the case to
  the audit corpus.
- **`waterfall` still paints a full block over its zero row**, so it disagrees
  with the baseline rule `bar` now follows.
- **No dependency arrows on the gantt.** Mermaid's gantt has none either; a
  terminal elbow connector would add noise. Wanted only if a user asks.
- **The light theme has never been seen by eye**, only verified in the data and
  in the SVG gallery.
- **Octant fonts are unverified beyond one machine.** The safe default is
  sextant; consider detecting support instead of guessing.
- **Mermaid's other families** (gitgraph, timeline, mindmap, quadrant,
  requirements, C4, packet, block, architecture) need an upstream change in
  OpenCode, not a plugin — see the limits section of the README.
- **`dump.mjs` and `images.mjs` read `corpus.mjs`.** Keep it canonical: if a
  family's sample changes, both the pictures and the renders change with it,
  which is the point.
