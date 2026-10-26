import assert from "node:assert/strict";
import {
  displayWidth,
  graphemeWidth,
  graphemes,
  padByWidth,
  padStartByWidth,
  sliceByWidth,
  truncateByWidth,
  wrapByWidth,
} from "../src/text.js";

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
};

check("a control character and an empty cluster have no width", () => {
  assert.equal(graphemeWidth(""), 0);
  assert.equal(graphemeWidth("\u0007"), 0);
  assert.equal(graphemeWidth("\u200b"), 0);
  assert.equal(graphemeWidth("\u0301"), 0, "a lone combining mark belongs to the previous cell");
});

check("a plain character is one cell", () => {
  assert.equal(graphemeWidth("a"), 1);
  assert.equal(graphemeWidth("α"), 1, "ambiguous width stays narrow");
});

check("a text-default symbol stays one cell; its emoji form is two", () => {
  assert.equal(graphemeWidth("©"), 1);
  assert.equal(graphemeWidth("©️"), 2, "VS16 selects the emoji presentation");
});

check("CJK and Hangul are two cells", () => {
  assert.equal(graphemeWidth("漢"), 2);
  assert.equal(graphemeWidth("한"), 2);
  assert.equal(graphemeWidth("Ａ"), 2, "a fullwidth Latin letter");
  assert.equal(graphemeWidth("𠀀"), 2, "a supplementary CJK glyph");
  assert.equal(graphemeWidth("ﾊ"), 1, "halfwidth Katakana is narrow");
});

check("emoji presentations, flags and keycaps are two cells", () => {
  assert.equal(graphemeWidth("😀"), 2);
  assert.equal(graphemeWidth("🇺🇸"), 2);
  assert.equal(graphemeWidth("1️⃣"), 2);
  assert.equal(graphemeWidth("👨‍👩‍👧"), 2);
});

check("a cluster is measured once", () => {
  assert.equal(graphemes("a\u0301").length, 1);
  assert.equal(graphemeWidth("a\u0301"), 1);
  assert.equal(displayWidth("a漢😀"), 5);
});

check("slice and truncate never split a wide glyph", () => {
  assert.equal(sliceByWidth("a漢", 2), "a");
  assert.equal(sliceByWidth("漢b", 2), "漢");
  assert.equal(truncateByWidth("abcdef", 4), "abc…");
  assert.equal(truncateByWidth("漢字", 3), "漢…");
  assert.equal(truncateByWidth("漢字", 2), "漢");
});

check("padding counts cells, not code points", () => {
  assert.equal(padByWidth("漢", 3), "漢 ");
  assert.equal(padStartByWidth("漢", 3), " 漢");
  assert.equal(padByWidth("😀", 3), "😀 ");
});

check("word wrap breaks on display cells", () => {
  assert.deepEqual(wrapByWidth("漢字 test", 4), ["漢字", "test"]);
  assert.deepEqual(wrapByWidth("abcdef", 3), ["abc", "def"]);
  assert.deepEqual(wrapByWidth("one two", 7), ["one two"]);
});

check("a word that fits exactly on chunk boundaries keeps its last chunk", () => {
  // Six cells at width three: two chunks, no remainder. The last chunk is the
  // start of the next line, not a dropped piece.
  assert.deepEqual(wrapByWidth("abcdef", 3), ["abc", "def"]);
  assert.deepEqual(wrapByWidth("abcdefgh", 4), ["abcd", "efgh"]);
});

check("an unbreakable word longer than the line fills whole lines", () => {
  assert.deepEqual(wrapByWidth("aa bb", 2), ["aa", "bb"]);
  assert.deepEqual(wrapByWidth("x abcdefgh y", 3), ["x", "abc", "def", "gh", "y"]);
});

check("blank lines survive and the width is at least one cell", () => {
  assert.deepEqual(wrapByWidth("a\n\nb", 5), ["a", "", "b"]);
  assert.deepEqual(wrapByWidth("abc", 0), ["a", "b", "c"]);
});

console.log(`\n${checks}/${checks} checks passed`);
