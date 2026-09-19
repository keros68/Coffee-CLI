// Session sections ("分区") — user-defined buckets for the 会话记录 list.
//
// The list is one flat, time-sorted column. Sections let the same sessions be
// read as a few named workstreams instead, which is what makes a long list
// scannable. They are orthogonal to the existing project filter: the filter
// *hides* everything outside one cwd, sections show several workstreams at once
// and can hold sessions from different projects and different tools.
//
// Two membership paths:
//   • explicit — the user moved the session into a section (wins, always);
//   • rule     — the section carries a cwd and new sessions from that project
//                join it automatically. This is the "new sessions land in the
//                right bucket" half of the Codex approach, without needing a
//                hook in any agent: Coffee matches on the cwd it already reads
//                from every session row.
//
// Like pinned/hidden/renamed, this is local per-device metadata keyed
// `${tool}:${id}`; nothing is written into the CLIs' own session files.

import type { SavedSession } from '../tauri';

const STORAGE_KEY = 'coffee:session-groups';

export interface SessionGroup {
  id: string;
  name: string;
  /** Normalized cwd: sessions from this project auto-join the section. */
  cwd?: string;
  collapsed?: boolean;
}

export interface SessionGroupsState {
  groups: SessionGroup[];
  /** `${tool}:${id}` → group id. */
  members: Record<string, string>;
}

let state: SessionGroupsState = load();
const listeners = new Set<() => void>();

function load(): SessionGroupsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { groups: [], members: {} };
    const obj = JSON.parse(raw);
    const groups: SessionGroup[] = Array.isArray(obj?.groups)
      ? obj.groups
          .filter((g: unknown): g is SessionGroup => {
            const candidate = g as SessionGroup;
            return !!candidate && typeof candidate.id === 'string' && typeof candidate.name === 'string' && !!candidate.name.trim();
          })
          .map((g: SessionGroup) => ({
            id: g.id,
            name: g.name,
            ...(typeof g.cwd === 'string' && g.cwd ? { cwd: g.cwd } : {}),
            ...(g.collapsed ? { collapsed: true } : {}),
          }))
      : [];
    const members: Record<string, string> = {};
    const known = new Set(groups.map(g => g.id));
    if (obj?.members && typeof obj.members === 'object' && !Array.isArray(obj.members)) {
      // `''` is the "explicitly ungrouped" sentinel and stays valid. A member
      // pointing at a section that no longer exists is dropped, so a
      // half-written state can never strand a session in a missing bucket.
      for (const [k, v] of Object.entries(obj.members)) {
        if (typeof v === 'string' && (v === '' || known.has(v))) members[k] = v;
      }
    }
    return { groups, members };
  } catch {
    return { groups: [], members: {} };
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded / localStorage disabled — sections stay in-memory for this session
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function commit(next: SessionGroupsState): void {
  state = next;
  persist();
  emit();
}

export function sessionKey(tool: string | null | undefined, id: string): string {
  return `${tool ?? ''}:${id}`;
}

/** Normalize a cwd for rule matching: trailing separators trimmed, slashes
 *  unified. Deliberately not case-folded — Linux paths are case-sensitive. */
export function normalizeCwd(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').replace(/\//g, '\\');
}

export function getGroupsSnapshot(): SessionGroupsState {
  return state;
}

export function subscribeGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function createGroup(name: string, cwd?: string): string {
  const id = (globalThis.crypto?.randomUUID?.() ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const group: SessionGroup = { id, name: name.trim() || 'Section' };
  if (cwd) group.cwd = normalizeCwd(cwd);
  commit({ ...state, groups: [...state.groups, group] });
  return id;
}

export function renameGroup(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!state.groups.some(g => g.id === id && g.name !== trimmed)) return;
  commit({
    ...state,
    groups: state.groups.map(g => (g.id === id ? { ...g, name: trimmed } : g)),
  });
}

/** Delete a section. Its sessions are not touched — they fall back to the
 *  ungrouped bucket (explicit memberships pointing at it are dropped). */
export function deleteGroup(id: string): void {
  if (!state.groups.some(g => g.id === id)) return;
  const members: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.members)) {
    if (v !== id) members[k] = v;
  }
  commit({ groups: state.groups.filter(g => g.id !== id), members });
}

export function setGroupCollapsed(id: string, collapsed: boolean): void {
  if (!state.groups.some(g => g.id === id && !!g.collapsed !== collapsed)) return;
  commit({
    ...state,
    // Rebuilt rather than spread so the persisted shape stays canonical (the
    // `collapsed` key exists only when the section is folded).
    groups: state.groups.map(g => {
      if (g.id !== id) return g;
      const next: SessionGroup = { id: g.id, name: g.name };
      if (g.cwd) next.cwd = g.cwd;
      if (collapsed) next.collapsed = true;
      return next;
    }),
  });
}

/** Set (or clear) a section's auto-assign rule. */
export function setGroupRule(id: string, cwd: string | null): void {
  const next = cwd ? normalizeCwd(cwd) : undefined;
  if (!state.groups.some(g => g.id === id && g.cwd !== next)) return;
  commit({
    ...state,
    groups: state.groups.map(g => {
      if (g.id !== id) return g;
      if (!next) {
        const cleared: SessionGroup = { id: g.id, name: g.name };
        if (g.collapsed) cleared.collapsed = true;
        return cleared;
      }
      return { ...g, cwd: next };
    }),
  });
}

/** Move a session into a section, or keep it out of every section (`null`).
 *  Both directions are explicit and stick: `null` records "ungrouped" rather
 *  than deleting the entry, otherwise a section's cwd rule would immediately
 *  pull the session back in. */
export function assignSession(tool: string | null | undefined, id: string, groupId: string | null): void {
  const k = sessionKey(tool, id);
  if (groupId && !state.groups.some(g => g.id === groupId)) return;
  const next = groupId ?? '';
  if (state.members[k] === next) return;
  commit({ ...state, members: { ...state.members, [k]: next } });
}

/** Which section a session belongs to: an explicit move wins in both
 *  directions, otherwise the first section whose cwd rule covers the session's
 *  project, otherwise none (the ungrouped bucket). Pure — callers pass the
 *  snapshot they render from. */
export function resolveGroupId(
  groups: SessionGroup[],
  members: Record<string, string>,
  session: Pick<SavedSession, 'id' | 'tool' | 'cwd'>,
): string | null {
  const k = sessionKey(session.tool, session.id);
  const explicit = members[k];
  if (explicit !== undefined) return explicit || null;
  const cwd = (session.cwd ?? '').trim();
  if (!cwd) return null;
  const normalized = normalizeCwd(cwd);
  for (const group of groups) {
    if (group.cwd && group.cwd === normalized) return group.id;
  }
  return null;
}

/** Tools whose recorded cwd is an internal folder rather than a project the
 *  user would recognise. */
const CWD_AGNOSTIC_TOOLS = new Set(['openclaw', 'hermes', 'remote']);

/** Project folder name of a session ("coffeecli" from "D:\work\coffeecli").
 *  Null when the session has no project behind it, including a cwd that is a
 *  drive or filesystem root, where the basename ("C:") says nothing. */
export function projectLabel(session: { tool?: string | null; cwd?: string | null }): string | null {
  if (CWD_AGNOSTIC_TOOLS.has(session.tool ?? '')) return null;
  const cwd = (session.cwd ?? '').replace(/[\\/]+$/, '');
  if (!cwd) return null;
  const idx = Math.max(cwd.lastIndexOf('\\'), cwd.lastIndexOf('/'));
  const base = (idx >= 0 ? cwd.slice(idx + 1) : cwd).trim();
  if (!base || /^[a-zA-Z]:$/.test(base) || /^[.~]+$/.test(base) || /^[\\/]+$/.test(base)) return null;
  return base.length > 16 ? base.slice(0, 16) : base;
}

/** Bucket id of the "not in any section" remainder. Never a real group id. */
export const UNGROUPED_ID = '__ungrouped__';

/** Split sessions into the sections they belong to. Section order is the
 *  user's; the ungrouped remainder comes last; empty sections drop out (a
 *  search that matches nothing in a section shouldn't leave a bare header).
 *  Pure — the whole reason this lives here instead of inside the list
 *  component is that it is the part worth testing. */
export function bucketSessions(
  groups: SessionGroup[],
  members: Record<string, string>,
  sessions: SavedSession[],
): Array<{ id: string; group: SessionGroup | null; rows: SavedSession[] }> {
  const buckets = new Map<string, SavedSession[]>(groups.map(g => [g.id, []]));
  const ungrouped: SavedSession[] = [];
  for (const session of sessions) {
    const id = resolveGroupId(groups, members, session);
    const bucket = id ? buckets.get(id) : ungrouped;
    (bucket ?? ungrouped).push(session);
  }
  const out: Array<{ id: string; group: SessionGroup | null; rows: SavedSession[] }> =
    groups.map(g => ({ id: g.id, group: g, rows: buckets.get(g.id) ?? [] }));
  if (ungrouped.length > 0) out.push({ id: UNGROUPED_ID, group: null, rows: ungrouped });
  return out.filter(section => section.rows.length > 0);
}
