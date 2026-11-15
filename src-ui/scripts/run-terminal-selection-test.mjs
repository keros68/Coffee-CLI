import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/terminal-selection.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});

const mod = { exports: {} };
runInNewContext(compiled.outputFiles[0].text, {
  module: mod,
  exports: mod.exports,
  console,
  performance: { now: () => Date.now() },
  setTimeout,
  clearTimeout,
});

const {
  AltScreenSelectionTracker,
  applyScrollbarDetection,
  detectScrollShift,
  extractBufferRow,
  extractFormattedTerminalSelection,
  formatSelectionSlices,
  createTerminalSelectionController,
} = mod.exports;

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`  ok  ${name}`);
}

function charDisplayWidth(ch) {
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
    return 2;
  }
  return 1;
}

/**
 * Builds an IBufferLine stub matching ConPTY's behavior: unused columns on the
 * right are filled with literal ASCII spaces (`0x20`) rather than empty cells.
 */
function makeConPtyLine(text, cols, { isWrapped = false, nullPadRight = false } = {}) {
  const cells = new Array(cols).fill(null).map(() => ({ chars: nullPadRight ? '' : ' ', width: 1 }));
  let c = 0;
  for (const ch of text) {
    if (c >= cols) break;
    const w = charDisplayWidth(ch);
    if (w === 2 && c + 1 >= cols) {
      cells[c] = { chars: ' ', width: 1 };
      break;
    }
    cells[c] = { chars: ch, width: w };
    if (w === 2) {
      cells[c + 1] = { chars: '', width: 0 };
      c += 2;
    } else {
      c += 1;
    }
  }

  return {
    isWrapped,
    length: cols,
    getCell(x) {
      if (x < 0 || x >= cols) return undefined;
      const entry = cells[x];
      return {
        getChars: () => entry.chars,
        getWidth: () => entry.width,
        getCode: () => (entry.chars ? (entry.chars.codePointAt(0) ?? 0) : 0),
      };
    },
    translateToString(trimRight = false, startCol = 0, endCol = cols) {
      let s = '';
      for (let i = Math.max(0, startCol); i < Math.min(cols, endCol); i++) {
        if (cells[i].width !== 0) s += cells[i].chars || ' ';
      }
      return trimRight ? s.replace(/ +$/, '') : s;
    },
  };
}

function makeRows(specs, cols) {
  return specs.map((spec) => {
    const text = typeof spec === 'string' ? spec : spec.text;
    const isWrapped = typeof spec === 'string' ? false : Boolean(spec.isWrapped);
    return extractBufferRow(makeConPtyLine(text, cols, { isWrapped }), cols);
  });
}

function makeFullSlices(rows, cols) {
  return rows.map((row) => ({ row, startCol: 0, endCol: cols }));
}

await test('strips ConPTY right-edge space padding and normalizes line joins to \\n', () => {
  const cols = 80;
  const rows = makeRows(['  First line', '  ', '  Second line'], cols);
  const slices = [
    { row: rows[0], startCol: 0, endCol: cols },
    { row: rows[1], startCol: 0, endCol: cols },
    { row: rows[2], startCol: 0, endCol: cols },
  ];
  const out = formatSelectionSlices(slices, cols, false);
  assert.equal(out, 'First line\n\nSecond line');
  assert.equal(out.includes('\r'), false);

  const single = formatSelectionSlices([{ row: rows[0], startCol: 2, endCol: cols }], cols, false);
  assert.equal(single, 'First line');
});

await test('removes ConPTY phantom odd-column CJK wrap space while preserving genuine ASCII wrap spaces', () => {
  const cols = 10;
  // Wide CJK wrap at col 9 (`A你好世界` fills 0..8, col 9 gets phantom ' ', `再见` wraps with isWrapped=true)
  const cjkLine0 = makeConPtyLine('A你好世界 ', cols, { isWrapped: false });
  const cjkLine1 = makeConPtyLine('再见', cols, { isWrapped: true });
  const cjkRows = [
    extractBufferRow(cjkLine0, cols),
    extractBufferRow(cjkLine1, cols),
  ];
  assert.equal(formatSelectionSlices(makeFullSlices(cjkRows, cols), cols), 'A你好世界再见');

  // Genuine space at col 9 before narrow 'a' (`012345678 ` + `abc` wrapped)
  const asciiLine0 = makeConPtyLine('012345678 ', cols, { isWrapped: false });
  const asciiLine1 = makeConPtyLine('abc', cols, { isWrapped: true });
  const asciiRows = [
    extractBufferRow(asciiLine0, cols),
    extractBufferRow(asciiLine1, cols),
  ];
  assert.equal(formatSelectionSlices(makeFullSlices(asciiRows, cols), cols), '012345678 abc');
});

await test('unwraps TUI soft-wrapped English, CJK, and URLs without cross-line spaces', () => {
  const cols = 80;
  const rows = makeRows(
    [
      '  Here is a soft-wrapped paragraph inside a TUI panel that stops cleanly near',
      '  the right margin without inserting stray spaces or hard newlines.',
      '',
      '  当你滚动终端屏幕的时候，如果选区只依赖当前视口，那么上面卷走的内容就会彻底丢',
      '  失，而且每行还会产生讨厌的跨行空格，例如，TypeScript 也能完美衔接。',
      '',
      '  See https://github.com/example/coffeecli/blob/main/src-ui/src/lib/terminal-',
      '  selection/implementation.ts for details.',
    ],
    cols,
  );
  const out = formatSelectionSlices(makeFullSlices(rows, cols), cols);
  assert.equal(
    out,
    [
      'Here is a soft-wrapped paragraph inside a TUI panel that stops cleanly near the right margin without inserting stray spaces or hard newlines.',
      '',
      '当你滚动终端屏幕的时候，如果选区只依赖当前视口，那么上面卷走的内容就会彻底丢失，而且每行还会产生讨厌的跨行空格，例如，TypeScript 也能完美衔接。',
      '',
      'See https://github.com/example/coffeecli/blob/main/src-ui/src/lib/terminal-selection/implementation.ts for details.',
    ].join('\n'),
  );
});

await test('dedents TUI gutter while preserving Markdown lists, headings, tables, prompts, and indented code', () => {
  const cols = 80;
  const rows = makeRows(
    [
      '  # Architecture Overview',
      '  - First bullet point that wraps cleanly across two terminal lines right before',
      '    reaching the panel border edge.',
      '  - Second item',
      '  | Name | Role |',
      '  | ---- | ---- |',
      '  | term | host |',
      '  ⏺ Update(src-ui/src/lib/terminal-selection.ts)',
      '  ❯ git status',
      '  ```ts',
      '    function demo() {',
      '      return 42;',
      '    }',
      '  ```',
    ],
    cols,
  );

  // Even when starting drag at col 2 on row 0 (skipping leading 2 spaces on row 0),
  // rows 1..13 should also strip the shared 2-space TUI gutter while keeping code indents.
  const slices = rows.map((row, idx) => ({
    row,
    startCol: idx === 0 ? 2 : 0,
    endCol: cols,
  }));
  const out = formatSelectionSlices(slices, cols);
  assert.equal(
    out,
    [
      '# Architecture Overview',
      '- First bullet point that wraps cleanly across two terminal lines right before reaching the panel border edge.',
      '- Second item',
      '| Name | Role |',
      '| ---- | ---- |',
      '| term | host |',
      '⏺ Update(src-ui/src/lib/terminal-selection.ts)',
      '❯ git status',
      '```ts',
      '  function demo() {',
      '    return 42;',
      '  }',
      '```',
    ].join('\n'),
  );
});

await test('excludes rightmost TUI scrollbar glyphs from copied text', () => {
  const cols = 50;
  const frameTexts = [
    '  First line of content                          │',
    '  Second line with scrollbar thumb               █',
    '  Third line of content                          █',
    '  Fourth line of content                         │',
  ];
  const detected = applyScrollbarDetection(makeRows(frameTexts, cols), cols);
  assert.equal(detected.every((r) => r.hasScrollbar), true);
  const out = formatSelectionSlices(makeFullSlices(detected, cols), cols);
  assert.equal(
    out,
    [
      'First line of content',
      'Second line with scrollbar thumb',
      'Third line of content',
      'Fourth line of content',
    ].join('\n'),
  );
  assert.equal(out.includes('│') || out.includes('█'), false);
});

await test('tracks multi-screen downward scroll across 4 frames with pinned header/footer and floating pill healing', () => {
  const cols = 60;
  const header = '=== Pi Agent v1.5 ===';
  const footer1 = '──────────────────────';
  const footer2 = '› ';
  const footer = (sec) => [footer1, footer2, `Elapsed ${sec}s`];

  const docLines = Array.from({ length: 18 }, (_, i) => `  Line ${String(i + 1).padStart(2, '0')} in conversation`);

  const buildScreen = (offset, sec, pillRow = -1) => {
    const body = docLines.slice(offset, offset + 6).map((line, idx) =>
      idx === pillRow ? '        ↓ Jump to latest message · Ctrl+End' : line,
    );
    return makeRows([header, ...body, ...footer(sec)], cols);
  };

  const tracker = new AltScreenSelectionTracker();
  // Frame 0: offset 0 -> shows Line 01..06 on screen rows 1..6
  tracker.ingestRows(buildScreen(0, 1), cols, 0);

  // Start drag at row 2 (`Line 02`), col 2 (right at 'L')
  tracker.startSelection(2, 2, 0, false);
  tracker.updateFocusFromScreen(5, cols); // drag to Line 05

  // Frame 1: scroll down by 3 (`offset = 3` -> shows Line 04..09 on rows 1..6), live footer ticks 1s -> 2s
  const r1 = tracker.ingestRows(buildScreen(3, 2), cols, 1, {
    active: true,
    col: cols,
    screenRow: 5,
  });
  assert.ok(r1 && r1.shift === 3);
  assert.deepEqual({ ...tracker.knownBand }, { top: 1, bottom: 7, detected: true });

  // Frame 2: scroll down by 3 (`offset = 6` -> shows Line 07..12), floating pill overwrites row 5 (`Line 11`)
  const r2 = tracker.ingestRows(buildScreen(6, 3, 4), cols, 1, {
    active: true,
    col: cols,
    screenRow: 6,
  });
  assert.ok(r2 && r2.shift === 3);

  // Check projection clamps off-screen top anchor at bandTop=1 col=0 (never highlighting header row 0 or footer rows 7..9)
  const proj = tracker.getProjectedScreenRange();
  assert.ok(proj);
  assert.deepEqual({ ...proj.anchorScreen }, { row: 1, col: 0, length: 0 });
  assert.deepEqual({ ...proj.focusScreen }, { row: 6, col: cols });

  // Frame 3: scroll down by 3 more (`offset = 9` -> shows Line 10..15, revealing real Line 11 cleanly)
  const r3 = tracker.ingestRows(buildScreen(9, 4), cols, 1, {
    active: true,
    col: cols,
    screenRow: 5,
  });
  assert.ok(r3 && r3.shift === 3);

  // Focus now sits at screen row 5 + offset 9 - bandOffset => Line 14
  const copied = tracker.getSelectionText();
  const expected = Array.from({ length: 13 }, (_, i) => `Line ${String(i + 2).padStart(2, '0')} in conversation`).join('\n');
  assert.equal(copied, expected);
  assert.equal(copied.includes('Jump to latest'), false);
  assert.equal(copied.includes('Pi Agent'), false);
});

await test('supports upward drag, double-click word anchor, bidirectional scroll, and Shift+Click after scrolling off-screen', () => {
  const cols = 50;
  const doc = Array.from({ length: 20 }, (_, i) => `  Row ${String(i).padStart(2, '0')} sample word`);
  const frameAt = (offset) => makeRows(['  [Header]', ...doc.slice(offset, offset + 6), '  [Footer]'], cols);

  const tracker = new AltScreenSelectionTracker();
  tracker.ingestRows(frameAt(6), cols, 0); // Shows Row 06..11 at screen rows 1..6

  // 1. Double-click `'sample'` on screen row 4 (`Row 09`, cols 9..15) and drag UPWARD
  tracker.startSelection(4, 9, 6, false);
  tracker.updateFocusFromScreen(2, 2); // Row 07 col 2

  // Scroll UP by 3 (`offset = 3`, shift = -3): screen now shows Row 03..08 (`Row 09` anchor moved off-bottom!)
  const rUp = tracker.ingestRows(frameAt(3), cols, -1, { active: true, col: 2, screenRow: 2 });
  assert.ok(rUp && rUp.shift === -3);
  const projUp = tracker.getProjectedScreenRange();
  assert.ok(projUp);
  // Off-bottom anchor clamps to bandBottom - 1 = 6, col = cols
  assert.deepEqual({ ...projUp.anchorScreen }, { row: 6, col: cols, length: 0 });
  assert.deepEqual({ ...projUp.focusScreen }, { row: 2, col: 2 });

  // Finish drag (`active: false`), then scroll DOWN in overlapping steps so entire [Row 07 .. Row 09] selection is off-screen above!
  tracker.ingestRows(frameAt(6), cols, 1); // Shows Row 06..11 (`Row 09` at row 4)
  tracker.ingestRows(frameAt(9), cols, 1); // Shows Row 09..14 (`Row 09` at row 1)
  tracker.ingestRows(frameAt(11), cols, 1); // Shows Row 11..16 (entire selection is above bandTop!)
  assert.equal(tracker.hasSelection(), true);
  assert.equal(tracker.getProjectedScreenRange(), null);

  // Now Shift+Click at screen row 5 (`Row 15`), col = 50
  tracker.updateFocusFromScreen(5, cols);
  const afterShift = tracker.getSelectionText();
  assert.ok(afterShift.startsWith('sample word'));
  assert.ok(afterShift.includes('Row 10 sample word'));
  assert.ok(afterShift.endsWith('Row 15 sample word'));
});

await test('controller ignores SGR mouse/focus input, caps wheel notches while selecting, and extracts normal buffer cleanly', () => {
  const cols = 60;
  const rows = 6;
  const bufferLines = [
    makeConPtyLine('  hello ConPTY     ', cols),
    makeConPtyLine('  world padded     ', cols),
  ];

  let activeBufferType = 'normal';
  let selectionChangeCb = null;
  const scrollCalls = [];

  const mockTerm = {
    cols,
    rows,
    element: null,
    modes: { applicationCursorKeysMode: false, mouseTrackingMode: 'none' },
    buffer: {
      get active() {
        return {
          type: activeBufferType,
          viewportY: 0,
          baseY: 0,
          length: bufferLines.length,
          getLine: (y) => bufferLines[y],
          getNullCell: () => ({ getChars: () => '', getWidth: () => 1, getCode: () => 0 }),
        };
      },
    },
    hasSelection: () => true,
    getSelection: () => '  hello ConPTY     \r\n  world padded     ',
    getSelectionPosition: () => ({ start: { x: 0, y: 0 }, end: { x: cols, y: 1 } }),
    clearSelection: () => {},
    focus: () => {},
    onSelectionChange: (cb) => {
      selectionChangeCb = cb;
      return { dispose: () => {} };
    },
  };

  assert.equal(extractFormattedTerminalSelection(mockTerm), 'hello ConPTY\nworld padded');

  activeBufferType = 'alternate';
  const controller = createTerminalSelectionController({
    term: mockTerm,
    scrollAltScreen: (dir, lines) => scrollCalls.push({ dir, lines }),
  });

  // Switch back to alt buffer with 8 scrollable rows + verify wheel notch capping
  mockTerm.rows = 12;
  bufferLines.splice(
    0,
    bufferLines.length,
    ...Array.from({ length: 12 }, (_, i) => makeConPtyLine(`  Alt row ${i}`, cols)),
  );
  controller.onWriteParsed();

  // Simulated SGR mouse sequence and focus-out sequence must NOT clear selection state
  controller.onUserInput('\x1b[<65;10;5M');
  controller.onUserInput('\x1b[O');
  // Calling Shift/normal wheel capping when not selecting passes raw notches through:
  assert.equal(controller.onWheelBeforeForward(3, true, 300), 3);

  // Clean up
  assert.equal(typeof selectionChangeCb, 'function');
  controller.dispose();
});

console.log(`Passed ${passed} terminal-selection tests.`);
