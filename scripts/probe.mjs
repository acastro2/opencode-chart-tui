// TUI probe: render the real ChartRenderable into OpenTUI's test renderer and
// prove the frame fits, then resize and prove it re-renders.
//
// OpenTUI's native FFI needs bun or Node >= 26.4. On Node 24 this script prints a
// skip and exits 0, because the library's pure tests do not need a terminal. The
// standalone OpenCode probe in the repo notes is the same idea against the live
// TUI process.
//
//   bun scripts/probe.mjs
//   node scripts/probe.mjs   # skips on Node 24

import { displayWidth } from "../src/text.js";

async function main() {
  let createTestRenderer;
  let ChartRenderable;
  let themeOf;
  let paletteOf;

  try {
    ({ createTestRenderer } = await import("@opentui/core/testing"));
    ({ ChartRenderable } = await import("../tui.js"));
    ({ themeOf, paletteOf } = await import("../src/chart.js"));
  } catch (error) {
    console.log(`probe: SKIP (OpenTUI is not installed here: ${error.message})`);
    return;
  }

  let setup;
  try {
    setup = await createTestRenderer({ width: 56, height: 20 });
    const spec = { type: "bar", title: "Probe", labels: ["A", "B", "C"], values: [3, 5, 2] };
    const theme = themeOf({});
    const node = new ChartRenderable(setup.renderer, {
      spec,
      theme,
      palette: paletteOf(spec),
    });
    setup.renderer.root.add(node);
    await setup.renderOnce();

    let frame = setup.captureCharFrame().split("\n");
    let bad = frame.filter((line) => displayWidth(line) > 56);
    if (bad.length > 0) throw new Error(`56-column frame has ${bad.length} over-wide rows`);

    await setup.resize(40, 20);
    await setup.renderOnce();
    frame = setup.captureCharFrame().split("\n");
    bad = frame.filter((line) => displayWidth(line) > 40);
    if (bad.length > 0) throw new Error(`40-column frame has ${bad.length} over-wide rows`);

    console.log("probe: OK (56 -> 40 columns, no over-wide rows)");
  } catch (error) {
    if (/native FFI|OpenTUI native/i.test(String(error?.message ?? error))) {
      console.log(`probe: SKIP (${error.message})`);
      return;
    }
    throw error;
  } finally {
    setup?.renderer?.destroy();
  }
}

await main();
