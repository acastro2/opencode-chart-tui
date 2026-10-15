# References: how to actually render in this terminal

Companion to `SPEC.md`. Everything here is verified — installed, read from the
source, or reproduced in the TUI.

## 1. The skill that already exists

OpenTUI ships an official AI agent skill that contains its **whole documentation tree**
(110 files). It is installed and live in OpenCode:

```
~/.agents/skills/opentui/SKILL.md          index, routing table
~/.agents/skills/opentui/docs/**/*.mdx     the canonical docs
```

Install or update:

```sh
npx skills add https://opentui.com --skill opentui -g   # add -g for global
npx skills update                                        # move to the newest release
```

The version tracked is the one the skill came from (currently around OpenTUI 0.6.6;
the docs site at https://opentui.com/docs lists the same tree). Inside the OpenTUI repo
the same files live at `packages/web/src/content/docs/**/*.mdx`.

The one thing that did not install is the PromptScript target — it refuses global
skill installs. Everything else (OpenCode, Claude Code, and 18 more) got it.

## 2. Docs that matter for a renderer, in the order to read them

| Need | Page |
|---|---|
| Write a renderable that measures and draws itself | `docs/extend/custom-renderables.mdx` |
| Test a frame without a terminal | `docs/core-concepts/testing.mdx` |
| Cell widths, wide characters, wrapping, alignment | `docs/core-concepts/text-and-cells.mdx` |
| Flexbox sizing, rounding, parent constraints | `docs/core-concepts/layout.mdx` |
| The renderable tree, adding nodes, ownership | `docs/core-concepts/renderables.mdx` |
| Colours, themes, what a terminal can show | `docs/core-concepts/colors.mdx`, `docs/reference/terminal-capabilities.mdx` |
| Built-in components to reuse before writing your own | `docs/components/overview.mdx` then `docs/components/<name>.mdx` |
| Plugin slots and registries (host extension) | `docs/plugins/slots.mdx` |
| Rendering diagnostics, "why is my frame wrong" | `docs/test-and-debug/rendering-diagnostics.mdx` |

Also worth knowing, because the OpenCode TUI is built on these:
`docs/components/text-table.mdx`, `code.mdx`, `markdown.mdx`, `scrollbox.mdx`,
`ascii-font.mdx`, and the API index at `docs/reference/api-index.mdx`.

## 3. The recipe for a renderer like a chart

This is the part we got wrong the first time. Do **not** stack `TextRenderable` rows
and fight the layout pass with hard-coded heights. Write one custom renderable that
owns its own cells:

```ts
import { RGBA, Renderable, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core"
import { MeasureMode } from "@opentui/core/yoga"

export class ChartRenderable extends Renderable {
  static override readonly nativeIntegration = this.defineNativeIntegration({
    kind: "custom", body: "host", construction: "prototype",
  })

  constructor(ctx: RenderContext, options: ChartRenderableOptions) {
    super(ctx, options)
    this.setMeasureProvider((width, widthMode) => ({
      width: widthMode === MeasureMode.Exactly ? width : Math.min(width, this._columns),
      height: this._rows,
    }))
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const x = this.buffered ? 0 : this.screenX
    const y = this.buffered ? 0 : this.screenY
    // draw your grid: one cell at a time, or row by row with buffer.drawText
  }
}
```

Rules the docs state, which explain every layout bug we hit:

- `setMeasureProvider()` is the answer to "my content has an intrinsic size". Return
  intrinsic width and height in terminal cells; do not clamp to the given mode, Yoga
  applies constraints. A measured node cannot also be a layout container with children.
- When content changes: `invalidateIntrinsicSize()` then `requestRender()`. Either one
  alone does not do it.
- `renderBefore` / `renderSelf()` / `renderAfter` **record** drawing, they do not paint
  immediately, unless the node is buffered. Hence the `buffered ? 0 : screenX` idiom.
- Subclass `Renderable` (not `BaseRenderable`) for anything visual — only `Renderable`
  creates a scene node, so only it gets layout, paint order and hit testing.
- Read layout with `getLayout()` / `screenX` / `screenY` / `width` / `height`.
  `getLayoutNode()` and `yogaNode` are gone.

## 4. Testing without a terminal

```ts
import { createTestRenderer } from "@opentui/core/testing"

const setup = await createTestRenderer({ width: 40, height: 10 })
try {
  setup.renderer.root.add(new ChartRenderable(setup.renderer, { spec }))
  await setup.renderOnce()
  console.log(setup.captureCharFrame())
} finally {
  setup.renderer.destroy()
}
```

- `createTestRenderer` builds a real `CliRenderer` whose native Session encodes frames
  into an in-memory sink, so nothing is written to the host terminal.
- `captureCharFrame()` for text and snapshots, `captureSpans()` for styled spans and
  cursor position, `waitForFrame(predicate)` when rendering is scheduled
  asynchronously, `waitForVisualIdle()` to wait for quiet.
- Always `destroy()` in a `finally`.
- Documented strategy, which matches how we already work: test parsers and pure logic
  with no renderer at all, then use the test renderer for frames and cell updates, then
  test destruction and repeated cleanup.

**Caveat that bit us:** the runtime must have the native library. Node 24 cannot render
frames at all (`OpenTUI native FFI is not available for this runtime yet`). Run these
under bun (the TUI process is bun 1.4.2) or node >= 26.4.

## 5. Worked examples, best first

| Source | What to learn from it |
|---|---|
| `packages/merman/src/` in `anomalyco/opencode` | A complete production renderer: `plugin.ts` (15 lines), `markdown.ts` (grid to `StyledText` in one `TextRenderable` subclass), and a directory per family with `parser.ts`, `drawing.ts`, `render-grid.ts`, `style.ts`, plus `core/{canvas,drawing,geometry,render-grid,spatial,text,text-lines}.ts`. Tests sit beside sources. |
| `packages/tui/src/component/`, `packages/tui/src/feature-plugins/`, `packages/tui/src/plugin/` | How the OpenCode TUI itself is composed, and what a feature plugin looks like. |
| `~/.cache/opencode/npm/opencode-quick-quote@latest/*/node_modules/opencode-quick-quote/dist/tui.js` | A real third-party TUI plugin on this machine: `Plugin.define`, slots, keymap, storage, and the text sizing pattern (`width: "100%", height: 1, wrapMode: "none", truncate: true, flexShrink: 0`). |
| `packages/storybook/` in `anomalyco/opencode` | Component gallery for the TUI. |
| OpenTUI example browser | `curl -fsSL https://raw.githubusercontent.com/anomalyco/opentui/main/packages/examples/install.sh | sh` — runs examples without cloning. |
| `.opencode/skills/opencode-dev/SKILL.md` in `anomalyco/opencode` | OpenCode's own guide for working in that repo, which is what a PR has to satisfy. |

## 6. Hard-won gotchas, with the fix

| Symptom | Cause | Fix |
|---|---|---|
| A border appears around every box | `initializeBorder()` turns the border ON when `borderColor` or `borderStyle` is passed | Only pass those keys when a border is wanted |
| Text paints over a neighbour's border, boxes collapse | A `TextRenderable` does not measure in the first layout pass | Custom renderable with `setMeasureProvider`, or explicit `width`/`height: 1` plus `wrapMode: "none"`, `truncate`, `flexShrink: 0` |
| Rows of buttons spread across the panel | Row children stretch equally by default | Pre-size the ones with a natural width, or pack them |
| A chart line wraps and the grid breaks | No width budget | Clip to the panel width before drawing; never emit a line wider than the panel |
| Plugin loads but nothing appears | `cli.json` plugin entries must be **directories** with `tui.js` / `tui.ts` | A bare file path is silently ignored |
| Every start of the TUI dies | A harness plugin called `process.exit(0)` and was left wired in `cli.json` | Run harness plugins through `OPENCODE_CLI_CONFIG_CONTENT` in a private `--standalone` run, never in `cli.json` |
| A renderer silently disables the built-in one | The markdown registry is exclusive and throws on duplicates | Claim a new language, never an existing one |

## 7. Reading order for anyone building the next renderer

1. `docs/extend/custom-renderables.mdx` — measure, paint, ownership.
2. `docs/core-concepts/testing.mdx` — prove a frame without a terminal.
3. `docs/core-concepts/text-and-cells.mdx` — cells, wide characters, wrapping.
4. `packages/merman/src/markdown.ts` and one family directory — a working example.
5. `packages/merman/src/core/` — reusable canvas and grid helpers.
6. `docs/core-concepts/rendering-diagnostics.mdx` — when a frame is wrong.
7. `docs/plugins/slots.mdx` — only if the work is a host extension rather than a block renderer.
