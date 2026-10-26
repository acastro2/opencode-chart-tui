// The golden gate: 954 text frames and 34 run frames. The text grid is 690
// family frames across 23 families, 5 widths, 2 themes and 3 mosaic modes, plus
// 264 variant frames for grouped/stacked series, narrow widths and tight
// heights. The run grid is one width (56) and one theme (dark) for every family
// and every variant, and it compares kind, slice, fg and bg as well as text, so
// a colour swap or a kind demotion cannot slip through. A drift is a picture
// change and must be reviewed, not refreshed blind. `npm run golden:update`
// rewrites the files; `npm run golden` checks.
import { checkGoldens, extraGoldenFiles } from "../scripts/golden.mjs";

const result = checkGoldens();
const extra = extraGoldenFiles();

for (const failure of result.failures) console.error(`golden: ${failure}`);
for (const file of extra) console.error(`golden: stale file ${file}`);

if (result.failures.length > 0 || extra.length > 0) {
  console.log(`0/1 checks passed`);
  process.exit(1);
}

console.log(`golden: ${result.checked} text frames match`);
console.log(`golden: ${result.runChecked} run frames match`);
console.log(`1/1 checks passed`);
