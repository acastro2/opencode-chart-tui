// Text as a terminal sees it: grapheme clusters and display cells.
//
// The library draws into a character grid, so every measurement has to be in
// terminal cells. A code point is not a cell: CJK and emoji take two, combining
// marks take none, and an emoji sequence is several code points in one cell.
// `Intl.Segmenter` gives the grapheme clusters; `graphemeWidth` gives the cells.
//
// Why a separate module: every family, the axis, the legend and the note footer
// measure text. One implementation keeps them from disagreeing.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The grapheme clusters of a string. Never splits a surrogate pair. */
export function graphemes(text) {
  return [...segmenter.segment(String(text ?? ""))].map((part) => part.segment);
}

/** Code points, for callers that really do want them. Not a width. */
export function codePoints(text) {
  return [...String(text ?? "")];
}

/**
 * East Asian Wide and Fullwidth ranges. Ambiguous characters stay one cell:
 * that is what a terminal with a Latin font does, and guessing the other way
 * makes every label drift in the common case.
 */
function inRange(value, start, end) {
  return value >= start && value <= end;
}

function isCjkBmp(codePoint) {
  return (
    inRange(codePoint, 0x2e80, 0x303e) ||
    inRange(codePoint, 0x3041, 0x33ff) ||
    inRange(codePoint, 0x3400, 0x4dbf) ||
    inRange(codePoint, 0x4e00, 0x9fff) ||
    inRange(codePoint, 0xa000, 0xa4cf) ||
    inRange(codePoint, 0xf900, 0xfaff) ||
    inRange(codePoint, 0xfe10, 0xfe19) ||
    inRange(codePoint, 0xfe30, 0xfe6f)
  );
}

function isCjkSupplementary(codePoint) {
  return (
    inRange(codePoint, 0x1b000, 0x1b2ff) ||
    inRange(codePoint, 0x1f200, 0x1f2ff) ||
    inRange(codePoint, 0x20000, 0x3fffd)
  );
}

function isHangul(codePoint) {
  return (
    inRange(codePoint, 0x1100, 0x115f) ||
    inRange(codePoint, 0xa960, 0xa97f) ||
    inRange(codePoint, 0xac00, 0xd7a3)
  );
}

function isFullwidth(codePoint) {
  return inRange(codePoint, 0xff00, 0xff60) || inRange(codePoint, 0xffe0, 0xffe6);
}

function isWide(codePoint) {
  return (
    isCjkBmp(codePoint) ||
    isCjkSupplementary(codePoint) ||
    isHangul(codePoint) ||
    isFullwidth(codePoint) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a
  );
}

/**
 * The width of one grapheme cluster in terminal cells: 0, 1 or 2.
 *
 * Emoji are two cells when they have an emoji presentation, a VS16 selector, a
 * regional-indicator pair, or a ZWJ sequence of pictographs. A text-default
 * symbol such as a lone © stays one cell, which matches the terminal.
 */
function isControl(codePoint) {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0);
}

function isZeroWidth(codePoint) {
  return codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d || codePoint === 0xfeff;
}

function onlyMarks(text) {
  return [...text].every(
    (part) => /^\p{M}$/u.test(part) || part === "\ufe0e" || part === "\ufe0f",
  );
}

function isEmoji(text) {
  return (
    /\p{Emoji_Presentation}/u.test(text) ||
    text.includes("\ufe0f") ||
    /\p{Regional_Indicator}/u.test(text) ||
    (text.includes("\u200d") && /\p{Extended_Pictographic}/u.test(text)) ||
    text.includes("\u20e3")
  );
}

export function graphemeWidth(grapheme) {
  const text = String(grapheme ?? "");
  if (text === "") return 0;
  const first = text.codePointAt(0);
  if (isControl(first) || isZeroWidth(first) || onlyMarks(text)) return 0;
  if (isEmoji(text)) return 2;
  return isWide(first) ? 2 : 1;
}

/** The display width of a string, in terminal cells. */
export function displayWidth(text) {
  let width = 0;
  for (const grapheme of graphemes(text)) width += graphemeWidth(grapheme);
  return width;
}

/** The longest prefix of `text` that fits in `width` cells. */
export function sliceByWidth(text, width) {
  const limit = Math.max(0, Math.floor(width));
  let out = "";
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const cells = graphemeWidth(grapheme);
    if (used + cells > limit) break;
    out += grapheme;
    used += cells;
  }
  return out;
}

/** Cut to a width in cells, with an ellipsis when it does not fit. */
export function truncateByWidth(text, width, ellipsis = "…") {
  const limit = Math.max(0, Math.floor(width));
  const value = String(text ?? "");
  if (limit === 0) return "";
  if (displayWidth(value) <= limit) return value;
  const tail = displayWidth(ellipsis) <= limit ? ellipsis : "";
  const body = sliceByWidth(value, Math.max(0, limit - displayWidth(tail)));
  // If the ellipsis leaves no room for a wide glyph, keep the glyph instead.
  // "漢" says more than "…" in a two-cell label.
  if (body === "" && sliceByWidth(value, limit) !== "") return sliceByWidth(value, limit);
  return body + tail;
}

/** Pad to a width in cells. */
export function padByWidth(text, width) {
  const value = String(text ?? "");
  const pad = Math.max(0, Math.floor(width) - displayWidth(value));
  return value + " ".repeat(pad);
}

/** Pad with spaces on the left, so numbers line up under each other. */
export function padStartByWidth(text, width) {
  const value = String(text ?? "");
  const pad = Math.max(0, Math.floor(width) - displayWidth(value));
  return " ".repeat(pad) + value;
}

/**
 * Greedy word wrap in display cells. A word longer than the line is broken
 * rather than dropped, and a blank line in the input stays a blank line.
 */
/** A word wider than one line, cut into line-sized pieces. The remainder is last. */
function hardBreak(word, limit) {
  const pieces = [];
  let rest = word;
  while (displayWidth(rest) > limit) {
    const piece = sliceByWidth(rest, limit);
    if (piece === "") break;
    pieces.push(piece);
    rest = rest.slice(piece.length);
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

/** True when `line` can take `word` after one space. */
function fitsOn(line, word, limit) {
  return line !== "" && displayWidth(line) + 1 + displayWidth(word) <= limit;
}

/** One paragraph: fill lines, hard-breaking any word wider than the line. */
function wrapParagraph(paragraph, limit) {
  const lines = [];
  let line = "";
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (displayWidth(word) > limit) {
      if (line !== "") lines.push(line);
      const pieces = hardBreak(word, limit);
      line = pieces.pop() ?? "";
      lines.push(...pieces);
    } else if (line === "") line = word;
    else if (fitsOn(line, word, limit)) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export function wrapByWidth(text, width) {
  const limit = Math.max(1, Math.floor(width));
  return String(text ?? "")
    .split("\n")
    .flatMap((paragraph) => wrapParagraph(paragraph, limit));
}
