// Regression tests for session-groups.ts — section storage plus the resolver
// that decides which bucket a session lands in.
//
// Same harness as run-history-cache-test.mjs: the real TS source is transpiled
// and run in a VM context with a localStorage stub, so persistence and the
// load-time repair path are covered, not just the pure functions.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const STORAGE_KEY = 'coffee:session-groups';

/** Load session-groups.ts with a fresh module-level state per call. */
function loadGroups(seed) {
  const storage = new Map();
  if (seed !== undefined) storage.set(STORAGE_KEY, JSON.stringify(seed));
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const file = fileURLToPath(new URL('../src/lib/session-groups.ts', import.meta.url));
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const source = tree.statements
    .filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(tree).replace(/^export /, ''))
    .join('\n');
  const code = `${source}\n;({
    createGroup, renameGroup, deleteGroup, setGroupCollapsed, setGroupRule,
    assignSession, sessionKey, normalizeCwd, resolveGroupId, bucketSessions,
    UNGROUPED_ID, getGroupsSnapshot, subscribeGroups, projectLabel,
  });`;
  const api = runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { console, localStorage },
  );
  return { api, storage, localStorage };
}

const row = (id, cwd, tool = 'claude') => ({ id, tool, cwd });

/** Values cross a VM realm boundary, so their prototypes differ and
 *  deepStrictEqual would reject structurally identical objects. Compare JSON. */
const sameJson = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

// ─── rules: new sessions from a project join the section on their own ────────

{
  const { api, storage } = loadGroups();
  const auth = api.createGroup('认证重构', 'D:\\work\\auth\\');
  const ui = api.createGroup('界面', 'D:\\work\\ui');
  const groups = api.getGroupsSnapshot().groups;
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, '认证重构');
  assert.equal(groups[0].cwd, 'D:\\work\\auth', 'cwd rule is normalized (trailing separator trimmed)');

  // Rule-based membership — nothing was moved, the cwd does the work.
  assert.equal(api.resolveGroupId(groups, {}, row('a', 'D:\\work\\auth')), auth);
  assert.equal(api.resolveGroupId(groups, {}, row('b', 'D:/work/ui/')), ui, 'separators unified');
  assert.equal(api.resolveGroupId(groups, {}, row('c', 'D:\\work\\other')), null);
  assert.equal(api.resolveGroupId(groups, {}, row('d', '')), null);

  // Persisted shape round-trips.
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  sameJson(saved.groups.map(g => g.name), ['认证重构', '界面']);
  sameJson(saved.members, {}, 'rules alone write no membership rows');
}

// ─── explicit moves win in both directions ──────────────────────────────────

{
  const { api } = loadGroups();
  const auth = api.createGroup('认证重构', 'D:\\work\\auth');
  const ui = api.createGroup('界面', 'D:\\work\\ui');
  const groups = api.getGroupsSnapshot().groups;
  const session = row('a', 'D:\\work\\auth');

  // Explicit move out of the rule's section must stick (not bounce back).
  api.assignSession(session.tool, session.id, null);
  assert.equal(api.getGroupsSnapshot().members[api.sessionKey(session.tool, session.id)], '');
  assert.equal(api.resolveGroupId(groups, api.getGroupsSnapshot().members, session), null);

  // Explicit move into a different section beats the rule.
  api.assignSession(session.tool, session.id, ui);
  assert.equal(api.resolveGroupId(groups, api.getGroupsSnapshot().members, session), ui);

  // And back to the rule's own section.
  api.assignSession(session.tool, session.id, auth);
  assert.equal(api.resolveGroupId(groups, api.getGroupsSnapshot().members, session), auth);

  // Moving to a section that does not exist is refused.
  api.assignSession(session.tool, session.id, 'nope');
  assert.equal(api.getGroupsSnapshot().members[api.sessionKey(session.tool, session.id)], auth);
}

// ─── management: rename, collapse, rule off, delete ─────────────────────────

{
  const { api } = loadGroups();
  const group = api.createGroup('临时', 'D:\\work\\tmp');
  const session = row('a', 'D:\\work\\tmp');
  api.assignSession(session.tool, session.id, group);

  api.renameGroup(group, '  定期清理  ');
  assert.equal(api.getGroupsSnapshot().groups[0].name, '定期清理');
  api.renameGroup(group, '   ');
  assert.equal(api.getGroupsSnapshot().groups[0].name, '定期清理', 'a blank rename is ignored');

  api.setGroupCollapsed(group, true);
  assert.equal(api.getGroupsSnapshot().groups[0].collapsed, true);
  api.setGroupCollapsed(group, false);
  assert.equal(api.getGroupsSnapshot().groups[0].collapsed, undefined, 'expanding drops the flag');

  api.setGroupRule(group, null);
  const groups = api.getGroupsSnapshot().groups;
  assert.equal(groups[0].cwd, undefined, 'auto-assign can be switched off');
  // The explicit membership written earlier survives the rule change.
  assert.equal(api.resolveGroupId(groups, api.getGroupsSnapshot().members, session), group);
  // A session that was only covered by the rule no longer resolves.
  assert.equal(api.resolveGroupId(groups, api.getGroupsSnapshot().members, row('b', 'D:\\work\\tmp')), null);

  api.deleteGroup(group);
  sameJson(api.getGroupsSnapshot().groups, []);
  sameJson(api.getGroupsSnapshot().members, {}, 'members of a deleted section are dropped');
}

// ─── load-time repair: a half-written state cannot strand a session ─────────

{
  const { api } = loadGroups({
    groups: [{ id: 'g1', name: '保留' }, { id: 'g2', name: '   ' }],
    members: { 'claude:a': 'g1', 'claude:b': 'ghost', 'claude:c': '' },
  });
  const { groups, members } = api.getGroupsSnapshot();
  sameJson(groups.map(g => g.id), ['g1'], 'a nameless section is dropped');
  sameJson(members, { 'claude:a': 'g1', 'claude:c': '' }, 'members pointing at a missing section are dropped');
}

// ─── one emit per change (the list must not repaint twice) ─────────────────

{
  const { api } = loadGroups();
  let emits = 0;
  const unsubscribe = api.subscribeGroups(() => { emits += 1; });
  const group = api.createGroup('A', 'D:\\work\\a');
  api.assignSession('claude', 'a', group);
  api.setGroupCollapsed(group, true);
  api.deleteGroup(group);
  unsubscribe();
  assert.equal(emits, 4);
}

// ─── bucketing: section order, empty sections, ungrouped last ───────────────

{
  const { api } = loadGroups();
  const auth = api.createGroup('认证重构', 'D:\\work\\auth');
  const ui = api.createGroup('界面', 'D:\\work\\ui');
  api.createGroup('还没内容', 'D:\\work\\nothing');
  api.assignSession('claude', 'x', ui);

  const sessions = [
    row('a', 'D:\\work\\auth'),
    row('b', 'D:\\work\\other', 'codex'),
    row('x', 'D:\\work\\ui'),
    row('c', 'D:\\work\\auth'),
  ];
  const { groups, members } = api.getGroupsSnapshot();
  const buckets = api.bucketSessions(groups, members, sessions);

  sameJson(
    buckets.map(b => b.id),
    [auth, ui, api.UNGROUPED_ID],
    'section order is preserved, the empty section drops out, the remainder lands last',
  );
  sameJson(buckets.find(b => b.id === auth).rows.map(r => r.id), ['a', 'c'], 'rule-matched rows keep list order inside a section');
  sameJson(buckets.find(b => b.id === ui).rows.map(r => r.id), ['x'], 'explicit membership beats the cwd rule');
  sameJson(buckets.find(b => b.id === api.UNGROUPED_ID).rows.map(r => r.id), ['b']);

  // A search that matches nothing in a section must not leave a bare header.
  const kept = api.bucketSessions(groups, members, [row('a', 'D:\\work\\auth'), row('b', 'D:\\work\\other', 'codex')]);
  sameJson(kept.map(b => b.id), [auth, api.UNGROUPED_ID]);

  // No sections at all → a single ungrouped bucket (what the flat list renders).
  const flat = api.bucketSessions([], {}, sessions);
  sameJson(flat.map(b => b.id), [api.UNGROUPED_ID]);
  assert.equal(flat[0].rows.length, 4);
}

// ─── projectLabel: the name a section created from a row starts with ─────────
{
  const { api } = loadGroups();
  assert.equal(api.projectLabel(row('a', 'D:\\work\\coffeecli')), 'coffeecli');
  assert.equal(api.projectLabel(row('a', '/home/u/proj/')), 'proj', 'trailing separators are ignored');
  assert.equal(api.projectLabel(row('a', 'C:\\')), null, 'a drive root names nothing');
  assert.equal(api.projectLabel(row('a', '')), null);
  assert.equal(api.projectLabel(row('a', 'D:\\work\\x', 'hermes')), null, 'hermes has no project behind its cwd');
}

console.log('session-groups: all assertions passed');
