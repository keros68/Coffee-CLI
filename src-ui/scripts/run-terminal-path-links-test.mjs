// Regression tests for terminal-path-links.ts: which tokens of a terminal line
// become path candidates, and how existence lookups are cached.
//
// Same harness as run-session-autoname-test.mjs: transpile the real source with
// the bundled `typescript` package and run it in a VM with stubbed imports.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const calls = [];
const onDisk = new Set(['src/a.ts', 'README.md']);
const commands = {
  resolveExistingPaths: async (cwd, candidates) => {
    calls.push(plain(candidates));
    return candidates.map(p => (onDisk.has(p) ? `${cwd}\\${p}` : null));
  },
};

const url = fileURLToPath(new URL('../src/lib/terminal-path-links.ts', import.meta.url));
const tree = ts.createSourceFile(url, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
const source = tree.statements
  .filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(tree).replace(/^export /, ''))
  .join('\n');
const lib = runInNewContext(
  ts.transpileModule(`${source}\n;({ findPathCandidates, resolvePathCandidates });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  { console, commands, Date },
);

// Arrays from the VM realm have their own prototype; copy them for deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));
const paths = text => plain(lib.findPathCandidates(text).map(c => c.path));
const spans = text => plain(lib.findPathCandidates(text).map(c => text.slice(c.index, c.index + c.length)));
const resolve = async (dir, list) => plain(await lib.resolvePathCandidates(dir, list));

// ─── candidates ─────────────────────────────────────────────────────────────
assert.deepEqual(paths('Update(src/components/App.tsx)'), ['src/components/App.tsx'], 'tool call brackets');
assert.deepEqual(paths('see src/a.ts:42:7, then'), ['src/a.ts']);
assert.deepEqual(spans('see src/a.ts:42:7, then'), ['src/a.ts:42:7'], 'the line suffix is part of the link');
assert.deepEqual(paths('open `D:\\work\\论文\\草稿.md`。'), ['D:\\work\\论文\\草稿.md'], 'CJK path, backticks, CJK full stop');
assert.deepEqual(paths('写入了 README.md，并且'), ['README.md'], 'bare file name with an extension');
assert.deepEqual(paths('read @src/lib/x.ts'), ['src/lib/x.ts'], 'Claude Code @reference');
assert.deepEqual(paths('**notes/plan.md**'), ['notes/plan.md'], 'markdown bold');
assert.deepEqual(paths('│ src/a.ts │'), ['src/a.ts'], 'box drawing frame');
assert.deepEqual(paths('a.ts#L10-L20'), ['a.ts']);
assert.deepEqual(paths('https://example.com/a.ts'), [], 'URLs are left alone');
assert.deepEqual(paths('v3.6.6 at 12:30 -- --flag=a/b'), [], 'versions, times, flags');
assert.deepEqual(paths('TUI 和 desktop 的 / 区别'), [], 'a lone slash');
assert.deepEqual(paths('Coffee CLI_3.6.6_x64-setup.exe'), ['CLI_3.6.6_x64-setup.exe'], 'unquoted spaces split the path; only a fragment is tried');

// ─── lookups ────────────────────────────────────────────────────────────────
const cwd = 'D:\\p';
assert.deepEqual(await resolve(cwd, ['src/a.ts', 'nope.md']), ['D:\\p\\src/a.ts', null]);
assert.equal(calls.length, 1);
assert.deepEqual(await resolve(cwd, ['src/a.ts', 'nope.md']), ['D:\\p\\src/a.ts', null]);
assert.equal(calls.length, 1, 'cached hits and recent misses skip the backend');
await resolve('D:\\other', ['src/a.ts']);
assert.equal(calls.length, 2, 'the cache is per cwd');
assert.deepEqual(await resolve(cwd, ['README.md', 'README.md']), ['D:\\p\\README.md', 'D:\\p\\README.md']);
assert.deepEqual(calls.at(-1), ['README.md'], 'duplicates are looked up once');

commands.resolveExistingPaths = async () => { throw new Error('offline'); };
assert.deepEqual(await resolve(cwd, ['x/y.ts']), [null], 'a backend failure links nothing');

console.log('terminal path links: all tests passed');
