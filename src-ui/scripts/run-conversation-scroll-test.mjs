/** Exercise the scroll-ownership decisions used by ConversationView. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const file = new URL('../src/lib/conversation-scroll.ts', import.meta.url);
const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const code = source.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(source).replace(/^export /, '')).join('\n');

const { evaluateScrollEvent, shouldRestoreScrollPosition } = runInNewContext(
  `${ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};
   ({ evaluateScrollEvent, shouldRestoreScrollPosition });`,
  {},
);

const TALL = { clientHeight: 600, scrollHeight: 5000 };
const T0 = 100_000;
const event = (over) => evaluateScrollEvent({
  now: T0, lastUserInputAt: 0, ownedUntil: 0, previouslyPinned: false,
  ...TALL, scrollTop: 2000, isTrusted: true, ...over,
});

// A user wheel-scroll mid-conversation records the new position.
{
  const decision = event({ lastUserInputAt: T0 - 50 });
  assert.equal(decision.pinned, false);
  assert.equal(decision.owned, true);
  assert.equal(decision.record, true);
  assert.equal(decision.ownedUntil, T0 + 400);
  assert.equal(decision.autoLoadOlder, false);
}

// A clamp with no user input (transcript shrank mid-poll) must neither
// overwrite the remembered position nor arm the auto-loadOlder trigger —
// even when it lands inside the <520px zone.
{
  const decision = event({ scrollTop: 100 });
  assert.equal(decision.owned, false);
  assert.equal(decision.record, false);
  assert.equal(decision.autoLoadOlder, false);
}

// A transcript that shrinks but stays taller than the viewport clamps
// scrollTop onto the NEW bottom — the event then READS as pinned. With no
// user input and no prior pin this is a clamp artifact: it must not record
// (the clamped bottom would clobber the remembered mid-list position) and
// must not flip the pinned flag (which would suppress the restore).
{
  const decision = event({ scrollHeight: 3000, scrollTop: 2400 });
  assert.equal(decision.pinned, true);
  assert.equal(decision.owned, false);
  assert.equal(decision.record, false);
  assert.equal(decision.autoLoadOlder, false);
}

// Same geometry while genuinely pinned (streaming appends at the bottom):
// the pin is real, so the position records — a pinned view has nothing to
// restore, but the flag must survive remounts.
{
  const decision = event({ scrollHeight: 3000, scrollTop: 2400, previouslyPinned: true });
  assert.equal(decision.pinned, true);
  assert.equal(decision.owned, false);
  assert.equal(decision.record, true);
  assert.equal(decision.autoLoadOlder, false);
}

// A real user scroll to the top DOES arm the auto-loadOlder trigger.
{
  const decision = event({ lastUserInputAt: T0 - 30, scrollTop: 100 });
  assert.equal(decision.autoLoadOlder, true);
}

// Momentum/smooth scrolling chains ownership without fresh input; the chain
// dies 400ms after the last event.
{
  const first = event({ lastUserInputAt: T0 - 100, scrollTop: 2500 });
  const chained = evaluateScrollEvent({
    now: T0 + 300, lastUserInputAt: T0 - 100, ownedUntil: first.ownedUntil,
    previouslyPinned: false, ...TALL, scrollTop: 1800, isTrusted: true,
  });
  assert.equal(chained.owned, true);
  assert.equal(chained.record, true);
  const dead = evaluateScrollEvent({
    now: T0 + 900, lastUserInputAt: T0 - 100, ownedUntil: chained.ownedUntil,
    previouslyPinned: false, ...TALL, scrollTop: 1200, isTrusted: true,
  });
  assert.equal(dead.owned, false);
  assert.equal(dead.record, false);
}

// Content that fits the viewport has no position worth recording.
{
  const decision = event({
    lastUserInputAt: T0 - 20, clientHeight: 600, scrollHeight: 620, scrollTop: 0,
  });
  assert.equal(decision.record, false);
}

// Restore: view sits more than a viewport above the remembered position with
// no recent input → restore; same gap right after a scrollbar fling → hold.
{
  assert.equal(shouldRestoreScrollPosition({
    savedScrollTop: 3000, scrollTop: 0, clientHeight: 600,
    now: T0, lastUserInputAt: 0,
  }), true);
  assert.equal(shouldRestoreScrollPosition({
    savedScrollTop: 3000, scrollTop: 0, clientHeight: 600,
    now: T0, lastUserInputAt: T0 - 100,
  }), false);
  assert.equal(shouldRestoreScrollPosition({
    savedScrollTop: 900, scrollTop: 500, clientHeight: 600,
    now: T0, lastUserInputAt: 0,
  }), false);
}

console.log('conversation-scroll ownership decisions OK');
