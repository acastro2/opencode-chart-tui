// Runs every suite in this directory and reports one total.
//
// Each suite is a standalone script that prints "N/N checks passed" and exits
// non-zero on a failure, so this only has to spawn them and add up.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

let passed = 0;
let suites = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, [join(here, file)], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const total = /(\d+)\/(\d+) checks passed/.exec(output);
  if (result.status === 0 && total) {
    passed += Number(total[1]);
    suites += 1;
    console.log(`  ok  ${file.padEnd(20)} ${total[1].padStart(3)} checks`);
    continue;
  }
  console.log(`  FAIL ${file}`);
  console.log(output.split("\n").slice(-12).join("\n"));
}

console.log(`\n${passed} checks passed in ${suites}/${files.length} suites`);
process.exit(suites === files.length ? 0 : 1);
