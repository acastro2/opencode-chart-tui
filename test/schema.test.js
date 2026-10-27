// The fence contract: one schema, one family list, one key list.
//
// The schema is what a reader trusts when the README and the skill disagree, so
// it is checked against the code and not against itself: the type enum must name
// every renderer, every property must explain itself, an alias must say which
// key is canonical, and the key list the checker enforces must not repeat.
//
// A broken copy proves each gate fires; a green run on the real file proves the
// file is the one the code draws.

import assert from "node:assert/strict";
import { CHART_TYPES } from "../src/chart.js";
import {
  ALIAS_KEYS,
  DOCUMENTED_KEYS,
  FRONT_MATTER_KEYS,
  RENAMED_KEYS,
  checkContract,
  contractProblems,
  readSchema,
  readSpecKeys,
} from "../scripts/schema.mjs";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

const schema = readSchema();
const properties = schema.properties;
/** A copy of the schema with one change, so a failure path can be exercised. */
const changed = (mutate) => {
  const copy = structuredClone(schema);
  mutate(copy);
  return copy;
};

check("the type enum is exactly the families the renderer dispatches", () => {
  const declared = [...properties.type.enum].sort();
  const rendered = Object.keys(CHART_TYPES).sort();
  assert.deepEqual(declared, rendered, "the enum and CHART_TYPES name the same families");
  assert.ok(declared.includes("gantt"), "gantt is a family and belongs in the enum");
});

check("every property has a description", () => {
  const undescribed = Object.entries(properties)
    .filter(([, property]) => typeof property.description !== "string" || property.description.trim() === "")
    .map(([key]) => key);
  assert.deepEqual(undescribed, [], "no property is a bare type");
});

check("every alias names its canonical key", () => {
  for (const [alias, canonical] of Object.entries(ALIAS_KEYS)) {
    assert.ok(properties[alias], `${alias} is a property`);
    assert.ok(properties[canonical], `${canonical} is a property`);
    assert.match(properties[alias].description, new RegExp(`\\balias for ${canonical}\\b`), `${alias} names ${canonical}`);
    assert.match(properties[alias].description, /canonical/, `${alias} says which key wins`);
  }

  // A description that claims an alias must be in the map, so a new alias cannot
  // be documented without a canonical key to point at.
  for (const [key, property] of Object.entries(properties)) {
    const found = /alias for (\w+)/.exec(property.description ?? "");
    if (found) assert.equal(ALIAS_KEYS[key], found[1], `${key} declares ${found[1]} as canonical`);
  }
});

check("a renamed key is named by the key that replaced it, and is not a property", () => {
  for (const [old, canonical] of Object.entries(RENAMED_KEYS)) {
    assert.equal(properties[old], undefined, `${old} is a note, not a property`);
    assert.match(properties[canonical].description, new RegExp(`\\b${old}\\b`), `${canonical} names ${old}`);
  }
});

check("the documented key list has no duplicate", () => {
  assert.equal(new Set(DOCUMENTED_KEYS).size, DOCUMENTED_KEYS.length, "every key appears once");
  assert.deepEqual(
    FRONT_MATTER_KEYS.filter((key) => !DOCUMENTED_KEYS.includes(key)),
    [],
    "the front matter is part of the allow-list",
  );
});

check("the schema and the code agree today", () => {
  const { problems, types, keys } = checkContract();
  assert.deepEqual(problems, [], "no drift");
  assert.equal(types, Object.keys(CHART_TYPES).length);
  assert.equal(keys, Object.keys(properties).length);
});

check("a missing family fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    copy.properties.type.enum = copy.properties.type.enum.filter((type) => type !== "gantt");
  }));
  assert.ok(problems.some((problem) => problem.includes('"gantt"')), problems.join("; "));
});

check("a family no renderer answers to fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    copy.properties.type.enum.push("hologram");
  }));
  assert.ok(problems.some((problem) => problem.includes('"hologram"')), problems.join("; "));
});

check("a property outside the allow-list fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    copy.properties.hologram = { type: "boolean", description: "A key nothing reads." };
  }));
  assert.ok(problems.some((problem) => problem.includes("hologram")), problems.join("; "));
});

check("a key the schema forgot fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    delete copy.properties.slices;
  }));
  assert.ok(problems.some((problem) => problem.includes('"slices"')), problems.join("; "));
});

check("an alias that stops naming its canonical key fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    copy.properties.from.description = "Heat map: a colour.";
  }));
  assert.ok(problems.some((problem) => problem.includes('"from"')), problems.join("; "));
});

check("a rename that loses the old key fails the check", () => {
  const problems = contractProblems(changed((copy) => {
    copy.properties.showPercent.description = "Bars: print the share beside each value.";
  }));
  assert.ok(problems.some((problem) => problem.includes('"percent"')), problems.join("; "));
});

check("a key the code reads but the schema omits fails the check", () => {
  // The gate is a check of the code, not of two hand-written lists: this is what
  // catches a family that starts reading a key nobody documented.
  const problems = contractProblems(schema, Object.keys(CHART_TYPES), [...readSpecKeys(), "hologram"]);
  assert.ok(problems.some((problem) => problem.includes('"hologram"')), problems.join("; "));
});

check("a documented key no family reads fails the check", () => {
  const read = readSpecKeys().filter((key) => key !== "slices");
  const problems = contractProblems(schema, Object.keys(CHART_TYPES), read);
  assert.ok(problems.some((problem) => problem.includes('"slices"')), problems.join("; "));
});

console.log(`\n${checks}/${checks} checks passed`);
