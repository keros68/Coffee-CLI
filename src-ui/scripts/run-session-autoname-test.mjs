// Regression tests for session-autoname.ts + auto-named-sessions.ts.
//
// Same harness as run-history-cache-test.mjs: transpile the TS sources with the
// bundled `typescript` package and run them in a VM context with stubbed
// globals, so the real store code (not a re-implementation) is what gets
// exercised. The two stores are shared between the contexts through one
// localStorage stub, so persistence semantics are covered too.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const storage = new Map();
const localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

/** Load one module with its imports stripped, returning the listed exports. */
function load(relativePath, globals, exportExpression) {
  const url = fileURLToPath(new URL(relativePath, import.meta.url));
  const tree = ts.createSourceFile(url, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
  const source = tree.statements
    .filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(tree).replace(/^export /, ''))
    .join('\n');
  const code = `${source}\n;(${exportExpression});`;
  return runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { console, localStorage, ...globals },
  );
}

const autoStore = load('../src/lib/auto-named-sessions.ts', {}, `({
  getAutoName, isAutoNameOptedOut, hasAutoName, setAutoName, optOutAutoName,
  setAutoNames, subscribeAutoNamed, getAutoNamedSnapshot,
})`);
const renamedStore = load('../src/lib/renamed-sessions.ts', {}, `({
  setCustomName, getCustomName, getRenamedSnapshot,
})`);
const groups = load('../src/lib/session-groups.ts', {}, '({ projectLabel })');
const autoname = load('../src/lib/session-autoname.ts', {
  isTauri: true,
  projectLabel: groups.projectLabel,
  savedAtMs: value => Date.parse(value),
  getHistorySnapshot: () => ({ sessions: [], status: 'ready' }),
  subscribeHistory: () => () => {},
  getCustomName: renamedStore.getCustomName,
  getAutoName: autoStore.getAutoName,
  isAutoNameOptedOut: autoStore.isAutoNameOptedOut,
  setAutoNames: autoStore.setAutoNames,
}, `({
  goalPhrase, buildAutoName, runAutoNamePass,
  autoNameEnabled, setAutoNameEnabled, AUTO_NAME_PREF_KEY,
})`);

const session = (name, cwd, tool = 'claude', extra = {}) => ({
  id: extra.id ?? '11111111-2222-3333-4444-555555555555',
  name,
  tool,
  cwd,
  session_token: null,
  saved_at: extra.saved_at ?? '2026-05-01T10:00:00.000Z',
  ...extra,
});

/** Windows path separator, spelled out so no string literal has to
 *  escape it (an escaped one reads as an octal escape in strict mode). */
const BS = String.fromCharCode(92);

const NOW = Date.parse('2026-05-01T12:00:00.000Z');

// ─── phrase cleanup ──────────────────────────────────────────────────────────

assert.equal(autoname.goalPhrase('帮我看看这个报错：TypeError: x is undefined'), '这个报错：TypeError');
assert.equal(autoname.goalPhrase('Can you please fix the sidebar rename bug in HistoryBoard?'), 'fix the sidebar rename bug');
assert.equal(autoname.goalPhrase('修一下侧栏会话命名'), '修一下侧栏会话命名');
assert.equal(autoname.goalPhrase('<ide_opened_file>D:\\work\\coffeecli</ide_opened_file> 修复会话列表刷新'), '修复会话列表刷新');
assert.equal(autoname.goalPhrase('Add a session list filter, then wire the empty state'), 'Add a session list filter');
assert.equal(autoname.goalPhrase('给会话列表加分区功能。顺便把右键菜单整理一下'), '给会话列表加分区功能');
assert.equal(autoname.goalPhrase('E:\\work\\coffeecli'), null, 'a bare path is not a goal');
assert.equal(autoname.goalPhrase(''), null);
assert.equal(autoname.goalPhrase('   '), null);
assert.equal(autoname.goalPhrase('帮我'), null, 'nothing left after stripping filler');
// The backend appends "..." when it truncated the first message at 40 chars.
assert.equal(autoname.goalPhrase('重构设置面板为四个 Tab，并且把旧的弹层全部删掉...'), '重构设置面板为四个 Tab，并且把旧的弹层全部删掉');

// Case vectors taken from real session files (see the naming rules' comments):
// a leading path or URL is context, a colon inside a path is not a clause
// break, an identifier's hyphens are not clause breaks either.
assert.equal(
  autoname.goalPhrase('C:/Program Files/Git/ai-cross 这是一次加载测试：只加一行日志'),
  '这是一次加载测试：只加一行日志',
);
assert.equal(autoname.goalPhrase('https://github.com/lovstudio/yoda 看看这个产品'), '看看这个产品');
assert.equal(
  autoname.goalPhrase(`之前你说 需要孙吴逊克的一些垂向数据，E:${BS}25工作${BS}30-生态图谱 -所有调查数据都在里面`),
  '之前你说 需要孙吴逊克的一些垂向数据',
);
assert.equal(
  autoname.goalPhrase('调用 mcp__kimi-cu__list_apps 工具列出正在运行的应用，只看标题'),
  '调用 mcp__kimi-cu__list_apps',
);
assert.equal(autoname.goalPhrase('任务：用 PaddleOCR 把两本扫描版土壤志转成文字'), '用 PaddleOCR 把两本扫描版土壤志转成文字');
// A cut must not leave half of a quote pair behind.
assert.equal(
  autoname.goalPhrase('PROCESS.md 里我已记下"遥感土地利用交给新会话做"，你那边问到瑷珲 2 号了么'),
  'PROCESS.md 里我已记下遥感土地利用交给新会话做',
);
// Context fragments that only survive because a tag was glued to the front.
assert.equal(autoname.goalPhrase('Caveat: The messages below were generated by the user'), null);

// ─── project prefix ──────────────────────────────────────────────────────────

assert.equal(groups.projectLabel(session('x', 'D:\\work\\coffeecli')), 'coffeecli');
assert.equal(groups.projectLabel(session('x', '/home/dev/coffee/')), 'coffee');
assert.equal(groups.projectLabel(session('x', '~', 'hermes')), null, 'hermes has no project');
assert.equal(groups.projectLabel(session('x', `C:${BS}`)), null, 'a drive root is not a project name');
assert.equal(groups.projectLabel(session('x', '~/.openclaw/workspace', 'openclaw')), null);
assert.equal(autoname.buildAutoName(session('修一下侧栏会话命名', 'D:\\work\\coffeecli')), 'coffeecli｜修一下侧栏会话命名');
assert.equal(autoname.buildAutoName(session('fix the sidebar', '/home/dev/tools')), 'tools | fix the sidebar');
// The folder name is already in the title — don't say it twice.
assert.equal(autoname.buildAutoName(session('coffeecli 会话列表分区', 'D:\\work\\coffeecli')), 'coffeecli 会话列表分区');

// ─── pass: eligibility, freeze, opt-out ──────────────────────────────────────

const stale = { saved_at: '2026-05-01T10:00:00.000Z' };   // 2h old → settled
const fresh = { saved_at: '2026-05-01T11:59:45.000Z' };   // 15s old → still in a turn

const rows = [
  session('修一下侧栏会话命名', 'D:\\work\\coffeecli', 'claude', { id: 'a', ...stale }),
  session('顺便把历史列表也整理下', 'D:\\work\\coffeecli', 'codex', { id: 'b', ...fresh }),
  session('改一下构建脚本', 'D:\\work\\coffeecli', 'claude', { id: 'c', ...stale }),
  session('重命名过的手动标题不受影响', 'D:\\work\\coffeecli', 'claude', { id: 'd', ...stale }),
];
renamedStore.setCustomName('claude', 'd', '手动标题');

assert.equal(autoname.runAutoNamePass(rows, NOW), 2, 'names the settled rows only');
assert.equal(autoStore.getAutoName('claude', 'a'), 'coffeecli｜修一下侧栏会话命名');
assert.equal(autoStore.getAutoName('codex', 'b'), undefined, 'a session mid-turn is left alone');
assert.equal(autoStore.getAutoName('claude', 'd'), undefined, 'a manual rename wins over the generated name');

// Frozen: a later pass must not rewrite a name the user has already seen.
renamedStore.setCustomName('claude', 'a', null);
assert.equal(autoname.runAutoNamePass(rows, NOW), 0, 'named sessions are frozen');

// Opt-out keeps the original title even after every guard is satisfied.
autoStore.optOutAutoName('claude', 'c');
assert.equal(autoname.runAutoNamePass([rows[2]], NOW), 0);
assert.equal(autoStore.getAutoName('claude', 'c'), undefined);
assert.equal(autoStore.isAutoNameOptedOut('claude', 'c'), true);

// Pref: off writes nothing, on resumes.
autoname.setAutoNameEnabled(false);
assert.equal(autoname.runAutoNamePass([session('新的任务', 'D:\\work\\coffeecli', 'claude', { id: 'e', ...stale })], NOW), 0);
assert.equal(autoStore.getAutoName('claude', 'e'), undefined);
autoname.setAutoNameEnabled(true);
assert.equal(autoname.runAutoNamePass([session('新的任务', 'D:\\work\\coffeecli', 'claude', { id: 'e', ...stale })], NOW), 1);
assert.equal(autoStore.getAutoName('claude', 'e'), 'coffeecli｜新的任务');

// Bulk write emits once for the whole pass, not once per session.
let emits = 0;
const unsubscribe = autoStore.subscribeAutoNamed(() => { emits += 1; });
autoname.runAutoNamePass([
  session('任务一', 'D:\\work\\coffeecli', 'claude', { id: 'f', ...stale }),
  session('任务二', 'D:\\work\\coffeecli', 'claude', { id: 'g', ...stale }),
], NOW);
unsubscribe();
assert.equal(emits, 1);

// Coverage: one settled session per tool the history scanner emits for the
// four agents in use (Claude Code, Codex, Pi, Kimi Code), named in one pass.
const coverage = ['claude', 'codex', 'pi', 'kimicode'].map(tool =>
  session('修复会话列表刷新', 'D:\\work\\coffeecli', tool, { id: `cover-${tool}`, ...stale }));
assert.equal(autoname.runAutoNamePass(coverage, NOW), 4, 'every tool is named, not only the first one');
for (const row of coverage) {
  assert.equal(autoStore.getAutoName(row.tool, row.id), 'coffeecli｜修复会话列表刷新', row.tool);
}

console.log('session-autoname: all assertions passed');
