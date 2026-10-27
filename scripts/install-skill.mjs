// Install the `opencode-charts` skill where agents look for skills.
//
//   npm run skill:install            # symlink to this checkout (stays live)
//   npm run skill:install -- --copy  # copy, for a packaged install
//   npm run skill:install -- --force # replace a real directory
//
// Why: the skill lives in this repo under `skills/`, and a repo is not a skill
// directory. Until it is linked into `~/.agents/skills` (or the OpenCode skills
// directory) no session can see it, so the fence never gets used. A symlink is
// the default because edits to SKILL.md then apply to the next session without
// reinstalling.

import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "..", "skills", "opencode-charts");
const args = new Set(process.argv.slice(2));
const copy = args.has("--copy");
const force = args.has("--force");

if (!existsSync(join(source, "SKILL.md"))) {
  console.error(`skill:install: no SKILL.md at ${source}`);
  process.exit(1);
}

// `~/.agents/skills` is the portable location; the OpenCode skills directory is
// used too when it exists, because some setups only scan that one.
const targets = [join(homedir(), ".agents", "skills")];
for (const name of ["skills", "skill"]) {
  const dir = join(homedir(), ".config", "opencode", name);
  if (existsSync(dir)) targets.push(dir);
}

let installed = 0;
let skipped = 0;
for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "opencode-charts");
  const stat = lstatSync(dest, { throwIfNoEntry: false });

  if (stat && !stat.isSymbolicLink() && !force) {
    console.log(`skip ${dest}: a real directory is already there (use --force to replace it)`);
    skipped += 1;
    continue;
  }
  if (stat) rmSync(dest, { recursive: true, force: true });

  if (copy) cpSync(source, dest, { recursive: true });
  else symlinkSync(source, dest, "dir");

  if (!existsSync(join(dest, "SKILL.md"))) {
    console.error(`skill:install: ${dest} has no SKILL.md after install`);
    process.exitCode = 1;
    continue;
  }
  console.log(`${copy ? "copied" : "linked"} ${dest}`);
  installed += 1;
}

console.log(
  installed > 0
    ? `skill: ${installed} install${installed === 1 ? "" : "s"}. Skills load at session start, so restart the agent.`
    : "skill: nothing installed.",
);
if (skipped > 0) console.log(`skill: ${skipped} skipped.`);
