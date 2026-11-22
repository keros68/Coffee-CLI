// Regression tests for terminal-url-links.ts: trailing Markdown emphasis and
// punctuation stripping without breaking valid URL characters or CJK stops.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const url = fileURLToPath(new URL('../src/lib/terminal-url-links.ts', import.meta.url));
const tree = ts.createSourceFile(url, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
const source = tree.statements
  .filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(tree).replace(/^export /, ''))
  .join('\n');
const lib = runInNewContext(
  ts.transpileModule(`${source}\n;({ LINK_RE, trimLink });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  {},
);

const plain = value => JSON.parse(JSON.stringify(value));
const urls = text => plain([...text.matchAll(lib.LINK_RE)].map(m => lib.trimLink(m[0])));

assert.deepEqual(urls('**https://a.com/x**'), ['https://a.com/x'], 'trailing bold emphasis stripped');
assert.deepEqual(urls('~~https://a.com/x~~ and __https://a.com/y__'), ['https://a.com/x', 'https://a.com/y'], 'strikethrough and underline emphasis stripped');
assert.deepEqual(urls('(https://a.com/x).'), ['https://a.com/x'], 'trailing parenthesis and period stripped');
assert.deepEqual(urls('https://a.com/a_b'), ['https://a.com/a_b'], 'internal underscore preserved');
assert.deepEqual(urls('https://x.com，看到'), ['https://x.com'], 'stops before CJK punctuation/text');

console.log('terminal url links: all tests passed');
