// Mosaic glyph tables: which sub-cells of one character cell are filled.
//
// A terminal cell holds several sub-cells of shape, so a curve drawn with mosaic
// characters is finer than one whole cell per step. Three levels exist:
//
//   quadrant  2 x 2 sub-cells   U+2596..U+259F and half blocks, universal
//   sextant   2 x 3 sub-cells   U+1FB00..U+1FB3B, Unicode 13.0
//   octant    2 x 4 sub-cells   U+1CD00..U+1CDE5, Unicode 16.0
//
// Sub-cell numbering is row-major, two columns wide: bit 0 is the upper-left,
// bit 1 the upper-right, and so on down the cell. That order is not a guess. The
// Unicode annotations call BLOCK SEXTANT-12 the upper third block and
// BLOCK SEXTANT-34 the middle third, which fixes the pairs. For octants the same
// order is confirmed by the existing characters the octant block does not
// repeat: bits 0x50 are the lower-left quadrant, 0xAA the right half, 0xFC the
// lower three quarters, 0x03 the upper one quarter.
//
// Sources: Unicode Character Database (UnicodeData.txt and NamesList.txt) for
// every codepoint, and the published octant bit tables for the layouts the
// mosaic blocks leave to other blocks.
//
// A mosaic block never repeats a pattern another block already draws, so those
// patterns are listed here explicitly rather than left missing.

const QUADRANT = { columns: 2, rows: 2, glyphs: new Map([
  [0, " "],
  [1, "▘"],
  [2, "▝"],
  [3, "▀"],
  [4, "▖"],
  [5, "▌"],
  [6, "▞"],
  [7, "▛"],
  [8, "▗"],
  [9, "▚"],
  [10, "▐"],
  [11, "▜"],
  [12, "▄"],
  [13, "▙"],
  [14, "▟"],
  [15, "█"],
]) }

const SEXTANT = { columns: 2, rows: 3, glyphs: new Map([
  [1, "🬀"],
  [2, "🬁"],
  [3, "🬂"],
  [4, "🬃"],
  [5, "🬄"],
  [6, "🬅"],
  [7, "🬆"],
  [8, "🬇"],
  [9, "🬈"],
  [10, "🬉"],
  [11, "🬊"],
  [12, "🬋"],
  [13, "🬌"],
  [14, "🬍"],
  [15, "🬎"],
  [16, "🬏"],
  [17, "🬐"],
  [18, "🬑"],
  [19, "🬒"],
  [20, "🬓"],
  [21, "▌"],
  [22, "🬔"],
  [23, "🬕"],
  [24, "🬖"],
  [25, "🬗"],
  [26, "🬘"],
  [27, "🬙"],
  [28, "🬚"],
  [29, "🬛"],
  [30, "🬜"],
  [31, "🬝"],
  [32, "🬞"],
  [33, "🬟"],
  [34, "🬠"],
  [35, "🬡"],
  [36, "🬢"],
  [37, "🬣"],
  [38, "🬤"],
  [39, "🬥"],
  [40, "🬦"],
  [41, "🬧"],
  [42, "▐"],
  [43, "🬨"],
  [44, "🬩"],
  [45, "🬪"],
  [46, "🬫"],
  [47, "🬬"],
  [48, "🬭"],
  [49, "🬮"],
  [50, "🬯"],
  [51, "🬰"],
  [52, "🬱"],
  [53, "🬲"],
  [54, "🬳"],
  [55, "🬴"],
  [56, "🬵"],
  [57, "🬶"],
  [58, "🬷"],
  [59, "🬸"],
  [60, "🬹"],
  [61, "🬺"],
  [62, "🬻"],
  [63, "█"],
]) }

const OCTANT = { columns: 2, rows: 4, glyphs: new Map([
  [1, "𜺨"],
  [2, "𜺫"],
  [3, "🮂"],
  [4, "𜴀"],
  [5, "▘"],
  [6, "𜴁"],
  [7, "𜴂"],
  [8, "𜴃"],
  [9, "𜴄"],
  [10, "▝"],
  [11, "𜴅"],
  [12, "𜴆"],
  [13, "𜴇"],
  [14, "𜴈"],
  [15, "▀"],
  [16, "𜴉"],
  [17, "𜴊"],
  [18, "𜴋"],
  [19, "𜴌"],
  [20, "🯦"],
  [21, "𜴍"],
  [22, "𜴎"],
  [23, "𜴏"],
  [24, "𜴐"],
  [25, "𜴑"],
  [26, "𜴒"],
  [27, "𜴓"],
  [28, "𜴔"],
  [29, "𜴕"],
  [30, "𜴖"],
  [31, "𜴗"],
  [32, "𜴘"],
  [33, "𜴙"],
  [34, "𜴚"],
  [35, "𜴛"],
  [36, "𜴜"],
  [37, "𜴝"],
  [38, "𜴞"],
  [39, "𜴟"],
  [40, "🯧"],
  [41, "𜴠"],
  [42, "𜴡"],
  [43, "𜴢"],
  [44, "𜴣"],
  [45, "𜴤"],
  [46, "𜴥"],
  [47, "𜴦"],
  [48, "𜴧"],
  [49, "𜴨"],
  [50, "𜴩"],
  [51, "𜴪"],
  [52, "𜴫"],
  [53, "𜴬"],
  [54, "𜴭"],
  [55, "𜴮"],
  [56, "𜴯"],
  [57, "𜴰"],
  [58, "𜴱"],
  [59, "𜴲"],
  [60, "𜴳"],
  [61, "𜴴"],
  [62, "𜴵"],
  [63, "🮅"],
  [64, "𜺣"],
  [65, "𜴶"],
  [66, "𜴷"],
  [67, "𜴸"],
  [68, "𜴹"],
  [69, "𜴺"],
  [70, "𜴻"],
  [71, "𜴼"],
  [72, "𜴽"],
  [73, "𜴾"],
  [74, "𜴿"],
  [75, "𜵀"],
  [76, "𜵁"],
  [77, "𜵂"],
  [78, "𜵃"],
  [79, "𜵄"],
  [80, "▖"],
  [81, "𜵅"],
  [82, "𜵆"],
  [83, "𜵇"],
  [84, "𜵈"],
  [85, "▌"],
  [86, "𜵉"],
  [87, "𜵊"],
  [88, "𜵋"],
  [89, "𜵌"],
  [90, "▞"],
  [91, "𜵍"],
  [92, "𜵎"],
  [93, "𜵏"],
  [94, "𜵐"],
  [95, "▛"],
  [96, "𜵑"],
  [97, "𜵒"],
  [98, "𜵓"],
  [99, "𜵔"],
  [100, "𜵕"],
  [101, "𜵖"],
  [102, "𜵗"],
  [103, "𜵘"],
  [104, "𜵙"],
  [105, "𜵚"],
  [106, "𜵛"],
  [107, "𜵜"],
  [108, "𜵝"],
  [109, "𜵞"],
  [110, "𜵟"],
  [111, "𜵠"],
  [112, "𜵡"],
  [113, "𜵢"],
  [114, "𜵣"],
  [115, "𜵤"],
  [116, "𜵥"],
  [117, "𜵦"],
  [118, "𜵧"],
  [119, "𜵨"],
  [120, "𜵩"],
  [121, "𜵪"],
  [122, "𜵫"],
  [123, "𜵬"],
  [124, "𜵭"],
  [125, "𜵮"],
  [126, "𜵯"],
  [127, "𜵰"],
  [128, "𜺠"],
  [129, "𜵱"],
  [130, "𜵲"],
  [131, "𜵳"],
  [132, "𜵴"],
  [133, "𜵵"],
  [134, "𜵶"],
  [135, "𜵷"],
  [136, "𜵸"],
  [137, "𜵹"],
  [138, "𜵺"],
  [139, "𜵻"],
  [140, "𜵼"],
  [141, "𜵽"],
  [142, "𜵾"],
  [143, "𜵿"],
  [144, "𜶀"],
  [145, "𜶁"],
  [146, "𜶂"],
  [147, "𜶃"],
  [148, "𜶄"],
  [149, "𜶅"],
  [150, "𜶆"],
  [151, "𜶇"],
  [152, "𜶈"],
  [153, "𜶉"],
  [154, "𜶊"],
  [155, "𜶋"],
  [156, "𜶌"],
  [157, "𜶍"],
  [158, "𜶎"],
  [159, "𜶏"],
  [160, "▗"],
  [161, "𜶐"],
  [162, "𜶑"],
  [163, "𜶒"],
  [164, "𜶓"],
  [165, "▚"],
  [166, "𜶔"],
  [167, "𜶕"],
  [168, "𜶖"],
  [169, "𜶗"],
  [170, "▐"],
  [171, "𜶘"],
  [172, "𜶙"],
  [173, "𜶚"],
  [174, "𜶛"],
  [175, "▜"],
  [176, "𜶜"],
  [177, "𜶝"],
  [178, "𜶞"],
  [179, "𜶟"],
  [180, "𜶠"],
  [181, "𜶡"],
  [182, "𜶢"],
  [183, "𜶣"],
  [184, "𜶤"],
  [185, "𜶥"],
  [186, "𜶦"],
  [187, "𜶧"],
  [188, "𜶨"],
  [189, "𜶩"],
  [190, "𜶪"],
  [191, "𜶫"],
  [192, "▂"],
  [193, "𜶬"],
  [194, "𜶭"],
  [195, "𜶮"],
  [196, "𜶯"],
  [197, "𜶰"],
  [198, "𜶱"],
  [199, "𜶲"],
  [200, "𜶳"],
  [201, "𜶴"],
  [202, "𜶵"],
  [203, "𜶶"],
  [204, "𜶷"],
  [205, "𜶸"],
  [206, "𜶹"],
  [207, "𜶺"],
  [208, "𜶻"],
  [209, "𜶼"],
  [210, "𜶽"],
  [211, "𜶾"],
  [212, "𜶿"],
  [213, "𜷀"],
  [214, "𜷁"],
  [215, "𜷂"],
  [216, "𜷃"],
  [217, "𜷄"],
  [218, "𜷅"],
  [219, "𜷆"],
  [220, "𜷇"],
  [221, "𜷈"],
  [222, "𜷉"],
  [223, "𜷊"],
  [224, "𜷋"],
  [225, "𜷌"],
  [226, "𜷍"],
  [227, "𜷎"],
  [228, "𜷏"],
  [229, "𜷐"],
  [230, "𜷑"],
  [231, "𜷒"],
  [232, "𜷓"],
  [233, "𜷔"],
  [234, "𜷕"],
  [235, "𜷖"],
  [236, "𜷗"],
  [237, "𜷘"],
  [238, "𜷙"],
  [239, "𜷚"],
  [240, "▄"],
  [241, "𜷛"],
  [242, "𜷜"],
  [243, "𜷝"],
  [244, "𜷞"],
  [245, "▙"],
  [246, "𜷟"],
  [247, "𜷠"],
  [248, "𜷡"],
  [249, "𜷢"],
  [250, "▟"],
  [251, "𜷣"],
  [252, "▆"],
  [253, "𜷤"],
  [254, "𜷥"],
  [255, "█"],
]) }


/** Finest first: an unusual pattern still degrades to a coarser mode. */
const ORDER = ["octant", "sextant", "quadrant"]

export const MODES = { quadrant: QUADRANT, sextant: SEXTANT, octant: OCTANT }

export const FILL = "█"

function fullMask(mode) {
  return (1 << (mode.columns * mode.rows)) - 1
}

/**
 * Resample a mask into a coarser mode covering the same region. A coarse
 * sub-cell is filled when at least half of the fine sub-cells it covers are
 * filled, so the shape keeps its weight instead of growing.
 */
function resample(mask, from, to) {
  const ratio = from.rows / to.rows
  let out = 0
  for (let column = 0; column < to.columns; column++) {
    for (let row = 0; row < to.rows; row++) {
      let weight = 0
      let filled = 0
      const first = (row * from.rows) / to.rows
      const last = ((row + 1) * from.rows) / to.rows
      for (let sourceRow = Math.floor(first); sourceRow < Math.ceil(last); sourceRow++) {
        const overlap = Math.min(last, sourceRow + 1) - Math.max(first, sourceRow)
        if (overlap <= 0) continue
        weight += overlap
        if (mask & (1 << (sourceRow * from.columns + column))) filled += overlap
      }
      if (filled * 2 >= weight) out |= 1 << (row * to.columns + column)
    }
  }
  return out
}

function resolve(mask, level) {
  const mode = MODES[ORDER[level]]
  if (mask === 0) return " "
  if (mode.glyphs.has(mask)) return mode.glyphs.get(mask)
  if (level + 1 < ORDER.length) return resolve(resample(mask, mode, MODES[ORDER[level + 1]]), level + 1)
  return FILL
}

// One flat lookup per mode, so rendering never walks the fallback chain.
const LOOKUPS = {}
for (const [name, mode] of Object.entries(MODES)) {
  const table = new Array(fullMask(mode) + 1)
  const start = ORDER.indexOf(name)
  for (let mask = 0; mask <= fullMask(mode); mask++) table[mask] = resolve(mask, start)
  LOOKUPS[name] = table
}

/** The character for a mask of filled sub-cells. */
export function glyphFor(mask, mode = "quadrant") {
  const table = LOOKUPS[mode]
  if (!table) throw new Error(`unknown mosaic mode: ${mode}`)
  return table[mask] ?? " "
}

/** How a mode splits a cell: columns by rows of sub-cells. */
export function modeShape(mode = "quadrant") {
  const selected = MODES[mode]
  if (!selected) throw new Error(`unknown mosaic mode: ${mode}`)
  return { columns: selected.columns, rows: selected.rows }
}

/** True when this mode has a native glyph for every non-empty pattern. */
export function isComplete(mode = "quadrant") {
  const entry = MODES[mode]
  if (!entry) return false
  // Checked per mask rather than by table size: a mode is complete when no mask
  // needs the fallback chain, whatever its map happens to store for the blank.
  for (let mask = 1; mask <= fullMask(entry); mask++) {
    if (!entry.glyphs.has(mask) || entry.glyphs.get(mask) === " ") return false
  }
  return true
}

export function availableModes() {
  return ORDER
}
