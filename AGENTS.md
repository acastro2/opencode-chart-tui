# Working notes for whoever picks this up next

This file is for the *next agent* (or the next me): what this repo is, how to
change it without breaking it, and the traps that cost hours the first time.
Written after building the first 23 families, so it is all learned the hard way.

Read `README.md` for what the library *is*. Read this before editing it.

---

## 1. The shape of the thing

```
tui.js              the OpenCode plugin: reads a ```chart fence, parses it,
                    picks a theme, turns runs into OpenTUI text chunks
src/chart.js        the dispatcher + the tolerant fence parser + the note footer
src/core.js         cells, runs, the sub-cell sampler, wrapping, colour mixes
src/theme.js        dark/light palettes, muted tones, styleOf(run) -> colours
src/mosaic.js       quadrant / sextant / octant glyph tables
src/axis.js         nice bounds, the box-model axis, label rows
src/<family>.js     one module per chart family (23 of them)
test/*.test.js      one suite per family plus core/parse/theme/chart
scripts/            dump.mjs (plain-text renders), images.mjs (SVG gallery),
                    samples.mjs (one canonical fence per family), accuracy.mjs
```

Two rules hold the design together. Break either and the repo gets worse:

1. **Every family renders from a grid of cells.** `renderChartRows(spec)`
   returns `[{ width, runs }]` where a run is `{ text, slice, kind, color? }`.
   `renderChart(spec)` is the same layout as text. Never compute geometry twice.
2. **A run's colour comes from its `kind`.** `style.js`/`theme.js` decide every
   colour, so the library never hardcodes a theme. A new kind needs a branch in
   `styleOf` *and* in the plugin's expectations, or it silently falls through.

## 2. The commands that matter

```sh
npm test                    # 173 checks across 16 suites, the gate for everything
node test/gantt.test.js     # one suite, prints "N/N checks passed"
node scripts/dump.mjs 58    # every family as plain text -> review/renders.txt
node scripts/images.mjs 76  # every family as SVG            -> assets/*.svg
npm run accuracy            # sub-cell fidelity of the pie rim (0.0% octant)
```

`review/renders.txt` is how you *look* at a change without a terminal.
`assets/*.svg` is how a human looks at it. Regenerate both when a family's
output changes, or the README gallery starts lying.

## 3. Adding a family (the recipe that worked, eight times)

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
6. **Register it** in `CHART_TYPES` (`src/chart.js`) and add an entry to
   `SAMPLES` (`scripts/samples.mjs`) — the dump, the images and the README
   gallery all read that map, so a family without a sample is invisible.
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
    `<details>` fence block) and `skills/opencode-charts/SKILL.md`.

## 4. Traps, with the symptom that finds them

**The cell is not square.** A cell is about twice as tall as it is wide. Any
circle drawn without correcting for it is a tall ellipse: the radius used
vertically is half the horizontal one (`radiusY = radiusX / 2`). A "round" test
compares drawn width against height.

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
positions. The failure mode looks like "the labels are just wrong".

**Squarify lays a strip along the shorter side.** In a wide box that means
columns, never rows. `squarify(items, w, h, true)` forces bands along the width,
and `ROW_LIMIT` stops one band from eating the box (otherwise a three-item group
is three full-height columns).

**The markdown registry is exclusive.** One renderer per language. Config plugins
register *before* the built-ins, so claiming `mermaid` **disables** OpenCode's
own diagram renderer instead of extending it. That is why this library keeps its
own `chart` fence.

**OpenTUI specifics that bit, in order of annoyance:**
- Text renderables do not measure themselves in the first layout pass. Give every
  row an explicit `width`/`height: 1`/`wrapMode: "none"`/`flexShrink: 0`.
- Passing `borderColor` or `borderStyle` flips `_border` **on**; omit them when no
  border is wanted.
- `StyledText` needs real chunks. A bare string in the chunk array throws
  `Packing non-optional field 'text' at index N but value is undefined`.
  Build one with `{ __isChunk: true, text, attributes: 0 }` then `bg`/`fg`/`bold`.
- A local plugin entry in `cli.json` must be a **directory** with a `tui.js`;
  a bare path to a file is ignored silently.

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

**Development is live, the plugin is not.** `~/.config/opencode/plugins/opencode-chart-tui`
is a symlink to this repo, which is how OpenCode discovers the plugin at all (a
discovery directory holding `tui.js` needs no config entry). `src/*.js` edits
appear at the next render; a change to `tui.js` needs the TUI restarted.

## 5. Verification discipline (what "done" means here)

- `npm test` green, and the new behaviour covered by a check that fails without
  the fix.
- The plain-text dump regenerated and read.
- The SVG regenerated and *looked at* as a PNG for anything shape-related.
- The private probe run for plugin or library changes, with `width mismatches 0`.
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
| the fence contract, one example per family | `skills/opencode-charts/SKILL.md` |
| every key, described, with examples | `schema/chart.schema.json` |
| what the output looks like right now | `review/renders.txt` |
| how the drawing works, with pictures | `review/anatomy.html` |
| the OpenTUI and OpenCode plugin facts | `REFERENCES.md` |
| the original brief | `SPEC.md` |

## 7. Open threads

- **No dependency arrows on the gantt.** Mermaid's gantt has none either; a
  terminal elbow connector would add noise. Wanted only if a user asks.
- **Width is measured once per render.** A resize does not re-render, and the
  fence's own `width` wins over the pane.
- **The light theme has never been seen by eye**, only verified in the data and
  in the probe's frames.
- **Octant fonts are unverified beyond one machine.** The safe default is
  sextant; consider detecting support instead of guessing.
- **Mermaid's other families** (gitgraph, timeline, mindmap, quadrant,
  requirements, C4, packet, block, architecture) need an upstream change in
  OpenCode, not a plugin — see the limits section of the README.
- **`scripts/dump.mjs` and `images.mjs` share `samples.mjs`.** Keep it canonical:
  if a family's sample changes, both the pictures and the renders change with it,
  which is the point.
