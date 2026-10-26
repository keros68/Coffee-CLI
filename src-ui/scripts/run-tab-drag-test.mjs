import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = file => ts.createSourceFile(file,
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const center = source('components/center/CenterPanel.tsx');
const store = source('store/app-state.tsx');
function declaration(tree, name) {
  const node = tree.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Missing actual ${name} declaration`);
  return node.getText(tree).replace(/^export\s+/, '');
}
function callback(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(center) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(center);
  assert.ok(found, `Missing actual ${name} callback`);
  return found.getText(center);
}
const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const stateApi = vm.runInNewContext(compile(`${declaration(store, 'getTabOrder')}; ${declaration(store, 'reducer')}; ({ getTabOrder, reducer });`), {
  localStorage: { setItem() {}, removeItem() {} }, crypto: { randomUUID: () => 'replacement-terminal' },
  supportsAgentStatus: () => true,
});
const native = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log(`  ok  ${name}`); }

// Check the rendered terminal tab uses the tested pointer and click handlers,
// rather than exercising detached copies of dead callbacks.
const renderedTabs = [];
function inspect(node) {
  if (ts.isJsxOpeningElement(node)) {
    const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
    if (attrs.some(attr => attr.name.getText(center) === 'data-tab-id')) {
      renderedTabs.push(Object.fromEntries(attrs.map(attr => [attr.name.getText(center), attr.initializer?.getText(center)])));
    }
  }
  ts.forEachChild(node, inspect);
}
inspect(center);
assert.equal(renderedTabs.length, 1, 'Terminal tabs render one shared draggable tab');
for (const tab of renderedTabs) {
  assert.match(tab.onPointerDown, /onTabPointerDown/);
  assert.match(tab.onClick, /onTabClickGuarded/);
}

function fixture(order = ['one', 'two', 'three']) {
  let state = {
    terminals: order.map(id => ({ id, tool: 'claude', folderPath: `E:\\${id}` })),
    tabOrder: order, activeTerminalId: 'one', diffTabActive: false,
  };
  const listeners = new Map(), actions = [], dragFrames = [];
  const dispatch = action => { actions.push(native(action)); state = stateApi.reducer(state, action); };
  const visible = () => Array.from(stateApi.getTabOrder(state)).filter(id => {
    const terminal = state.terminals.find(tab => tab.id === id);
    return !terminal || !terminal.isHidden || id === state.activeTerminalId;
  });
  const context = {
    dispatch, tabDrag: null, tabDragSuppressClickRef: { current: false },
    tabsHeaderRef: { current: { querySelectorAll(selector) {
      assert.equal(selector, '.chrome-tab[data-tab-id]');
      return visible().map((id, index) => ({ dataset: { tabId: id }, getBoundingClientRect: () => ({ left: index * 100, width: 100 }) }));
    } } },
    setTabDrag(value) { context.tabDrag = value; dragFrames.push(native(value)); },
    document: {
      addEventListener(name, handler) { assert.ok(!listeners.has(name)); listeners.set(name, handler); },
      removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); },
    },
  };
  const api = vm.runInNewContext(compile(`const onTabPointerDown = ${callback('onTabPointerDown')}; const onTabClickGuarded = ${callback('onTabClickGuarded')}; const getTabDragStyle = ${callback('getTabDragStyle')}; ({ onTabPointerDown, onTabClickGuarded, getTabDragStyle });`), context);
  const centerX = id => visible().indexOf(id) * 100 + 50;
  function down(id, options = {}) {
    api.onTabPointerDown({ button: options.button ?? 0, clientX: centerX(id), target: { closest: selector => options.close && selector === '.tab-close-btn' ? {} : null } }, id);
  }
  function move(x) { listeners.get('pointermove')?.({ clientX: x }); }
  function up(x) { listeners.get('pointerup')?.({ clientX: x }); }
  return { api, actions, dragFrames, listeners, visible, down, move, up, centerX,
    get state() { return state; }, dispatch };
}

test('dragging a tab left reorders without changing the focused terminal', () => {
  const f = fixture();
  f.down('three'); f.move(-50);
  assert.equal(f.dragFrames.at(-1).tabId, 'three');
  assert.deepEqual(native(f.api.getTabDragStyle('one', 0)), { transform: 'translateX(100px)' });
  f.up(-50);
  assert.deepEqual(f.actions, [{ type: 'REORDER_TAB', tabId: 'three', beforeId: 'one' }]);
  assert.deepEqual(f.visible(), ['three', 'one', 'two']);
  assert.equal(f.state.activeTerminalId, 'one');
  assert.equal(f.listeners.size, 0); assert.equal(f.dragFrames.at(-1), null);
});

test('dragging right to the end keeps real terminal objects in the new order', () => {
  const f = fixture();
  const original = [...f.state.terminals];
  f.down('one'); f.move(500);
  assert.deepEqual(native(f.api.getTabDragStyle('two', 1)), { transform: 'translateX(-100px)' });
  f.up(500);
  assert.deepEqual(f.actions, [{ type: 'REORDER_TAB', tabId: 'one', beforeId: null }]);
  assert.deepEqual(f.visible(), ['two', 'three', 'one']);
  assert.equal(f.state.terminals[2], original[0]);
  assert.equal(f.state.activeTerminalId, 'one');
});

test('the click generated after dragging never activates the dropped tab', () => {
  const f = fixture();
  f.down('two'); f.move(-50); f.up(-50);
  f.api.onTabClickGuarded('two');
  assert.equal(f.actions.length, 1); assert.equal(f.state.activeTerminalId, 'one');
  f.api.onTabClickGuarded('two');
  assert.deepEqual(f.actions.at(-1), { type: 'SET_ACTIVE_TERMINAL', id: 'two' });
  assert.equal(f.state.activeTerminalId, 'two');
});

test('a normal click remains a click below the drag threshold', () => {
  const f = fixture(); const x = f.centerX('two');
  f.down('two'); f.move(x + 4); f.up(x + 4); f.api.onTabClickGuarded('two');
  assert.deepEqual(f.actions, [{ type: 'SET_ACTIVE_TERMINAL', id: 'two' }]);
  assert.equal(f.listeners.size, 0);
});

test('close buttons and non-primary buttons do not start dragging', () => {
  const f = fixture();
  f.down('two', { close: true });
  for (const button of [1, 2]) f.down('two', { button });
  assert.equal(f.listeners.size, 0); assert.equal(f.actions.length, 0);
});

test('hidden terminals retain their lifecycle and are excluded from drag geometry', () => {
  const f = fixture();
  f.dispatch({ type: 'SET_TERMINAL_HIDDEN', id: 'two', isHidden: true });
  f.actions.length = 0;
  f.down('three'); f.move(-100); f.up(-100);
  assert.deepEqual(f.visible(), ['three', 'one']);
  assert.deepEqual(Array.from(stateApi.getTabOrder(f.state)), ['three', 'one', 'two']);
  assert.equal(f.state.terminals.find(tab => tab.id === 'two').isHidden, true);
});

test('new launch and terminal restart preserve the remaining order', () => {
  const f = fixture(['two', 'one', 'three']);
  f.dispatch({ type: 'LAUNCH_TERMINAL_TOOL', id: 'four', tool: 'claude', cwd: 'E:\\four' });
  f.dispatch({ type: 'RESTART_TERMINAL', id: 'one', newId: 'one-new' });
  assert.deepEqual(f.visible(), ['two', 'one-new', 'three', 'four']);
  assert.equal(new Set(f.visible()).size, f.visible().length);
});

console.log(`\n${passed} shared tab pointer-drag tests passed.`);
