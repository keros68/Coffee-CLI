/** Exercise the production wheel callback with xterm's real VT parser. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import xterm from '@xterm/xterm';

const { Terminal } = xterm;

const source = readFileSync(new URL('../src/components/center/TierTerminal.tsx', import.meta.url), 'utf8');
const begin = source.indexOf('    term.attachCustomWheelEventHandler((e) => {');
assert.ok(begin >= 0, 'locate the production wheel handler');
const end = source.indexOf('\n    });', begin) + '\n    });'.length;
const code = source.slice(begin, end);
const screen = { left: 20, top: 50, width: 800, height: 240 };
let passed = 0;

async function fixture(tool = 'pi', isWindows = true) {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  Object.defineProperty(term, 'element', { value: { querySelector: () => ({ getBoundingClientRect: () => screen }) } });
  const writes = [];
  let handler;
  term.attachCustomWheelEventHandler = callback => { handler = callback; };
  runInNewContext(code, {
    term, tool, IS_WINDOWS: isWindows, sessionId: 'wheel-test',
    forwardTerminalInput(id, data) {
      assert.equal(id, 'wheel-test');
      writes.push(data);
      return Promise.resolve();
    },
  });
  return {
    term, writes,
    write: data => new Promise(resolve => term.write(data, resolve)),
    wheel(overrides = {}) {
      let prevented = false;
      const handledByXterm = handler({
        deltaY: -100, deltaMode: 0, clientX: 25, clientY: 55,
        shiftKey: false, altKey: false, ctrlKey: false,
        ...overrides, preventDefault() { prevented = true; },
      });
      return { handledByXterm, prevented };
    },
  };
}
async function test(name, run) {
  await run();
  passed++;
  console.log(`  ok  ${name}`);
}

for (const tool of ['pi', 'omp', 'claude']) {
  await test(`${tool}: fragmented alt-screen entry forwards wheel reports without mouse capture`, async () => {
    const f = await fixture(tool);
    for (const part of ['\x1b[?1004h', '\x1b[?', '104', '9h']) await f.write(part);
    assert.equal(f.term.buffer.active.type, 'alternate');
    assert.equal(f.term.modes.mouseTrackingMode, 'none');
    assert.deepEqual(f.wheel(), { handledByXterm: false, prevented: true });
    assert.equal(f.writes[0], '\x1b[<64;1;1M');
    assert.equal(f.term.modes.mouseTrackingMode, 'none', 'plain text selection stays available');
    f.wheel({ deltaY: 100 });
    assert.equal(f.writes[1], '\x1b[<65;1;1M');
    for (const part of ['\x1b[?104', '9l']) await f.write(part);
    assert.equal(f.term.buffer.active.type, 'normal');
    assert.deepEqual(f.wheel(), { handledByXterm: true, prevented: false });
    assert.equal(f.writes.length, 2, 'normal scrollback does not send keys or reports');
    f.term.dispose();
  });
}
await test('clamps coordinates and preserves Shift, Alt and Ctrl in SGR reports', async () => {
  const f = await fixture();
  await f.write('\x1b[?1049h');
  f.wheel({ clientX: 420, clientY: 170, shiftKey: true, altKey: true, ctrlKey: true });
  assert.equal(f.writes[0], '\x1b[<92;41;13M');
  f.wheel({ clientX: 1000, clientY: 1000 });
  assert.equal(f.writes[1], '\x1b[<64;80;24M');
  f.wheel({ clientX: 0, clientY: 0 });
  assert.equal(f.writes[2], '\x1b[<64;1;1M');
  f.term.dispose();
});
await test('normalizes wheel notches once and bounds fast scrolling', async () => {
  const f = await fixture();
  await f.write('\x1b[?1049h');
  for (const [event, count] of [
    [{ deltaY: -300 }, 3], [{ deltaY: -3, deltaMode: 1 }, 1],
    [{ deltaY: -1, deltaMode: 2 }, 1], [{ deltaY: -10000 }, 9],
  ]) {
    f.wheel(event);
    assert.equal(f.writes.at(-1), '\x1b[<64;1;1M'.repeat(count));
  }
  assert.deepEqual(f.wheel({ deltaY: 0 }), { handledByXterm: true, prevented: false });
  assert.equal(f.writes.length, 4);
  f.term.dispose();
});
await test('existing mouse modes continue through xterm without duplicate wheel reports', async () => {
  const f = await fixture();
  await f.write('\x1b[?1049h\x1b[?1003h\x1b[?1006h');
  assert.equal(f.term.modes.mouseTrackingMode, 'any');
  assert.deepEqual(f.wheel(), { handledByXterm: true, prevented: false });
  assert.equal(f.writes.length, 0);
  f.term.dispose();
});
await test('shells, remote terminals, other tools and non-Windows retain arrow scrolling', async () => {
  for (const [tool, isWindows] of [['terminal', true], ['remote', true], ['codex', true], ['pi', false], ['omp', false], ['claude', false]]) {
    const f = await fixture(tool, isWindows);
    await f.write('\x1b[?1049h');
    assert.deepEqual(f.wheel(), { handledByXterm: false, prevented: true });
    assert.equal(f.writes[0], '\x1b[A'.repeat(3));
    await f.write('\x1b[?1h');
    f.wheel({ deltaY: 100 });
    assert.equal(f.writes[1], '\x1bOB'.repeat(3));
    f.term.dispose();
  }
});
await test('entry and exit in one output burst leave normal scrolling and selection intact', async () => {
  const f = await fixture();
  await f.write('\x1b[?1049h\x1b[?1049l');
  assert.equal(f.term.buffer.active.type, 'normal');
  assert.equal(f.term.modes.mouseTrackingMode, 'none');
  assert.deepEqual(f.wheel(), { handledByXterm: true, prevented: false });
  assert.equal(f.writes.length, 0);
  f.term.dispose();
});

await test('unified native selection blocks TUI mouse capture while preserving SGR wheel and OSC 52 copy', async () => {
  const selBegin = source.indexOf('    const sgrWheelRef = { current: false };');
  assert.ok(selBegin >= 0, 'locate unified native selection setup');
  const fullCode = source.slice(selBegin, end);

  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  Object.defineProperty(term, 'element', { value: { querySelector: () => ({ getBoundingClientRect: () => screen }) } });
  const writes = [];
  const copied = [];
  let handler;
  term.attachCustomWheelEventHandler = callback => { handler = callback; };
  runInNewContext(fullCode, {
    term, tool: 'claude', IS_WINDOWS: false, sessionId: 'sel-test',
    atob, Uint8Array, TextDecoder,
    clipboardWrite(text) { copied.push(text); },
    forwardTerminalInput(id, data) {
      assert.equal(id, 'sel-test');
      writes.push(data);
      return Promise.resolve();
    },
  });
  const write = data => new Promise(resolve => term.write(data, resolve));
  const wheel = (overrides = {}) => {
    let prevented = false;
    const handledByXterm = handler({
      deltaY: -100, deltaMode: 0, clientX: 25, clientY: 55,
      shiftKey: false, altKey: false, ctrlKey: false,
      ...overrides, preventDefault() { prevented = true; },
    });
    return { handledByXterm, prevented };
  };

  // Simulate Claude Code re-emitting mouseOnSeq() after DECRQM 1016 / resize
  await write('\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h');
  assert.equal(term.buffer.active.type, 'alternate');
  assert.equal(term.modes.mouseTrackingMode, 'none', 'mouse capture stays off so xterm selection works');
  assert.deepEqual(wheel(), { handledByXterm: false, prevented: true });
  assert.equal(writes[0], '\x1b[<64;1;1M');

  // Compound DECSET mixing 1049 and 1003 also keeps mouseTrackingMode === 'none'
  await write('\x1b[?1049;1003h');
  assert.equal(term.modes.mouseTrackingMode, 'none');

  // Explicit TUI OSC 52 copy (e.g. /copy) writes decoded UTF-8 to clipboardWrite
  await write('\x1b]52;c;' + Buffer.from('复制测试 123', 'utf8').toString('base64') + '\x07');
  assert.deepEqual(copied, ['复制测试 123']);

  term.dispose();
});
console.log(`\n${passed} terminal wheel tests passed.`);
