import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = file => ts.createSourceFile(file,
  fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(file, name) {
  const tree = source(file);
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return node.getText(tree);
}
function effect(file, fragment) {
  const tree = source(file); let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0].getText(tree).includes(fragment)) found = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(found, fragment); return found;
}
const evaluate = (code, context = {}) => vm.runInNewContext(ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText, context);
const tick = () => new Promise(resolve => setImmediate(resolve));

// Muse's Windows launcher title must not replace the selected workspace name.
{
  const tree = source('components/center/CenterPanel.tsx');
  let title;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'title'
      && node.initializer?.getText(tree).includes('baseTitle')) title = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(title);
  const displayedTitle = (tool, toolTitle, baseTitle = 'E300') => evaluate(title.getText(tree), {
    session: { tool, toolTitle, folderPath: 'E:\\E300' }, baseTitle,
  });
  for (const launcher of [String.raw`C:\WINDOWS\system32\cmd.exe`, String.raw`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`]) {
    assert.equal(displayedTitle('muse', launcher), 'E300', 'Muse keeps its actual workspace label');
  }
  assert.equal(displayedTitle('muse', undefined, 'Muse Code'), 'Muse Code');
  assert.equal(displayedTitle('claude', '  Implement feature  '), 'Implement feature', 'other tools retain native conversation titles');
  assert.equal(displayedTitle('codex', ''), 'E300');
  console.log('OK: Muse workspace tab name and existing-tool native titles');
}

// A mode switch must hide the conversation, not remove its React subtree.
// Otherwise both the reading position and measured virtual row heights reset.
{
  const tree = source('components/center/CenterPanel.tsx');
  let surface;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'className'
      && attribute.initializer?.getText(tree) === '"conversation-mode-surface"')) {
      surface = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(surface);
  let branch = surface.parent;
  while (ts.isParenthesizedExpression(branch)) branch = branch.parent;
  assert.ok(ts.isBinaryExpression(branch));
  const condition = branch.left.getText(tree);
  const tab = { tool: 'codex', viewMode: 'chat', chatPending: null };
  const mounted = () => evaluate(condition, { t: tab, supportsConversationTool: () => true });
  assert.ok(mounted());
  tab.viewMode = 'terminal';
  assert.ok(mounted(), 'switching to an idle terminal must retain the conversation subtree');

  let opened;
  const render = vm.runInNewContext(ts.transpileModule(
    `${declaration('components/center/ConversationView.tsx', 'ConversationViewImpl')}; ConversationViewImpl`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
  ).outputText, {
    useState(initial) {
      opened ??= initial;
      return [opened, value => { opened = value; }];
    },
    React: { createElement: (type, props) => ({ type, props }) },
    ConversationContent: 'content',
  });
  assert.equal(render({ isVisible: false }), null, 'unused terminal tabs do not mount chat content');
  const content = render({ isVisible: true });
  assert.ok(content);
  for (let i = 0; i < 3; i++) {
    assert.equal(render({ isVisible: false }).type, content.type, 'keep the same child type while hidden');
    assert.equal(render({ isVisible: true }).type, content.type);
  }
  opened = undefined;
  assert.equal(render({ isVisible: false }), null, 'a fresh session starts unmounted');
  assert.ok(render({ isVisible: false, pending: { text: 'test' } }), 'pending chat still mounts in terminal mode');

  let activity;
  function findActivity(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'isActive') activity = node.initializer.expression;
    ts.forEachChild(node, findActivity);
  }
  findActivity(surface);
  tab.id = 'test';
  const active = () => evaluate(activity.getText(tree), { t: tab, activeTerminalId: 'test', diffTabActive: false });
  assert.equal(active(), false, 'hidden idle chat does not poll');
  tab.chatPending = { text: 'test' };
  assert.equal(active(), true, 'pending chat can still resolve while hidden');
  tab.chatPending = null;
  tab.viewMode = 'chat';
  assert.equal(active(), true);
  console.log('OK: conversation mode retention, lazy mount, session reset, and hidden polling');

  const fillViewport = effect('components/center/ConversationView.tsx', 'element.scrollHeight <= element.clientHeight + 80');
  let loads = 0;
  const scroll = { clientHeight: 0, scrollHeight: 0 };
  const checkViewport = () => evaluate(`(${fillViewport})()`, {
    source: {}, hasOlderRef: { current: true }, scrollRef: { current: scroll },
    loadOlderRef: { current: () => { loads++; } },
    window: { requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} },
  });
  checkViewport();
  assert.equal(loads, 0, 'a hidden conversation must not drain older history');
  scroll.clientHeight = 600;
  scroll.scrollHeight = 400;
  checkViewport();
  assert.equal(loads, 1, 'a revealed short conversation still fills its viewport');
  scroll.scrollHeight = 1000;
  checkViewport();
  assert.equal(loads, 1, 'a full viewport needs no additional history');
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Actual reducer: a background PTY may only change its own tab/pane.
const reducer = evaluate(`${declaration('store/app-state.tsx', 'reducer')}; reducer`, {
  localStorage: { setItem() {} },
  paneSessionId: (tab, index, kind) => `${tab}::${kind}-${index}`,
});
const state = { activeTerminalId: 'A', terminals: [
  { id: 'A', folderPath: '/A' }, { id: 'B', folderPath: '/B' },
  { id: 'C', folderPath: '/C', multiAgent: { panes: [{ paneIdx: 1, folderPath: '/one' }, { paneIdx: 2, folderPath: '/two' }] } },
] };
const changed = reducer(state, { type: 'SET_TERMINAL_CWD', id: 'B', path: '/B/new' });
assert.equal(changed.terminals[0], state.terminals[0]);
assert.equal(changed.terminals[1].folderPath, '/B/new');
assert.equal(reducer(changed, { type: 'SET_TERMINAL_CWD', id: 'B', path: '/B/new' }), changed);
assert.equal(reducer(state, { type: 'SET_TERMINAL_CWD', id: 'closed', path: '/gone' }), state);
const split = reducer(state, { type: 'SET_TERMINAL_CWD', id: 'C::split-2', path: '/two/new' });
assert.equal(split.terminals[2].folderPath, '/C');
assert.equal(split.terminals[2].multiAgent.panes[0], state.terminals[2].multiAgent.panes[0]);
assert.equal(split.terminals[2].multiAgent.panes[1].folderPath, '/two/new');

const normalize = evaluate(`${declaration('components/center/ConversationView.tsx', 'normalizedPath')}; normalizedPath`);
assert.notEqual(normalize('/work/Project'), normalize('/work/project'));
assert.equal(normalize('C:\\Work\\Project\\'), normalize('c:/work/project'));
assert.equal(normalize('C:\\'), normalize('c:/'));
assert.equal(normalize('\\\\Host\\Share\\Project'), normalize('//host/share/project'));
assert.equal(normalize('/work/Project/.claude/worktrees/task'), '/work/Project');

// Cleanup during both async import and listen() registration, including StrictMode remounts.
for (const [file, fragment] of [
  ['components/right/TaskBoard.tsx', "'tasks-changed'"],
  ['components/center/CenterPanel.tsx', "'launch-request'"],
]) {
  for (const duringListen of [false, true]) {
    let created = 0, removed = 0;
    const registration = deferred();
    const body = effect(file, fragment).replace("import('@tauri-apps/api/event')", 'Promise.resolve(eventModule)');
    const cleanup = evaluate(`(${body})()`, {
      isTauri: true, commands: { takePendingLaunch: async () => null },
      eventModule: { listen: () => { created++; return registration.promise; } },
    });
    if (duringListen) await tick();
    cleanup(); registration.resolve(() => { removed++; }); await tick();
    assert.equal(created, removed, `${file}: leaked a late listener`);
    assert.equal(created, duringListen ? 1 : 0, `${file}: registration count`);
  }
}

// Actual Explorer effect: old folders and old refreshes cannot replace the latest listing.
const callbacks = new Map(), requests = []; let entries;
const browser = {
  addEventListener: (name, cb) => callbacks.set(name, cb),
  removeEventListener: name => callbacks.delete(name),
};
const refresh = effect('components/left/Explorer.tsx', 'const target = norm(folderPath)');
const mount = folderPath => evaluate(`(${refresh})()`, {
  folderPath, window: browser, setRootEntries: value => { entries = value; },
  commands: { listDirectory: () => { const request = deferred(); requests.push(request); return request.promise; } },
});
const closeA = mount('/A');
callbacks.get('fs-refresh')({ detail: { dirPath: '/A' } });
closeA(); const closeB = mount('/B');
requests[2].resolve(['B']); await tick();
requests[0].resolve(['old A']); requests[1].reject(new Error('late A')); await tick();
assert.equal(entries[0], 'B');
callbacks.get('fs-refresh')({ detail: { dirPath: '/B' } });
callbacks.get('fs-refresh')({ detail: { dirPath: '/B' } });
requests[4].resolve(['new B']); await tick(); requests[3].resolve(['old B']); await tick();
assert.equal(entries[0], 'new B'); closeB();

// Actual Diff load effect: equal line counts still refresh text; unchanged polls skip tokenization.
let poll, timer, output, tokenizations = 0, reads = 0, fileText = 'first', failure = false, pendingRead;
const diffCallbacks = new Map();
const diffEffect = effect('components/right/DiffPanel.tsx', 'const load = async');
const cleanupDiff = evaluate(`(${diffEffect})()`, {
  path: '/repo/a.txt', repoRoot: '/repo', rel: 'a.txt', kind: 'untracked', commitHash: undefined,
  dataMode: 'dark', badgeRef: { current: { added: 1, deleted: 0 } },
  DIFF_MAX_CHANGED_LINES: 5000, DIFF_MAX_BYTES: 1_000_000,
  setResult: value => { output = value; },
  commands: { readTextFile: async () => {
    reads++;
    if (pendingRead) return pendingRead.promise;
    if (failure) throw new Error('read failed');
    return fileText;
  } },
  computeUnifiedDiff: (_old, text) => [{ kind: 'add', text, lineNum: 1 }],
  collapseToHunks: rows => rows, getShikiTheme: value => value,
  tokenizeFile: async () => { tokenizations++; return null; },
  document: { visibilityState: 'visible' }, TextEncoder,
  window: {
    setInterval: cb => { poll = cb; return 1; }, clearInterval() {},
    addEventListener: (name, cb) => diffCallbacks.set(name, cb),
    removeEventListener: name => diffCallbacks.delete(name),
  },
  setTimeout: cb => { timer = cb; return 1; }, clearTimeout() { timer = null; },
});
await tick(); assert.equal(output.rows[0].text, 'first');
poll(); await tick(); assert.equal(tokenizations, 2, 'unchanged poll retokenized');
fileText = 'second'; diffCallbacks.get('fs-refresh')({ detail: { dirPath: '/repo' } });
timer(); await tick(); assert.equal(output.rows[0].text, 'second');
assert.equal(tokenizations, 4);
failure = true; poll(); await tick(); assert.equal(output.state, 'error');
failure = false; poll(); await tick(); assert.equal(output.rows[0].text, 'second', 'retry must recover identical text');
fileText = '中'.repeat(400_000); poll(); await tick();
assert.equal(output.state, 'too_large', 'size guard must count UTF-8 bytes');
const largeReads = reads; poll(); await tick();
assert.equal(reads, largeReads, 'do not repeatedly read oversized files on the polling backstop');
fileText = 'second'; diffCallbacks.get('fs-refresh')({ detail: { dirPath: '/repo' } });
timer(); await tick(); assert.equal(output.rows[0].text, 'second');
pendingRead = deferred(); poll(); cleanupDiff();
pendingRead.resolve('late result'); await tick();
assert.equal(output.rows[0].text, 'second');
console.log('OK: background cwd, split ownership, path case, late listeners, Explorer races, and live Diff refresh');

// Every saved launchpad pin must have a visible switch, including Cline.
const centerTree = source('components/center/CenterPanel.tsx');
const pinDeclarations = new Map();
function collectPinDeclarations(node) {
  if (ts.isVariableDeclaration(node)) pinDeclarations.set(node.name.getText(centerTree), node);
  ts.forEachChild(node, collectPinDeclarations);
}
collectPinDeclarations(centerTree);
const pinInitializer = pinDeclarations.get('[pinnedItems, setPinnedItems]').initializer.arguments[0].getText(centerTree);
const validPinKeys = evaluate(pinDeclarations.get('VALID_PIN_KEYS').initializer.getText(centerTree));
let savedPins = JSON.stringify(['agent:cline']);
const pinContext = {
  VALID_PIN_KEYS: validPinKeys,
  localStorage: {
    getItem: () => savedPins,
    setItem: (_key, value) => { savedPins = value; },
  },
};
const loadPins = () => Array.from(evaluate(`(${pinInitializer})()`, pinContext));
assert.deepEqual(loadPins(), ['agent:cline'], 'preserve the existing Cline selection');
assert.equal(savedPins, '["agent:cline"]');
savedPins = JSON.stringify(['agent:vibeid']);
assert.deepEqual(loadPins(), [], 'retired tools must not leave an invisible pin');
assert.equal(savedPins, '[]', 'remove the ghost from storage as well as the counter');
assert.deepEqual(loadPins(), [], 'reloading must keep an intentionally empty selection');

// Compare against the actual rendered catalog so future removals cannot drift.
const aiPins = evaluate(pinDeclarations.get('BUILTIN_AI_CLI_FALLBACK').initializer.getText(centerTree), {
  getToolDisplayName: key => key,
}).map(item => item.key);
const utilityPins = pinDeclarations.get('utilities').initializer.elements.map(item => {
  const key = item.properties.find(property => property.name?.getText(centerTree) === 'key');
  return evaluate(key.initializer.getText(centerTree));
});
const catalogPins = [...aiPins, ...utilityPins];
assert.ok(aiPins.includes('cline'), 'Cline must remain selectable as a launch-only tool');
assert.deepEqual([...validPinKeys].sort(), catalogPins.sort(), 'every valid pin needs a visible switch');

savedPins = JSON.stringify(['agent:cline', 'agent:claude', 'agent:multi-agent', 'agent:four-split']);
let pins = loadPins();
assert.deepEqual(pins, ['agent:cline', 'agent:claude', 'agent:four-split'], 'preserve visible choices and split migration');
const togglePin = evaluate(pinDeclarations.get('togglePin').initializer.getText(centerTree), {
  ...pinContext, MAX_PINS: 6, setPinnedItems: update => { pins = update(pins); },
});
for (const key of catalogPins) {
  if (pins.includes(`agent:${key}`)) togglePin(`agent:${key}`);
}
assert.equal(pins.length, 0, 'turning off every visible switch must produce 0/6');
assert.equal(savedPins, '[]');
assert.deepEqual(loadPins(), [], 'reloading after switching everything off must stay empty');
togglePin('agent:cline');
assert.deepEqual(Array.from(pins), ['agent:cline'], 'Cline can be pinned again');
togglePin('agent:cline');
assert.equal(pins.length, 0, 'Cline can be switched off again');
for (const key of catalogPins.slice(0, 7)) togglePin(`agent:${key}`);
assert.equal(pins.length, 6, 'all six slots must be usable while the cap remains enforced');
console.log('OK: Cline selection and toggling, retired pins, catalog consistency, persisted zero count, migration, and six-slot limit');

// Exercise the actual tool-card handler: folder selection launches the chosen tool.
const manualLaunches = [];
const selectTool = evaluate(pinDeclarations.get('selectTool').initializer.getText(centerTree), {
  activeTerminalId: 'launchpad', dispatch: action => manualLaunches.push(action),
  setLastCwdByTool() {}, pushRecentFolder() {},
});
selectTool('claude', undefined, 'E:\\tmp');
assert.equal(manualLaunches.length, 1);
assert.equal(manualLaunches[0].type, 'LAUNCH_TERMINAL_TOOL');
assert.equal(manualLaunches[0].id, 'launchpad');
assert.equal(manualLaunches[0].tool, 'claude');
assert.equal(manualLaunches[0].cwd, 'E:\\tmp');
console.log('OK: actual tool-card folder selection launches the chosen tool');

// Exercise the actual history list: mixed timestamp formats sort newest first,
// and a history-card click resumes a real CLI tab.
{
  const tree = source('components/right/HistoryBoard.tsx');
  let handler, filter, merge;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleViewHistory') handler = node.initializer.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'matchedSessions') filter = node.initializer.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'baseSessions') merge = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(handler); assert.ok(filter); assert.ok(merge);
  const newest = Date.UTC(2026, 9, 10, 13, 15);
  const nativeSessions = Array.from({ length: 35 }, (_, index) => ({
    id: `native-${index}`, name: `CLI history ${index}`, tool: 'claude', cwd: 'E:\\tmp',
    session_token: `resume-${index}`, saved_at: String(newest - (index + 1) * 60_000),
  }));
  nativeSessions.push(
    { ...nativeSessions[0], id: 'native-seconds', saved_at: String((newest - 36 * 60_000) / 1000) },
    { ...nativeSessions[0], id: 'native-iso', saved_at: new Date(newest - 37 * 60_000).toISOString() },
  );
  const sortByMtime = evaluate(`${declaration('lib/history-cache.ts', 'savedAtMs').replace(/^export\s+/, '')}\n${declaration('lib/history-cache.ts', 'sortByMtime').replace(/^export\s+/, '')}; sortByMtime`);
  const merged = evaluate(merge, { useMemo: callback => callback(), nativeSessions: [...nativeSessions].reverse(), sortByMtime });
  assert.equal(merged[0].id, 'native-0');
  assert.deepEqual(Array.from(merged.slice(-2), session => session.id), ['native-seconds', 'native-iso']);
  const allHistories = evaluate(filter, {
    useMemo: callback => callback(), baseSessions: merged, hidden: new Set(), pinned: new Set(),
    activeProject: null, debouncedQuery: '', renamed: {}, autoNamed: {}, autoNameOn: true,
    projectName: () => '', getToolName: tool => tool,
  });
  assert.equal(allHistories.length, 37);
  const actions = [];
  const click = evaluate(`const click = ${handler}; click`, {
    dispatch: action => actions.push(action), crypto: { randomUUID: () => 'native-tab' },
  });
  click({ id: 'claude-history', tool: 'claude', cwd: 'E:\\tmp', session_token: 'native-resume' });
  assert.deepEqual(actions.map(action => action.type), ['ADD_TERMINAL', 'SET_ACTIVE_TERMINAL']);
  console.log('OK: mixed timestamps sort newest first and history clicks resume a real CLI tab');
}
