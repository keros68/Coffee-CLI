// Regression tests for terminal-url-links.ts: trailing Markdown emphasis and
// punctuation stripping without breaking valid URL characters or CJK stops,
// plus OSC 8 hyperlink parsing (`file:///` decoding and unsafe-scheme filtering).

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
  ts.transpileModule(`${source}\n;({ LINK_RE, trimLink, parseOsc8Link });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  { URL, decodeURIComponent },
);

const plain = value => JSON.parse(JSON.stringify(value));
const urls = text => plain([...text.matchAll(lib.LINK_RE)].map(m => lib.trimLink(m[0])));

assert.deepEqual(urls('**https://a.com/x**'), ['https://a.com/x'], 'trailing bold emphasis stripped');
assert.deepEqual(urls('~~https://a.com/x~~ and __https://a.com/y__'), ['https://a.com/x', 'https://a.com/y'], 'strikethrough and underline emphasis stripped');
assert.deepEqual(urls('(https://a.com/x).'), ['https://a.com/x'], 'trailing parenthesis and period stripped');
assert.deepEqual(urls('https://a.com/a_b'), ['https://a.com/a_b'], 'internal underscore preserved');
assert.deepEqual(urls('https://x.com，看到'), ['https://x.com'], 'stops before CJK punctuation/text');

assert.deepEqual(
  plain(lib.parseOsc8Link('file:///D:/work/coffeecli-up/target/release/bundle/nsis/Coffee%20CLI_3.6.6_x64-setup.exe')),
  {
    target: 'file:///D:/work/coffeecli-up/target/release/bundle/nsis/Coffee%20CLI_3.6.6_x64-setup.exe',
    localPath: 'D:\\work\\coffeecli-up\\target\\release\\bundle\\nsis\\Coffee CLI_3.6.6_x64-setup.exe',
  },
  'OSC 8 file:/// URI with %20 decodes to native Windows path',
);
assert.deepEqual(
  plain(lib.parseOsc8Link('file:///D:/work/coffeecli-up/src/server.rs#L10-L20')),
  {
    target: 'file:///D:/work/coffeecli-up/src/server.rs#L10-L20',
    localPath: 'D:\\work\\coffeecli-up\\src\\server.rs',
  },
  'OSC 8 file:/// URI strips #L fragment from localPath',
);
assert.deepEqual(
  plain(lib.parseOsc8Link('https://github.com/edison7009/Coffee-CLI')),
  {
    target: 'https://github.com/edison7009/Coffee-CLI',
    localPath: null,
  },
  'OSC 8 https link passes through',
);
assert.equal(lib.parseOsc8Link('javascript:alert(1)'), null, 'unsafe OSC 8 schemes are rejected');

console.log('terminal url links: all tests passed');
