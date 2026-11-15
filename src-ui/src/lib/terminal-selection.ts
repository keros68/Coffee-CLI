import type { IBuffer, IBufferCell, IBufferLine, Terminal } from '@xterm/xterm';

/**
 * Scrollbar glyphs commonly drawn at the rightmost terminal column by TUIs
 * (Pi, Kimi Code, OpenCode, Ratatui, Bubbletea, less, etc.).
 */
const SCROLLBAR_TRACK_CHARS = new Set([
  '│', '┃', '║', '┆', '┇', '┊', '┋', '╹', '╻', '╵', '╷',
]);

const SCROLLBAR_THUMB_CHARS = new Set([
  '█', '▓', '▒', '░', '▌', '▐', '▎', '▏', '▍', '▋', '▊', '▉',
]);

const SCROLLBAR_CHARS = new Set([...SCROLLBAR_TRACK_CHARS, ...SCROLLBAR_THUMB_CHARS]);

/** Transient floating scroll-jump pills overlaid by TUIs over scrolled content. */
const FLOATING_PILL_RE =
  /^(?:[│╭╮╰╯┌┐└┘┃║\s]*)?[↓↑⬇⬆]\s*(?:jump\s+to\s+(?:latest|bottom|end|top|newest|oldest)(?:\s+messages?)?|scroll\s+to\s+(?:bottom|latest|end)(?:\s+messages?)?|new\s+messages?)(?:\s*[·•|—-]\s*(?:ctrl\+end|end|pgdn|esc|[a-z0-9+]+))?(?:[\s│╭╮╰╯┌┐└┘┃║]*)$/i;

const FLOATING_PILL_ALT_RE =
  /^[╭┌].*?(?:jump\s+to\s+latest|ctrl\+end|scroll\s+to\s+bottom).*?[╮┐]$|^(?:[│┃]?\s*)?(?:jump\s+to\s+latest(?:\s+message)?\s*[·•]\s*ctrl\+end)(?:\s*[│┃]?)$/i;

const NO_SPACE_CJK_RE = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_PUNCT_RE = /[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65、。！？；：（）【】《》「」『』“”‘’—…·]/;
const BORDER_ONLY_RE = /^[\s─━═\-=~┌┐└┘├┤┬┴┼╭╮╰╯│┃║┆┇┊┋+]+$/;
const MARKDOWN_HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const LIST_ITEM_RE = /^\s*(?:[-*+•◦▪▸▹‣]|(?:\d{1,4})[.)])\s+/;
const BLOCKQUOTE_OR_RAIL_RE = /^\s*(?:>|│|┃|║)/;
const PROMPT_OR_TOOL_START_RE = /^\s*(?:[⏺●◆◇❯›>$%#⚠✓✔✕✖✗→←▶▼])\s+\S|^\s*(?:❯|›)\s*$/;
const CODE_FENCE_RE = /^\s*(?:```|~~~)/;
const LINE_NUMBER_PREFIX_RE = /^\s*\d+\s*[│|]\s/;
const TABLE_ROW_RE = /^\s*[│┃║|].*[│┃║|]\s*$|^\|.+\|/;
const TIMESTAMP_OR_LOG_RE = /^(?:\d{4}-\d{2}-\d{2}[T\s]|\[\d{2}:\d{2}|[0-9a-f]{7,}\s+\S)/i;

export interface ExtractedRow {
  cols: number;
  chars: string[];
  widths: number[];
  edgeCharAtLastCol: string;
  edgePrevChar: string;
  hasScrollbar: boolean;
  contentStartCol: number;
  contentEndCol: number;
  rawTrimmed: string;
  trimmedText: string;
  normText: string;
  isWrapped: boolean;
  hasFloatingPill: boolean;
}

export interface SelectionSlice {
  row: ExtractedRow;
  startCol: number;
  endCol: number;
}

export interface SelectionPoint {
  vRow: number;
  col: number;
}

export interface ScrollShiftResult {
  shift: number;
  bandTop: number;
  bandBottom: number;
}

export interface TerminalSelectionController {
  hasSelection: () => boolean;
  getSelectionText: () => string;
  onWriteParsed: () => void;
  onBufferChange: () => void;
  onResize: (cols: number, rows: number) => void;
  onUserInput: (data: string) => void;
  onWheelBeforeForward: (rawNotches: number, inAltScreen: boolean, deltaY: number) => number;
  runInternalScroll: <T>(fn: () => T) => T;
  clear: () => void;
  dispose: () => void;
}

export interface TerminalSelectionControllerOptions {
  term: Terminal;
  scrollAltScreen: (direction: -1 | 1, lines: number) => void;
}

interface XtermSelectionModelLike {
  selectionStart?: [number, number];
  selectionEnd?: [number, number];
  selectionStartLength: number;
  isSelectAllActive?: boolean;
  readonly finalSelectionStart?: [number, number];
  readonly finalSelectionEnd?: [number, number];
  areSelectionValuesReversed?: () => boolean;
}

interface XtermSelectionServiceLike {
  _model?: XtermSelectionModelLike;
  _activeSelectionMode?: number;
  refresh?: (isLinuxMouseSelection?: boolean) => void;
  clearSelection?: () => void;
  hasSelection?: boolean;
}

interface XtermMouseServiceLike {
  getCoords?: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;
}

interface XtermRenderServiceLike {
  dimensions?: {
    css?: {
      cell?: { width?: number; height?: number };
      canvas?: { width?: number; height?: number };
    };
  };
}

interface XtermCoreLike {
  _selectionService?: XtermSelectionServiceLike;
  _mouseService?: XtermMouseServiceLike;
  _renderService?: XtermRenderServiceLike;
}

function isFloatingPillText(trimmed: string): boolean {
  if (!trimmed || trimmed.length > 72) return false;
  return FLOATING_PILL_RE.test(trimmed) || FLOATING_PILL_ALT_RE.test(trimmed);
}

function finalizeRowMetrics(
  chars: string[],
  widths: number[],
  cols: number,
  edgeCharAtLastCol: string,
  edgePrevChar: string,
  hasScrollbar: boolean,
  isWrapped: boolean,
): ExtractedRow {
  const limitCols = hasScrollbar && cols > 0 ? cols - 1 : cols;
  let contentStartCol = -1;
  let contentEndCol = 0;

  for (let c = 0; c < limitCols; c++) {
    const w = widths[c];
    const ch = chars[c];
    if (w !== 0 && ch !== '' && ch !== ' ') {
      if (contentStartCol === -1) contentStartCol = c;
      contentEndCol = Math.min(limitCols, c + (w === 2 ? 2 : 1));
    }
  }

  if (contentStartCol === -1) {
    contentStartCol = limitCols;
  }

  let rawTrimmed = '';
  for (let c = 0; c < contentEndCol; c++) {
    rawTrimmed += chars[c] || '';
  }

  const trimmedText = rawTrimmed.trimStart();
  const normText = trimmedText.replace(/\s+/g, ' ');

  return {
    cols,
    chars,
    widths,
    edgeCharAtLastCol,
    edgePrevChar,
    hasScrollbar,
    contentStartCol,
    contentEndCol,
    rawTrimmed,
    trimmedText,
    normText,
    isWrapped,
    hasFloatingPill: isFloatingPillText(trimmedText),
  };
}

/**
 * Extracts per-column cell text, widths, and trimmed metrics from a buffer line,
 * eliminating ConPTY trailing `0x20` padding from content bounds.
 */
export function extractBufferRow(
  line: IBufferLine | undefined,
  cols: number,
  reusableCell?: IBufferCell,
): ExtractedRow {
  const safeCols = Math.max(0, cols);
  const chars = new Array<string>(safeCols).fill(' ');
  const widths = new Array<number>(safeCols).fill(1);

  if (!line || safeCols === 0) {
    return finalizeRowMetrics(chars, widths, safeCols, '', ' ', false, false);
  }

  const maxRead = Math.min(line.length, safeCols);
  for (let c = 0; c < maxRead; c++) {
    const cell = reusableCell ? line.getCell(c, reusableCell) : line.getCell(c);
    if (!cell) continue;
    const w = cell.getWidth();
    widths[c] = w;
    if (w === 0) {
      chars[c] = '';
    } else {
      const ch = cell.getChars();
      chars[c] = ch === '' ? ' ' : ch;
    }
  }

  const lastIdx = safeCols - 1;
  const rawLastChar = safeCols > 0 ? (chars[lastIdx] === ' ' ? '' : chars[lastIdx]) : '';
  const prevChar = safeCols >= 2 ? chars[lastIdx - 1] : ' ';
  const rowHasThumbEdge =
    safeCols >= 20 &&
    SCROLLBAR_THUMB_CHARS.has(rawLastChar) &&
    (prevChar === ' ' || prevChar === '');

  return finalizeRowMetrics(
    chars,
    widths,
    safeCols,
    rawLastChar,
    prevChar,
    rowHasThumbEdge,
    Boolean(line.isWrapped),
  );
}

/**
 * Marks the rightmost column as a scrollbar gutter across a set of rows when
 * multiple rows draw TUI scrollbar glyphs at `cols - 1`.
 */
export function applyScrollbarDetection(rows: ExtractedRow[], cols: number): ExtractedRow[] {
  if (cols < 20 || rows.length === 0) return rows;

  let scrollbarHits = 0;
  let nonBlankLastCol = 0;
  let hasThumb = false;

  for (const row of rows) {
    const edge = row.edgeCharAtLastCol;
    if (!edge) continue;
    nonBlankLastCol++;
    if (SCROLLBAR_CHARS.has(edge)) {
      scrollbarHits++;
      if (SCROLLBAR_THUMB_CHARS.has(edge)) hasThumb = true;
    }
  }

  const frameHasScrollbar =
    rows.length >= 3 &&
    scrollbarHits >= 2 &&
    (hasThumb || scrollbarHits >= Math.ceil(nonBlankLastCol * 0.6));

  if (!frameHasScrollbar) return rows;

  return rows.map((row) => {
    if (row.hasScrollbar) return row;
    return finalizeRowMetrics(
      row.chars,
      row.widths,
      row.cols,
      row.edgeCharAtLastCol,
      row.edgePrevChar,
      true,
      row.isWrapped,
    );
  });
}

function rowsEqualForScroll(a: ExtractedRow, b: ExtractedRow): boolean {
  return a.rawTrimmed === b.rawTrimmed;
}

/**
 * Detects whether two consecutive alternate-screen frames represent an upward or
 * downward scroll within a possibly chrome-pinned viewport band `[bandTop, bandBottom)`.
 *
 * Returns `shift > 0` when content moved UP on screen (scrolled down into later lines),
 * `shift < 0` when content moved DOWN on screen (scrolled up into earlier lines),
 * `shift = 0` when the scrollable band remained stationary, or `null` on a full reset.
 */
export function detectScrollShift(
  prevRows: ExtractedRow[],
  currRows: ExtractedRow[],
  expectedDirection: -1 | 0 | 1 = 0,
): ScrollShiftResult | null {
  const rows = Math.min(prevRows.length, currRows.length);
  if (rows === 0) return null;
  if (rows < 4) {
    let same = 0;
    for (let r = 0; r < rows; r++) {
      if (rowsEqualForScroll(prevRows[r], currRows[r])) same++;
    }
    return same >= Math.ceil(rows * 0.5)
      ? { shift: 0, bandTop: 0, bandBottom: rows }
      : null;
  }

  // 1. Check whether virtually the entire viewport stayed unshifted.
  let totalNonBlank = 0;
  let totalExactNonBlank = 0;
  for (let r = 0; r < rows; r++) {
    const a = prevRows[r];
    const b = currRows[r];
    if (a.hasFloatingPill || b.hasFloatingPill) continue;
    if (a.contentEndCol > 0 || b.contentEndCol > 0) {
      totalNonBlank++;
      if (rowsEqualForScroll(a, b)) totalExactNonBlank++;
    }
  }
  if (totalNonBlank > 0 && totalExactNonBlank === totalNonBlank) {
    return { shift: 0, bandTop: 0, bandBottom: rows };
  }
  if (
    expectedDirection === 0 &&
    totalNonBlank >= 3 &&
    totalExactNonBlank >= Math.ceil(totalNonBlank * 0.85)
  ) {
    return { shift: 0, bandTop: 0, bandBottom: rows };
  }

  // 2. Determine contiguous static edge bands (top chrome and bottom chrome).
  // Allow up to 1-2 dynamic status/cursor rows at the extreme bottom when backed
  // immediately above by >= 2 identical static chrome rows (e.g. composer box + live timer).
  let chromeTop = 0;
  const maxTopChrome = Math.floor(rows * 0.4);
  while (
    chromeTop < maxTopChrome &&
    rowsEqualForScroll(prevRows[chromeTop], currRows[chromeTop]) &&
    (prevRows[chromeTop].contentEndCol > 0 || chromeTop > 0)
  ) {
    chromeTop++;
  }

  let chromeBottom = rows;
  const minBottomChrome = Math.ceil(rows * 0.52);
  while (
    chromeBottom - 1 >= minBottomChrome &&
    chromeBottom - 1 > chromeTop + 3 &&
    rowsEqualForScroll(prevRows[chromeBottom - 1], currRows[chromeBottom - 1])
  ) {
    chromeBottom--;
  }

  // Handle a 1-2 line changing timer/status bar sitting at the very bottom row(s)
  // underneath a static bordered prompt box.
  if (chromeBottom === rows && rows >= 8) {
    for (let skipBottom = 1; skipBottom <= 2; skipBottom++) {
      let idx = rows - 1 - skipBottom;
      let staticRun = 0;
      while (
        idx >= minBottomChrome &&
        idx > chromeTop + 3 &&
        rowsEqualForScroll(prevRows[idx], currRows[idx])
      ) {
        if (prevRows[idx].contentEndCol > 0) staticRun++;
        idx--;
      }
      if (staticRun >= 2) {
        chromeBottom = idx + 1;
        break;
      }
    }
  }

  // Re-check top chrome if a static border sits right beneath a 1-row dynamic header clock.
  if (chromeTop === 0 && rows >= 8) {
    const idx = 1;
    let staticRun = 0;
    let probe = idx;
    while (probe < maxTopChrome && rowsEqualForScroll(prevRows[probe], currRows[probe])) {
      if (prevRows[probe].contentEndCol > 0) staticRun++;
      probe++;
    }
    if (staticRun >= 2) {
      chromeTop = probe;
    }
  }

  const bandTop = chromeTop;
  const bandBottom = chromeBottom;
  const bandHeight = bandBottom - bandTop;

  if (bandHeight < 4) {
    return { shift: 0, bandTop: 0, bandBottom: rows };
  }

  let inPlaceNonBlankMatches = 0;
  let inPlaceNonBlankTotal = 0;
  for (let r = bandTop; r < bandBottom; r++) {
    const a = prevRows[r];
    const b = currRows[r];
    if (a.hasFloatingPill || b.hasFloatingPill) continue;
    if (a.contentEndCol > 0 || b.contentEndCol > 0) {
      inPlaceNonBlankTotal++;
      if (rowsEqualForScroll(a, b)) inPlaceNonBlankMatches++;
    }
  }

  if (
    inPlaceNonBlankTotal >= 3 &&
    inPlaceNonBlankMatches >= Math.ceil(inPlaceNonBlankTotal * 0.85) &&
    expectedDirection === 0
  ) {
    return { shift: 0, bandTop, bandBottom };
  }

  // 3. Evaluate candidate non-zero scroll shifts within [bandTop, bandBottom).
  const maxShift = bandHeight - 2;
  let bestDelta = 0;
  let bestScore = -Infinity;
  let bestMatchedNonBlank = 0;
  let bestDistinctMatched = 0;

  for (let delta = -maxShift; delta <= maxShift; delta++) {
    if (delta === 0) continue;

    const currStart = delta > 0 ? bandTop : bandTop - delta;
    const currEnd = delta > 0 ? bandBottom - delta : bandBottom;
    const overlapLen = currEnd - currStart;
    if (overlapLen < 2) continue;

    let matchedNonBlank = 0;
    let matchedBlank = 0;
    let mismatchedNonBlank = 0;
    let overlapNonBlank = 0;
    const distinctMatches = new Set<string>();

    for (let r = currStart; r < currEnd; r++) {
      const currRow = currRows[r];
      const prevRow = prevRows[r + delta];
      if (currRow.hasFloatingPill || prevRow.hasFloatingPill) {
        continue;
      }

      const currHas = currRow.contentEndCol > 0;
      const prevHas = prevRow.contentEndCol > 0;
      if (!currHas && !prevHas) {
        matchedBlank++;
        continue;
      }

      overlapNonBlank++;
      if (currHas && prevHas && rowsEqualForScroll(prevRow, currRow)) {
        matchedNonBlank++;
        distinctMatches.add(currRow.rawTrimmed);
      } else {
        mismatchedNonBlank++;
      }
    }

    if (matchedNonBlank < 2 && !(matchedNonBlank === 1 && overlapNonBlank === 1 && overlapLen >= 4)) {
      continue;
    }

    const matchRatio = matchedNonBlank / Math.max(1, overlapNonBlank);
    if (matchRatio < 0.7) continue;

    // Require distinct line content when there are many identical lines (e.g. "```")
    // unless most of the overlap is non-empty and matches solidly.
    if (distinctMatches.size < 2 && matchedNonBlank < 3 && expectedDirection === 0) {
      continue;
    }

    let score =
      matchedNonBlank * 10 +
      matchedBlank * 0.4 -
      mismatchedNonBlank * 16 -
      Math.abs(delta) * 0.1;

    if (expectedDirection !== 0 && Math.sign(delta) === Math.sign(expectedDirection)) {
      score += 6;
    } else if (expectedDirection !== 0 && Math.sign(delta) !== Math.sign(expectedDirection)) {
      score -= 8;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDelta = delta;
      bestMatchedNonBlank = matchedNonBlank;
      bestDistinctMatched = distinctMatches.size;
    }
  }

  const validShiftFound =
    bestDelta !== 0 &&
    bestScore > 0 &&
    (bestMatchedNonBlank > inPlaceNonBlankMatches ||
      (expectedDirection !== 0 &&
        Math.sign(bestDelta) === Math.sign(expectedDirection) &&
        inPlaceNonBlankMatches <= Math.floor(inPlaceNonBlankTotal * 0.5) &&
        bestDistinctMatched >= 1));

  if (validShiftFound) {
    return { shift: bestDelta, bandTop, bandBottom };
  }

  // No credible non-zero shift found: decide between stationary (partial update) and full reset.
  if (inPlaceNonBlankMatches >= 2 || inPlaceNonBlankTotal === 0) {
    return { shift: 0, bandTop, bandBottom };
  }

  return null;
}

function getStringDisplayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x1f300
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function getLeadingTokenWidth(trimmedText: string): number {
  if (!trimmedText) return 0;
  const firstSpace = trimmedText.search(/\s/);
  const token = firstSpace === -1 ? trimmedText : trimmedText.slice(0, firstSpace);
  if (!token) return 0;
  // For contiguous CJK text without spaces, only the first wide character needs to fit.
  const firstChar = Array.from(token)[0] ?? '';
  if (NO_SPACE_CJK_RE.test(firstChar) || CJK_PUNCT_RE.test(firstChar)) {
    return getStringDisplayWidth(firstChar);
  }
  return getStringDisplayWidth(token);
}

function countLeadingSpaces(text: string): number {
  let count = 0;
  while (count < text.length && text[count] === ' ') count++;
  return count;
}

function trimCommonLeftMargin(
  texts: string[],
  slices: SelectionSlice[],
): { lines: string[]; commonMargin: number } {
  let commonMargin = Infinity;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (text.trim().length === 0) continue;
    const slice = slices[i];
    if (i === 0 && slice.startCol > 0) {
      // Use the full row's contentStartCol so starting right at column 2 on line 0
      // still detects a 2-space TUI gutter across lines 1..N-1.
      commonMargin = Math.min(commonMargin, slice.row.contentStartCol);
    } else if (slice.startCol === 0) {
      commonMargin = Math.min(commonMargin, countLeadingSpaces(text));
    }
  }

  if (!Number.isFinite(commonMargin) || commonMargin <= 0) {
    return { lines: texts, commonMargin: 0 };
  }

  const lines = texts.map((text, i) => {
    if (text.length === 0) return '';
    const slice = slices[i];
    const stripBudget = Math.max(0, commonMargin - slice.startCol);
    if (stripBudget === 0) return text;
    const actualLeading = countLeadingSpaces(text);
    const toRemove = Math.min(actualLeading, stripBudget);
    return text.slice(toRemove);
  });

  return { lines, commonMargin };
}

function looksLikeStructuredOrCodeLine(line: string, dedentedLine: string): boolean {
  if (!dedentedLine) return true;
  if (BORDER_ONLY_RE.test(dedentedLine)) return true;
  if (TABLE_ROW_RE.test(dedentedLine)) return true;
  if (LINE_NUMBER_PREFIX_RE.test(dedentedLine)) return true;
  if (MARKDOWN_HEADING_RE.test(dedentedLine)) return true;
  if (BLOCKQUOTE_OR_RAIL_RE.test(dedentedLine)) return true;
  if (CODE_FENCE_RE.test(dedentedLine)) return true;
  if (TIMESTAMP_OR_LOG_RE.test(dedentedLine)) return true;
  // Multi-space column tables (e.g. `ps` / `ls -l` / columnar alignment)
  if (/\S\s{3,}\S/.test(line.trim())) return true;
  return false;
}

function isUrlOrPathContinuation(prevTrimmed: string, currTrimmed: string): boolean {
  const prevTokens = prevTrimmed.split(/\s+/);
  const lastToken = prevTokens[prevTokens.length - 1] ?? '';
  if (!lastToken) return false;
  const firstCurrToken = currTrimmed.split(/\s+/, 1)[0] ?? '';
  if (!firstCurrToken) return false;

  const isUrl = /^(?:https?|ftp|file):\/\/\S+$/i.test(lastToken) || /^www\.\S+$/i.test(lastToken);
  const isPath = (lastToken.match(/\//g)?.length ?? 0) >= 2 || /^[A-Za-z]:\\/.test(lastToken);
  if (!isUrl && !isPath) return false;

  if (/[/\\=?&#+%:_~-]$/.test(lastToken)) return true;
  if (/[/\\_=?&#+%]/.test(firstCurrToken)) return true;
  return false;
}

function chooseSoftWrapSeparator(
  prevTrimmed: string,
  currTrimmed: string,
  prevEndCol: number,
  wrapCol: number,
): string {
  if (isUrlOrPathContinuation(prevTrimmed, currTrimmed)) {
    return '';
  }

  const prevChars = Array.from(prevTrimmed);
  const currChars = Array.from(currTrimmed);
  const lastChar = prevChars[prevChars.length - 1] ?? '';
  const firstChar = currChars[0] ?? '';

  const lastIsCjk = NO_SPACE_CJK_RE.test(lastChar);
  const firstIsCjk = NO_SPACE_CJK_RE.test(firstChar);
  const lastIsCjkPunct = CJK_PUNCT_RE.test(lastChar);
  const firstIsCjkPunct = CJK_PUNCT_RE.test(firstChar);

  if (lastIsCjk && firstIsCjk) return '';
  if (lastIsCjkPunct || firstIsCjkPunct) return '';
  if ((lastIsCjk && !firstIsCjk) || (!lastIsCjk && firstIsCjk)) {
    // Mixed CJK + ASCII: flush to wrap limit implies no space; early break implies space wrap.
    return prevEndCol >= wrapCol - 1 ? '' : ' ';
  }

  return ' ';
}

function estimateWrapColumn(
  slices: SelectionSlice[],
  dedentedLines: string[],
  cols: number,
  commonMargin: number,
): number {
  const hasAnyScrollbar = slices.some((s) => s.row.hasScrollbar);
  const effectiveCols = Math.max(20, hasAnyScrollbar ? cols - 1 : cols);
  let maxProseEndCol = 0;
  let nearMaxCount = 0;

  const endCols: number[] = [];
  for (let i = 0; i < slices.length; i++) {
    const trimmed = dedentedLines[i].trim();
    if (!trimmed || looksLikeStructuredOrCodeLine(dedentedLines[i], trimmed)) continue;
    const endCol = slices[i].row.contentEndCol;
    endCols.push(endCol);
    if (endCol > maxProseEndCol) maxProseEndCol = endCol;
  }

  for (const ec of endCols) {
    if (maxProseEndCol > 0 && ec >= maxProseEndCol - 5) nearMaxCount++;
  }

  if (maxProseEndCol >= Math.max(40, Math.floor(effectiveCols * 0.6)) && nearMaxCount >= 2) {
    return Math.min(effectiveCols, maxProseEndCol);
  }
  const rightPaddingEstimate = hasAnyScrollbar ? Math.min(commonMargin, 1) : Math.min(commonMargin, 2);
  return Math.max(20, effectiveCols - rightPaddingEstimate);
}

function shouldSoftUnwrap(
  prevSlice: SelectionSlice,
  currSlice: SelectionSlice,
  prevDedented: string,
  currDedented: string,
  wrapCol: number,
  inCodeFence: boolean,
): boolean {
  if (inCodeFence) return false;
  if (currSlice.row.isWrapped) return false;

  const prevTrimmed = prevDedented.trimEnd();
  const currTrimmed = currDedented.trimStart();
  if (!prevTrimmed || !currTrimmed) return false;

  if (looksLikeStructuredOrCodeLine(prevDedented, prevTrimmed.trimStart())) return false;
  if (looksLikeStructuredOrCodeLine(currDedented, currTrimmed)) return false;

  if (LIST_ITEM_RE.test(currTrimmed)) return false;
  if (PROMPT_OR_TOOL_START_RE.test(currTrimmed)) return false;
  if (/[;{}]$/.test(prevTrimmed)) return false;

  // Preserve block separation on different indentation unless curr is a list continuation
  // or slightly indented sub-line <= 3 spaces relative to prev.
  const prevIndent = countLeadingSpaces(prevDedented);
  const currIndent = countLeadingSpaces(currDedented);
  const prevIsList = LIST_ITEM_RE.test(prevTrimmed);
  const prevIsPrompt = PROMPT_OR_TOOL_START_RE.test(prevTrimmed);
  if (currIndent >= 4 && !prevIsList && !prevIsPrompt && currIndent > prevIndent) {
    return false;
  }
  if (!prevIsList && !prevIsPrompt && currIndent !== prevIndent && Math.abs(currIndent - prevIndent) > 2) {
    return false;
  }

  // Must have selected through the actual right end of prevSlice so partial mid-row
  // drags don't glue unrelated fragments together.
  const prevEffectiveLimit = prevSlice.row.hasScrollbar
    ? Math.max(0, prevSlice.row.cols - 1)
    : prevSlice.row.cols;
  if (prevSlice.endCol < prevSlice.row.contentEndCol || currSlice.startCol > currSlice.row.contentStartCol) {
    return false;
  }

  // Check geometric wrap condition: did curr's first word fail to fit on prev?
  const firstTokenWidth = getLeadingTokenWidth(currTrimmed);
  const prevEndCol = Math.min(prevEffectiveLimit, prevSlice.row.contentEndCol);
  const prevEndedCjk =
    NO_SPACE_CJK_RE.test(Array.from(prevTrimmed).pop() ?? '') ||
    CJK_PUNCT_RE.test(Array.from(prevTrimmed).pop() ?? '');
  const currStartsCjk =
    NO_SPACE_CJK_RE.test(Array.from(currTrimmed)[0] ?? '') ||
    CJK_PUNCT_RE.test(Array.from(currTrimmed)[0] ?? '');

  const sepWidth =
    (prevEndedCjk && currStartsCjk) || isUrlOrPathContinuation(prevTrimmed, currTrimmed) ? 0 : 1;
  return prevEndCol + sepWidth + firstTokenWidth > wrapCol;
}

function sliceRowText(
  row: ExtractedRow,
  startCol: number,
  endCol: number,
  preserveSingleTrailingSpaceAtEnd: boolean,
): string {
  const effectiveCols = row.hasScrollbar && row.cols > 0 ? row.cols - 1 : row.cols;
  const clampedStart = Math.max(0, Math.min(startCol, effectiveCols));
  const rawClampedEnd = Math.max(clampedStart, Math.min(endCol, effectiveCols));
  const cappedEnd = preserveSingleTrailingSpaceAtEnd
    ? rawClampedEnd
    : Math.min(rawClampedEnd, row.contentEndCol);

  if (cappedEnd <= clampedStart) return '';

  let out = '';
  for (let c = clampedStart; c < cappedEnd; c++) {
    out += row.chars[c] || '';
  }
  return out;
}

/**
 * Formats extracted selection row slices into clean clipboard text:
 * - Strips ConPTY trailing space padding and TUI scrollbar glyphs
 * - Normalizes line endings to `\n`
 * - Preserves normal ConPTY `isWrapped` continuity while eliminating phantom CJK wrap spaces
 * - Dedents common multi-line TUI left gutters without flattening relative code indents
 * - Unwraps soft-wrapped TUI prose and URLs while preserving lists, headings, tables, prompts, and code
 */
export function formatSelectionSlices(
  slices: SelectionSlice[],
  cols: number,
  isColumnMode = false,
): string {
  if (slices.length === 0) return '';

  if (isColumnMode) {
    return slices
      .map((s) => sliceRowText(s.row, s.startCol, s.endCol, false))
      .join('\n');
  }

  if (slices.length === 1) {
    const s = slices[0];
    return sliceRowText(s.row, s.startCol, s.endCol, false);
  }

  // Trim leading and trailing purely blank padding rows (preserve internal blank lines).
  let firstNonBlank = 0;
  while (firstNonBlank < slices.length && slices[firstNonBlank].row.contentEndCol === 0) {
    firstNonBlank++;
  }
  let lastNonBlank = slices.length - 1;
  while (lastNonBlank >= firstNonBlank && slices[lastNonBlank].row.contentEndCol === 0) {
    lastNonBlank--;
  }
  const activeSlices =
    firstNonBlank <= lastNonBlank ? slices.slice(firstNonBlank, lastNonBlank + 1) : slices;

  if (activeSlices.length === 0) return '';
  if (activeSlices.length === 1) {
    const s = activeSlices[0];
    return sliceRowText(s.row, s.startCol, s.endCol, false);
  }

  // 1. Extract per-row slice strings, resolving ConPTY `isWrapped` wrap-boundary spaces.
  const rawLineTexts: string[] = [];
  const wrappedToNext: boolean[] = new Array(activeSlices.length).fill(false);

  for (let i = 0; i < activeSlices.length; i++) {
    const curr = activeSlices[i];
    const next = i + 1 < activeSlices.length ? activeSlices[i + 1] : undefined;
    const effectiveCols = curr.row.hasScrollbar && curr.row.cols > 0 ? curr.row.cols - 1 : curr.row.cols;

    let preserveEndSpace = false;
    if (
      next &&
      next.row.isWrapped &&
      curr.endCol >= effectiveCols &&
      next.startCol === 0
    ) {
      wrappedToNext[i] = true;
      // Preserve a genuine space printed at cols-1 only when followed by a width-1 char;
      // when followed by a width-2 CJK char, cols-1 space is ConPTY odd-column wrap padding.
      if (
        effectiveCols > 0 &&
        curr.row.chars[effectiveCols - 1] === ' ' &&
        next.row.widths[0] === 1 &&
        curr.row.contentEndCol > 0 &&
        next.row.contentEndCol > 0
      ) {
        preserveEndSpace = true;
      }
    }

    rawLineTexts.push(sliceRowText(curr.row, curr.startCol, curr.endCol, preserveEndSpace));
  }

  // 2. Dedent shared TUI left gutter across multi-line selections.
  const { lines: dedentedLines, commonMargin } = trimCommonLeftMargin(rawLineTexts, activeSlices);
  const wrapCol = estimateWrapColumn(activeSlices, dedentedLines, cols, commonMargin);

  // 3. Reassemble lines, honoring hard terminal wraps, TUI soft wraps, and Markdown/code fences.
  const outChunks: string[] = [];
  let inCodeFence = false;
  if (CODE_FENCE_RE.test(dedentedLines[0]?.trimStart() ?? '')) {
    inCodeFence = true;
  }

  let currentParagraph = dedentedLines[0] ?? '';

  for (let i = 1; i < dedentedLines.length; i++) {
    const prevSlice = activeSlices[i - 1];
    const currSlice = activeSlices[i];
    const prevDedented = dedentedLines[i - 1] ?? '';
    const currDedented = dedentedLines[i] ?? '';
    const isFenceLine = CODE_FENCE_RE.test(currDedented.trimStart());

    if (wrappedToNext[i - 1]) {
      // ConPTY terminal auto-wrap (`isWrapped === true`) joins directly.
      currentParagraph += currDedented;
    } else if (
      shouldSoftUnwrap(prevSlice, currSlice, prevDedented, currDedented, wrapCol, inCodeFence)
    ) {
      const sep = chooseSoftWrapSeparator(
        prevDedented.trimEnd(),
        currDedented.trimStart(),
        prevSlice.row.contentEndCol,
        wrapCol,
      );
      currentParagraph += sep + currDedented.trimStart();
    } else {
      outChunks.push(currentParagraph);
      currentParagraph = currDedented;
    }

    if (isFenceLine) {
      inCodeFence = !inCodeFence;
    }
  }

  outChunks.push(currentParagraph);
  return outChunks.join('\n');
}

/**
 * Maintains a virtual scroll-history backing store and scroll-anchored selection
 * range across alternate-screen TUI scroll redraws.
 */
export class AltScreenSelectionTracker {
  private cols = 0;
  private rows = 0;
  private topVirtualRow = 0;
  private virtualRows = new Map<number, ExtractedRow>();
  private prevScreenRows: ExtractedRow[] | null = null;
  private bandTop = 0;
  private bandBottom = 0;
  private hasKnownScrollBand = false;

  private anchor: { vRow: number; col: number; length: number } | null = null;
  private focus: SelectionPoint | null = null;
  private active = false;
  private columnMode = false;

  public get estimatedBandHeight(): number {
    if (this.hasKnownScrollBand && this.bandBottom > this.bandTop) {
      return this.bandBottom - this.bandTop;
    }
    return Math.max(1, this.rows);
  }

  public get knownBand(): { top: number; bottom: number; detected: boolean } {
    return {
      top: this.hasKnownScrollBand ? this.bandTop : 0,
      bottom: this.hasKnownScrollBand ? this.bandBottom : this.rows,
      detected: this.hasKnownScrollBand,
    };
  }

  public get currentTopVirtualRow(): number {
    return this.topVirtualRow;
  }

  public get anchorPoint(): { vRow: number; col: number; length: number } | null {
    return this.anchor ? { ...this.anchor } : null;
  }

  public get focusPoint(): SelectionPoint | null {
    return this.focus ? { ...this.focus } : null;
  }

  public isColumnMode(): boolean {
    return this.columnMode;
  }

  public setColumnMode(columnMode: boolean): void {
    this.columnMode = columnMode;
  }

  public isSeeded(): boolean {
    return this.prevScreenRows !== null;
  }

  public resetAll(): void {
    this.topVirtualRow = 0;
    this.virtualRows.clear();
    this.prevScreenRows = null;
    this.bandTop = 0;
    this.bandBottom = 0;
    this.hasKnownScrollBand = false;
    this.clearSelection();
  }

  public clearSelection(): void {
    this.anchor = null;
    this.focus = null;
    this.active = false;
    this.columnMode = false;
  }

  public hasSelection(): boolean {
    if (!this.active || !this.anchor || !this.focus) return false;
    const { start, end } = this.getNormalizedRange();
    return start.vRow < end.vRow || (start.vRow === end.vRow && start.col < end.col);
  }

  public startSelection(screenRow: number, col: number, length = 0, columnMode = false): void {
    const clampedRow = Math.max(0, Math.min(Math.max(0, this.rows - 1), screenRow));
    const clampedCol = Math.max(0, Math.min(this.cols, col));
    const vRow = this.topVirtualRow + clampedRow;
    this.anchor = { vRow, col: clampedCol, length: Math.max(0, length) };
    this.focus = { vRow, col: Math.min(this.cols, clampedCol + Math.max(0, length)) };
    this.columnMode = columnMode;
    this.active = length > 0;
  }

  public setAnchorVirtual(vRow: number, col: number, length = 0): void {
    this.anchor = { vRow, col: Math.max(0, Math.min(this.cols, col)), length: Math.max(0, length) };
    if (!this.focus) {
      this.focus = { vRow, col: Math.min(this.cols, col + Math.max(0, length)) };
    }
    this.active = this.hasNonEmptyEndpoints();
  }

  public updateFocusFromScreen(screenRow: number, col: number): void {
    if (!this.anchor) {
      this.startSelection(screenRow, col, 0, this.columnMode);
      return;
    }
    const clampedRow = Math.max(0, Math.min(Math.max(0, this.rows - 1), screenRow));
    const clampedCol = Math.max(0, Math.min(this.cols, col));
    this.focus = { vRow: this.topVirtualRow + clampedRow, col: clampedCol };
    this.active = this.hasNonEmptyEndpoints();
  }

  private hasNonEmptyEndpoints(): boolean {
    if (!this.anchor || !this.focus) return false;
    if (this.anchor.length > 0) return true;
    return this.anchor.vRow !== this.focus.vRow || this.anchor.col !== this.focus.col;
  }

  public getNormalizedRange(): { start: SelectionPoint; end: SelectionPoint } {
    if (!this.anchor || !this.focus) {
      return { start: { vRow: 0, col: 0 }, end: { vRow: 0, col: 0 } };
    }
    const aStart = { vRow: this.anchor.vRow, col: this.anchor.col };
    const aEnd = {
      vRow: this.anchor.vRow,
      col: Math.min(this.cols, this.anchor.col + this.anchor.length),
    };
    const f = this.focus;

    if (f.vRow < aStart.vRow) {
      return { start: f, end: aEnd };
    }
    if (f.vRow > aEnd.vRow) {
      return { start: aStart, end: f };
    }
    // Same virtual row
    if (f.col < aStart.col) {
      return { start: f, end: aEnd };
    }
    if (f.col > aEnd.col) {
      return { start: aStart, end: f };
    }
    return { start: aStart, end: aEnd };
  }

  /**
   * Computes clamped `[start, end]` coordinates in current viewport screen space
   * for projecting onto xterm's SelectionModel, or `null` if entirely off-screen.
   */
  public getProjectedScreenRange(): {
    anchorScreen: { row: number; col: number; length: number };
    focusScreen: { row: number; col: number };
    isReversed: boolean;
  } | null {
    if (!this.hasSelection() || !this.anchor || !this.focus || this.rows <= 0) {
      return null;
    }

    const visTop = this.hasKnownScrollBand ? this.bandTop : 0;
    const visBottom = (this.hasKnownScrollBand ? this.bandBottom : this.rows) - 1;
    if (visBottom < visTop) return null;

    const topVRow = this.topVirtualRow + visTop;
    const bottomVRow = this.topVirtualRow + visBottom;

    const { start, end } = this.getNormalizedRange();
    if (end.vRow < topVRow || start.vRow > bottomVRow) {
      return null;
    }

    // Clamp anchor and focus individually so xterm preserves drag-anchor semantics
    // when either endpoint has scrolled off-screen.
    let anchorSRow: number;
    let anchorSCol: number;
    let anchorLen: number;

    if (this.anchor.vRow < topVRow) {
      anchorSRow = visTop;
      anchorSCol = 0;
      anchorLen = 0;
    } else if (this.anchor.vRow > bottomVRow) {
      anchorSRow = visBottom;
      anchorSCol = this.cols;
      anchorLen = 0;
    } else {
      anchorSRow = this.anchor.vRow - this.topVirtualRow;
      anchorSCol = Math.max(0, Math.min(this.cols, this.anchor.col));
      anchorLen = this.anchor.length;
    }

    let focusSRow: number;
    let focusSCol: number;
    if (this.focus.vRow < topVRow) {
      focusSRow = visTop;
      focusSCol = 0;
    } else if (this.focus.vRow > bottomVRow) {
      focusSRow = visBottom;
      focusSCol = this.cols;
    } else {
      focusSRow = this.focus.vRow - this.topVirtualRow;
      focusSCol = Math.max(0, Math.min(this.cols, this.focus.col));
    }

    const isReversed =
      focusSRow < anchorSRow || (focusSRow === anchorSRow && focusSCol < anchorSCol);

    return {
      anchorScreen: { row: anchorSRow, col: anchorSCol, length: anchorLen },
      focusScreen: { row: focusSRow, col: focusSCol },
      isReversed,
    };
  }

  /**
   * Captures a new alt-screen frame (rows 0..rows-1), detects scroll shifts, updates
   * the virtual line history while healing transient floating pills, and optionally
   * updates focus when dragging past the edge or while wheeling during an active drag.
   */
  public ingestRows(
    rawRows: ExtractedRow[],
    cols: number,
    expectedDirection: -1 | 0 | 1 = 0,
    dragFollow?: { active: boolean; col: number; screenRow: number },
  ): ScrollShiftResult | null {
    const currRows = applyScrollbarDetection(rawRows, cols);
    const rows = currRows.length;

    if (this.cols !== cols || this.rows !== rows) {
      this.cols = cols;
      this.rows = rows;
      this.topVirtualRow = 0;
      this.virtualRows.clear();
      this.bandTop = 0;
      this.bandBottom = rows;
      this.hasKnownScrollBand = false;
      this.clearSelection();
      for (let r = 0; r < rows; r++) {
        this.virtualRows.set(r, currRows[r]);
      }
      this.prevScreenRows = currRows;
      return { shift: 0, bandTop: 0, bandBottom: rows };
    }

    if (!this.prevScreenRows) {
      this.bandTop = 0;
      this.bandBottom = rows;
      for (let r = 0; r < rows; r++) {
        this.virtualRows.set(this.topVirtualRow + r, currRows[r]);
      }
      this.prevScreenRows = currRows;
      return { shift: 0, bandTop: 0, bandBottom: rows };
    }

    const result = detectScrollShift(this.prevScreenRows, currRows, expectedDirection);
    if (!result) {
      // Unrecognized full-screen replacement (no overlap). Reset virtual history cleanly.
      this.prevScreenRows = currRows;
      this.topVirtualRow = 0;
      this.virtualRows.clear();
      this.bandTop = 0;
      this.bandBottom = rows;
      this.hasKnownScrollBand = false;
      for (let r = 0; r < rows; r++) {
        this.virtualRows.set(r, currRows[r]);
      }
      if (!dragFollow?.active && this.active) {
        this.clearSelection();
      }
      return null;
    }

    if (result.shift !== 0) {
      this.topVirtualRow += result.shift;
      this.bandTop = result.bandTop;
      this.bandBottom = result.bandBottom;
      this.hasKnownScrollBand = result.bandTop > 0 || result.bandBottom < rows;
    } else if (!this.hasKnownScrollBand && (result.bandTop > 0 || result.bandBottom < rows)) {
      this.bandTop = result.bandTop;
      this.bandBottom = result.bandBottom;
      this.hasKnownScrollBand = true;
    }

    const writeStart = this.hasKnownScrollBand ? this.bandTop : 0;
    const writeEnd = this.hasKnownScrollBand ? this.bandBottom : rows;

    for (let r = writeStart; r < writeEnd; r++) {
      const vRow = this.topVirtualRow + r;
      const incoming = currRows[r];
      const existing = this.virtualRows.get(vRow);

      // Floating-pill healing: never let a transient overlay pill clobber real
      // historical text captured at this virtual row on another scroll frame.
      if (incoming.hasFloatingPill && existing && !existing.hasFloatingPill && existing.contentEndCol > 0) {
        continue;
      }
      this.virtualRows.set(vRow, incoming);
    }

    // If neither band edge changed yet on frame 0..k, keep chrome rows seeded if unpopulated.
    if (!this.hasKnownScrollBand) {
      for (let r = 0; r < rows; r++) {
        if (!this.virtualRows.has(this.topVirtualRow + r)) {
          this.virtualRows.set(this.topVirtualRow + r, currRows[r]);
        }
      }
    }

    if (dragFollow?.active && result.shift !== 0 && this.anchor) {
      const clampedRow = Math.max(writeStart, Math.min(Math.max(writeStart, writeEnd - 1), dragFollow.screenRow));
      this.focus = {
        vRow: this.topVirtualRow + clampedRow,
        col: Math.max(0, Math.min(this.cols, dragFollow.col)),
      };
      this.active = this.hasNonEmptyEndpoints();
    }

    this.pruneHistory();
    this.prevScreenRows = currRows;
    return result;
  }

  public ingestBuffer(
    buffer: IBuffer,
    cols: number,
    rows: number,
    expectedDirection: -1 | 0 | 1 = 0,
    dragFollow?: { active: boolean; col: number; screenRow: number },
  ): ScrollShiftResult | null {
    const reusableCell = buffer.getNullCell();
    const rawRows: ExtractedRow[] = [];
    const base = buffer.viewportY;
    for (let r = 0; r < rows; r++) {
      rawRows.push(extractBufferRow(buffer.getLine(base + r), cols, reusableCell));
    }
    return this.ingestRows(rawRows, cols, expectedDirection, dragFollow);
  }

  public getSelectionText(): string {
    if (!this.hasSelection()) return '';
    const { start, end } = this.getNormalizedRange();
    const slices: SelectionSlice[] = [];

    for (let vRow = start.vRow; vRow <= end.vRow; vRow++) {
      const row = this.virtualRows.get(vRow);
      if (!row) {
        // Maintain line continuity if an uncaptured gap row ever occurs
        const emptyRow = extractBufferRow(undefined, this.cols);
        slices.push({ row: emptyRow, startCol: 0, endCol: 0 });
        continue;
      }

      if (this.columnMode) {
        const cStart = Math.min(start.col, end.col);
        const cEnd = Math.max(start.col, end.col);
        slices.push({ row, startCol: cStart, endCol: cEnd });
      } else {
        const sCol = vRow === start.vRow ? start.col : 0;
        const eCol = vRow === end.vRow ? end.col : this.cols;
        slices.push({ row, startCol: sCol, endCol: eCol });
      }
    }

    return formatSelectionSlices(slices, this.cols, this.columnMode);
  }

  private pruneHistory(): void {
    const maxEntries = 4000;
    if (this.virtualRows.size <= maxEntries) return;
    let keepMin = this.topVirtualRow - 1500;
    let keepMax = this.topVirtualRow + this.rows + 1500;
    if (this.hasSelection()) {
      const { start, end } = this.getNormalizedRange();
      keepMin = Math.min(keepMin, start.vRow - 50);
      keepMax = Math.max(keepMax, end.vRow + 50);
    }
    for (const key of this.virtualRows.keys()) {
      if (key < keepMin || key > keepMax) {
        this.virtualRows.delete(key);
      }
    }
  }
}

function getCore(term: Terminal): XtermCoreLike {
  return ((term as unknown as { _core?: XtermCoreLike })._core) ?? {};
}

function getSelectionBounds(term: Terminal): {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
  isColumnMode: boolean;
} | null {
  if (!term.hasSelection()) return null;
  const core = getCore(term);
  const service = core._selectionService;
  const model = service?._model;
  if (model?.finalSelectionStart && model?.finalSelectionEnd) {
    return {
      startCol: model.finalSelectionStart[0],
      startRow: model.finalSelectionStart[1],
      endCol: model.finalSelectionEnd[0],
      endRow: model.finalSelectionEnd[1],
      // SelectionMode in xterm.js: 0=NORMAL, 1=WORD, 2=LINE, 3=COLUMN
      isColumnMode: service?._activeSelectionMode === 3,
    };
  }

  const pos = term.getSelectionPosition();
  if (!pos) return null;
  return {
    startCol: pos.start.x,
    startRow: pos.start.y,
    endCol: pos.end.x,
    endRow: pos.end.y,
    isColumnMode: false,
  };
}

/**
 * Formats the active xterm selection directly from `term.buffer.active` with
 * full ConPTY trailing-space removal, CJK phantom-wrap cleanup, TUI margin
 * dedent, and prose unwrapping.
 */
export function extractFormattedTerminalSelection(term: Terminal): string {
  const bounds = getSelectionBounds(term);
  if (!bounds) return '';

  const buffer = term.buffer.active;
  const cols = term.cols;
  const startRow = Math.max(0, Math.min(buffer.length - 1, bounds.startRow));
  const endRow = Math.max(startRow, Math.min(buffer.length - 1, bounds.endRow));
  const reusableCell = buffer.getNullCell();

  // Inspect nearby viewport rows when in small selections so a scrollbar spanning
  // lines above/below the selection is still recognized cleanly.
  const inspectStart = Math.max(buffer.viewportY, Math.min(startRow, buffer.viewportY));
  const inspectEnd = Math.min(
    buffer.length - 1,
    Math.max(endRow, buffer.viewportY + term.rows - 1),
  );
  const inspected: ExtractedRow[] = [];
  for (let y = inspectStart; y <= inspectEnd; y++) {
    inspected.push(extractBufferRow(buffer.getLine(y), cols, reusableCell));
  }
  const detected = applyScrollbarDetection(inspected, cols);

  const slices: SelectionSlice[] = [];
  for (let y = startRow; y <= endRow; y++) {
    const row = detected[y - inspectStart];
    if (!row) continue;
    if (bounds.isColumnMode) {
      const cStart = Math.min(bounds.startCol, bounds.endCol);
      const cEnd = Math.max(bounds.startCol, bounds.endCol);
      slices.push({ row, startCol: cStart, endCol: cEnd });
    } else {
      const sCol = y === startRow ? bounds.startCol : 0;
      const eCol = y === endRow ? bounds.endCol : cols;
      slices.push({ row, startCol: sCol, endCol: eCol });
    }
  }

  return formatSelectionSlices(slices, cols, bounds.isColumnMode);
}

/**
 * Attaches multi-screen alternate-buffer selection tracking, drag-edge auto-scroll,
 * Shift+Click extension, and clean copy formatting to an opened xterm `Terminal`.
 */
export function createTerminalSelectionController(
  options: TerminalSelectionControllerOptions,
): TerminalSelectionController {
  const { term, scrollAltScreen } = options;
  const tracker = new AltScreenSelectionTracker();

  let disposed = false;
  let projecting = false;
  let hiddenOffscreenByProjection = false;
  let isDragging = false;
  let shiftDragOwned = false;
  let dragStartedInBand = false;
  let sendingInternalScroll = false;
  let pendingWheelDir: -1 | 0 | 1 = 0;
  let pendingWheelExpiresAt = 0;

  let lastPointerCol = 0;
  let lastPointerScreenRow = 0;
  let autoScrollDir: -1 | 0 | 1 = 0;
  let autoScrollLines = 1;
  let autoScrollTimer: number | null = null;
  let winListenersAttached = false;

  const isInAltScreen = () => term.buffer.active.type === 'alternate';

  const getExpectedDirection = (): -1 | 0 | 1 => {
    if (pendingWheelDir !== 0 && performance.now() <= pendingWheelExpiresAt) {
      return pendingWheelDir;
    }
    return 0;
  };

  const setPendingDirection = (dir: -1 | 1) => {
    pendingWheelDir = dir;
    pendingWheelExpiresAt = performance.now() + 500;
  };

  const getScreenElement = (): HTMLElement | null => {
    const el = term.element;
    if (!el) return null;
    return (el.querySelector('.xterm-screen') as HTMLElement | null) ?? el;
  };

  const pointerToCellAndEdge = (
    clientX: number,
    clientY: number,
  ): {
    col: number;
    screenRow: number;
    edgeDir: -1 | 0 | 1;
    edgeLines: number;
  } => {
    const screenEl = getScreenElement();
    const core = getCore(term);
    if (!screenEl) {
      return { col: 0, screenRow: 0, edgeDir: 0, edgeLines: 1 };
    }

    const rect = screenEl.getBoundingClientRect();
    const cellW = core._renderService?.dimensions?.css?.cell?.width || rect.width / Math.max(1, term.cols);
    const cellH = core._renderService?.dimensions?.css?.cell?.height || rect.height / Math.max(1, term.rows);
    const band = tracker.knownBand;
    const useBand = band.detected && dragStartedInBand;
    const bandTop = useBand ? band.top : 0;
    const bandBottom = useBand ? band.bottom : term.rows;
    const maxBandRow = Math.max(bandTop, bandBottom - 1);

    let col = 0;
    const msCoords = core._mouseService?.getCoords?.(
      { clientX, clientY },
      screenEl,
      term.cols,
      term.rows,
      true,
    );
    if (msCoords) {
      col = Math.max(0, Math.min(term.cols, msCoords[0] - 1));
    } else if (cellW > 0) {
      col = Math.max(0, Math.min(term.cols, Math.floor((clientX - rect.left + cellW * 0.5) / cellW)));
    }

    const relY = clientY - rect.top;
    let screenRow = msCoords
      ? Math.max(0, Math.min(term.rows - 1, msCoords[1] - 1))
      : Math.max(0, Math.min(term.rows - 1, Math.floor(relY / Math.max(1, cellH))));

    let edgeDir: -1 | 0 | 1 = 0;
    let edgeLines = 1;

    const topEdgePx = useBand ? bandTop * cellH : 0;
    const bottomEdgePx = useBand ? bandBottom * cellH : rect.height;

    if (relY < topEdgePx) {
      edgeDir = -1;
      screenRow = bandTop;
      if (relY < 0) col = 0;
      const dist = topEdgePx - relY;
      const safeMax = Math.max(1, Math.floor(Math.max(4, tracker.estimatedBandHeight - 2) * 0.45));
      edgeLines = Math.max(1, Math.min(safeMax, Math.ceil(dist / Math.max(16, cellH * 2))));
    } else if (relY > bottomEdgePx) {
      edgeDir = 1;
      screenRow = maxBandRow;
      if (relY > rect.height) col = term.cols;
      const dist = relY - bottomEdgePx;
      const safeMax = Math.max(1, Math.floor(Math.max(4, tracker.estimatedBandHeight - 2) * 0.45));
      edgeLines = Math.max(1, Math.min(safeMax, Math.ceil(dist / Math.max(16, cellH * 2))));
    } else {
      screenRow = Math.max(bandTop, Math.min(maxBandRow, screenRow));
    }

    return { col, screenRow, edgeDir, edgeLines };
  };

  const stopAutoScroll = () => {
    autoScrollDir = 0;
    if (autoScrollTimer !== null) {
      window.clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
  };

  const startAutoScrollIfNeeded = () => {
    if (autoScrollDir === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollTimer !== null) return;
    autoScrollTimer = window.setInterval(() => {
      if (disposed || !isDragging || autoScrollDir === 0 || !isInAltScreen()) {
        stopAutoScroll();
        return;
      }
      setPendingDirection(autoScrollDir);
      runInternalScroll(() => {
        scrollAltScreen(autoScrollDir as -1 | 1, autoScrollLines);
      });
    }, 65);
  };

  const projectTrackerToXterm = () => {
    const core = getCore(term);
    const service = core._selectionService;
    const model = service?._model;
    if (!service || !model) return;

    const proj = tracker.getProjectedScreenRange();
    projecting = true;
    try {
      if (!proj) {
        hiddenOffscreenByProjection = tracker.hasSelection();
        if (model.selectionStart !== undefined || model.selectionEnd !== undefined) {
          model.selectionStart = undefined;
          model.selectionEnd = undefined;
          model.selectionStartLength = 0;
          model.isSelectAllActive = false;
          service.refresh?.();
        }
        return;
      }

      hiddenOffscreenByProjection = false;
      if (
        model.selectionStart?.[0] === proj.anchorScreen.col &&
        model.selectionStart?.[1] === proj.anchorScreen.row &&
        model.selectionEnd?.[0] === proj.focusScreen.col &&
        model.selectionEnd?.[1] === proj.focusScreen.row &&
        (model.selectionStartLength ?? 0) === proj.anchorScreen.length &&
        !model.isSelectAllActive
      ) {
        return;
      }

      model.isSelectAllActive = false;
      model.selectionStart = [proj.anchorScreen.col, proj.anchorScreen.row];
      model.selectionStartLength = proj.anchorScreen.length;
      model.selectionEnd = [proj.focusScreen.col, proj.focusScreen.row];
      service.refresh?.();
    } finally {
      projecting = false;
    }
  };

  function attachWinListeners() {
    if (winListenersAttached) return;
    winListenersAttached = true;
    window.addEventListener('mousemove', onWinMouseMoveCapture, { capture: true });
    window.addEventListener('mouseup', onWinMouseUpCapture, { capture: true });
  }

  function detachWinListeners() {
    if (!winListenersAttached) return;
    winListenersAttached = false;
    window.removeEventListener('mousemove', onWinMouseMoveCapture, { capture: true });
    window.removeEventListener('mouseup', onWinMouseUpCapture, { capture: true });
  }

  function onWinMouseMoveCapture(e: MouseEvent) {
    if (disposed || !isDragging || !isInAltScreen()) return;

    const mapped = pointerToCellAndEdge(e.clientX, e.clientY);
    let nextCol = mapped.col;
    const nextRow = mapped.screenRow;

    const core = getCore(term);
    const activeMode = core._selectionService?._activeSelectionMode ?? 0;

    if (activeMode === 2) {
      // SelectionMode.LINE === 2: snap focus column to full line start/end.
      const anchor = tracker.anchorPoint;
      const focusVRow = tracker.currentTopVirtualRow + nextRow;
      nextCol = anchor && focusVRow < anchor.vRow ? 0 : term.cols;
    } else if (mapped.edgeDir === 0 && activeMode !== 3 && nextCol < term.cols) {
      // Match xterm SelectionService wide-char continuation cell snapping (width === 0 -> col + 1).
      const line = term.buffer.active.getLine(term.buffer.active.viewportY + nextRow);
      if (line && line.getCell(nextCol)?.getWidth() === 0) {
        nextCol = Math.min(term.cols, nextCol + 1);
      }
    }

    lastPointerCol = nextCol;
    lastPointerScreenRow = nextRow;
    autoScrollDir = mapped.edgeDir;
    autoScrollLines = mapped.edgeLines;
    startAutoScrollIfNeeded();
    tracker.updateFocusFromScreen(nextRow, nextCol);

    if (shiftDragOwned) {
      projectTrackerToXterm();
      return;
    }

    // Blink drains microtasks between window-capture and document-bubble on native events,
    // so use a macrotask (setTimeout 0) to re-clamp xterm's model after bubble completes.
    if (mapped.edgeDir !== 0 || tracker.knownBand.detected) {
      window.setTimeout(() => {
        if (!disposed && isDragging && isInAltScreen() && tracker.hasSelection()) {
          projectTrackerToXterm();
        }
      }, 0);
    }
  }

  function onWinMouseUpCapture() {
    detachWinListeners();
    stopAutoScroll();
    if (!isDragging) return;
    const wasShiftOwned = shiftDragOwned;
    isDragging = false;
    shiftDragOwned = false;
    dragStartedInBand = false;
    if (!tracker.hasSelection()) {
      tracker.clearSelection();
      return;
    }
    if (wasShiftOwned && isInAltScreen()) {
      projectTrackerToXterm();
      return;
    }
    window.setTimeout(() => {
      if (!disposed && !isDragging && isInAltScreen() && tracker.hasSelection()) {
        projectTrackerToXterm();
      }
    }, 0);
  }

  const handleHostMouseDownCapture = (e: MouseEvent) => {
    if (disposed || e.button !== 0 || !isInAltScreen()) return;

    // Seed initial alt-screen rows if frame ingestion hasn't run yet.
    if (!tracker.isSeeded()) {
      tracker.ingestBuffer(term.buffer.active, term.cols, term.rows, 0);
    }

    if (e.shiftKey && tracker.hasSelection()) {
      // Shift+Click extends from existing off-screen or on-screen virtual anchor
      // instead of letting xterm clobber `selectionStart` with viewport row 0.
      e.stopPropagation();
      e.preventDefault();
      term.focus();

      const band = tracker.knownBand;
      dragStartedInBand = true;
      const mapped = pointerToCellAndEdge(e.clientX, e.clientY);
      lastPointerCol = mapped.col;
      lastPointerScreenRow = mapped.screenRow;
      const clampedRow = Math.max(
        band.detected ? band.top : 0,
        Math.min(Math.max(0, (band.detected ? band.bottom : term.rows) - 1), mapped.screenRow),
      );
      tracker.updateFocusFromScreen(clampedRow, mapped.col);
      projectTrackerToXterm();

      isDragging = true;
      shiftDragOwned = true;
      attachWinListeners();
    }
  };

  const handleHostMouseDownBubble = (e: MouseEvent) => {
    if (disposed || e.button !== 0 || !isInAltScreen()) return;
    // Skip if Shift+Click extension already took ownership in capture phase.
    if (isDragging) return;

    const band = tracker.knownBand;
    const mapped = pointerToCellAndEdge(e.clientX, e.clientY);
    dragStartedInBand = !band.detected || (mapped.screenRow >= band.top && mapped.screenRow < band.bottom);
    lastPointerCol = mapped.col;
    lastPointerScreenRow = mapped.screenRow;

    const core = getCore(term);
    const service = core._selectionService;
    const model = service?._model;
    const isColumnMode = service?._activeSelectionMode === 3;

    if (model?.selectionStart) {
      tracker.startSelection(
        model.selectionStart[1],
        model.selectionStart[0],
        model.selectionStartLength ?? 0,
        isColumnMode,
      );
      if (model.selectionEnd) {
        tracker.updateFocusFromScreen(model.selectionEnd[1], model.selectionEnd[0]);
      }
    } else {
      tracker.startSelection(mapped.screenRow, mapped.col, 0, isColumnMode);
    }

    isDragging = true;
    shiftDragOwned = false;
    attachWinListeners();
  };

  const hostEl = term.element;
  if (hostEl) {
    hostEl.addEventListener('mousedown', handleHostMouseDownCapture, { capture: true });
    hostEl.addEventListener('mousedown', handleHostMouseDownBubble);
  }

  if (isInAltScreen()) {
    tracker.ingestBuffer(term.buffer.active, term.cols, term.rows, 0);
  }

  const selChangeDisposable = term.onSelectionChange(() => {
    if (disposed || projecting || !isInAltScreen()) return;

    const core = getCore(term);
    const service = core._selectionService;
    const model = service?._model;

    if (model?.isSelectAllActive) {
      // Let direct buffer extraction copy the full visible Select-All range cleanly.
      hiddenOffscreenByProjection = false;
      tracker.clearSelection();
      return;
    }

    if (term.hasSelection() && model?.selectionStart) {
      // Sync double-click word / triple-click line expansions immediately so
      // scrolling or Shift+Click after a dblclick keeps the expanded anchor,
      // without downgrading or overwriting an existing off-screen anchor.
      const isCol = service?._activeSelectionMode === 3;
      const anchorLen = model.selectionStartLength ?? 0;
      const curAnchor = tracker.anchorPoint;
      if (
        anchorLen > 0 &&
        (!tracker.hasSelection() ||
          (curAnchor &&
            curAnchor.vRow === tracker.currentTopVirtualRow + model.selectionStart[1] &&
            anchorLen > curAnchor.length))
      ) {
        hiddenOffscreenByProjection = false;
        tracker.startSelection(model.selectionStart[1], model.selectionStart[0], anchorLen, isCol);
        if (model.selectionEnd) {
          tracker.updateFocusFromScreen(model.selectionEnd[1], model.selectionEnd[0]);
        }
      }
      if (isDragging && service?._activeSelectionMode === 1 && autoScrollDir === 0 && model.selectionEnd) {
        const band = tracker.knownBand;
        const useBand = band.detected && dragStartedInBand;
        const minRow = useBand ? band.top : 0;
        const maxRow = Math.max(minRow, (useBand ? band.bottom : term.rows) - 1);
        const endRow = Math.max(minRow, Math.min(maxRow, model.selectionEnd[1]));
        const endCol = Math.max(0, Math.min(term.cols, model.selectionEnd[0]));
        lastPointerCol = endCol;
        lastPointerScreenRow = endRow;
        tracker.updateFocusFromScreen(endRow, endCol);
      }
      if (tracker.hasSelection() && (isDragging || tracker.knownBand.detected)) {
        projectTrackerToXterm();
      }
      return;
    }

    if (!isDragging && !term.hasSelection() && tracker.hasSelection()) {
      if (!hiddenOffscreenByProjection && tracker.getProjectedScreenRange() !== null) {
        tracker.clearSelection();
      }
    }
  });

  const runInternalScroll = <T,>(fn: () => T): T => {
    const prev = sendingInternalScroll;
    sendingInternalScroll = true;
    try {
      return fn();
    } finally {
      sendingInternalScroll = prev;
    }
  };

  const onWriteParsed = () => {
    if (disposed || !isInAltScreen()) return;
    const dir = getExpectedDirection();
    const hadSelection = tracker.hasSelection();
    const res = tracker.ingestBuffer(
      term.buffer.active,
      term.cols,
      term.rows,
      dir,
      isDragging
        ? {
            active: true,
            col: lastPointerCol,
            screenRow: lastPointerScreenRow,
          }
        : undefined,
    );
    if (res && res.shift !== 0) {
      pendingWheelExpiresAt = performance.now() + 200;
    }
    if (tracker.hasSelection() || hadSelection) {
      projectTrackerToXterm();
    }
  };

  const onBufferChange = () => {
    if (disposed) return;
    isDragging = false;
    shiftDragOwned = false;
    dragStartedInBand = false;
    hiddenOffscreenByProjection = false;
    stopAutoScroll();
    detachWinListeners();
    tracker.resetAll();
  };

  const onResize = (cols: number, rows: number) => {
    if (disposed || !isInAltScreen()) return;
    tracker.ingestBuffer(term.buffer.active, cols, rows, 0);
  };

  const onUserInput = (data: string) => {
    if (disposed || sendingInternalScroll) return;
    // Ignore SGR/X10 mouse reports and terminal focus events (clicking Copy / window switch).
    if (
      data.startsWith('\x1b[<') ||
      data.startsWith('\x1b[M') ||
      data === '\x1b[I' ||
      data === '\x1b[O'
    ) {
      return;
    }
    if (isInAltScreen() && tracker.hasSelection()) {
      tracker.clearSelection();
      projectTrackerToXterm();
    }
  };

  const onWheelBeforeForward = (rawNotches: number, inAltScreen: boolean, deltaY: number): number => {
    if (!inAltScreen || deltaY === 0) return rawNotches;
    const dir: -1 | 1 = deltaY > 0 ? 1 : -1;
    setPendingDirection(dir);

    if (isDragging || tracker.hasSelection()) {
      // Cap wheel jump so consecutive TUI frames retain >= 50% content overlap
      // for rock-solid scroll shift detection across fast trackpad flicks.
      const safeMaxLines = Math.max(2, Math.floor(Math.max(4, tracker.estimatedBandHeight - 2) * 0.45));
      const maxNotches = safeMaxLines / 3;
      return Math.min(rawNotches, maxNotches);
    }
    return rawNotches;
  };

  const hasSelection = (): boolean => {
    if (isInAltScreen()) {
      return tracker.hasSelection() || term.hasSelection();
    }
    return term.hasSelection();
  };

  const getSelectionText = (): string => {
    if (isInAltScreen()) {
      if (tracker.hasSelection()) {
        const text = tracker.getSelectionText();
        if (text) return text;
      }
      return extractFormattedTerminalSelection(term);
    }
    return extractFormattedTerminalSelection(term);
  };

  const clear = () => {
    isDragging = false;
    shiftDragOwned = false;
    dragStartedInBand = false;
    hiddenOffscreenByProjection = false;
    stopAutoScroll();
    detachWinListeners();
    tracker.clearSelection();
    if (term.hasSelection()) {
      projecting = true;
      try {
        term.clearSelection();
      } finally {
        projecting = false;
      }
    }
  };

  const dispose = () => {
    disposed = true;
    shiftDragOwned = false;
    stopAutoScroll();
    detachWinListeners();
    selChangeDisposable.dispose();
    if (hostEl) {
      hostEl.removeEventListener('mousedown', handleHostMouseDownCapture, { capture: true });
      hostEl.removeEventListener('mousedown', handleHostMouseDownBubble);
    }
    tracker.resetAll();
  };

  return {
    hasSelection,
    getSelectionText,
    onWriteParsed,
    onBufferChange,
    onResize,
    onUserInput,
    onWheelBeforeForward,
    runInternalScroll,
    clear,
    dispose,
  };
}
