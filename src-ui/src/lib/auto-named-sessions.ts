// Auto-named sessions — localStorage-backed table of Coffee-generated titles.
//
// Third layer in the session-title stack, next to renamed-sessions.ts (manual
// override) and the CLI's own title that the history scanner derives from the
// session's first user message:
//
//   manual rename  >  auto name  >  the CLI's own title
//
// A separate table (instead of writing auto names into renamed-sessions) keeps
// the two lifetimes apart: a manual rename is a user decision that no later
// pass may overwrite, while an auto name is a guess that can be regenerated.
//
// Value semantics:
//   '<name>'  — Coffee-generated title for this session.
//   ''        — explicit opt-out: the user asked for the original title, so
//               every later auto-name pass must leave this session alone.
//
// Keyed `${tool}:${id}` like pinned/hidden/renamed, which is what makes this
// work for all tools: nothing here depends on a specific agent's capabilities.
// Like the other markers, this never writes into the CLI's own session files.
//
// External-store shape mirrors renamed-sessions.ts so HistoryBoard subscribes
// via useSyncExternalStore and re-renders the instant names land.

const STORAGE_KEY = 'coffee:auto-named-sessions';

let names: Record<string, string> = load();
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      // '' is the opt-out sentinel — it must survive the round trip.
      if (typeof v === 'string' && (v === '' || v.trim())) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // quota exceeded / localStorage disabled — names stay in-memory for this session
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function key(tool: string, id: string): string {
  return `${tool}:${id}`;
}

/** Generated title, or undefined when this session has none (never named, or
 *  opted out of auto naming). */
export function getAutoName(tool: string, id: string): string | undefined {
  const v = names[key(tool, id)];
  return v ? v : undefined;
}

/** True when the user asked to keep this session's original title. */
export function isAutoNameOptedOut(tool: string, id: string): boolean {
  return names[key(tool, id)] === '';
}

export function hasAutoName(tool: string, id: string): boolean {
  return getAutoName(tool, id) !== undefined;
}

/** Set a generated title. Empty / whitespace-only clears the entry, so a
 *  later pass is free to name the session again — use optOutAutoName() to keep
 *  a session on its original title for good. */
export function setAutoName(tool: string, id: string, name: string | null): void {
  const trimmed = (name ?? '').trim();
  setAutoNames([[key(tool, id), trimmed || null]]);
}

/** Opt a session out of auto naming and keep its original title. */
export function optOutAutoName(tool: string, id: string): void {
  const k = key(tool, id);
  if (names[k] === '') return;
  setAutoNames([[k, '']]);
}

/** Bulk write — one persist + one emit for a whole pass. Per-session writes
 *  during the first run (an existing list of dozens of sessions) would
 *  otherwise persist and re-render once per session. `null` removes an entry. */
export function setAutoNames(entries: Array<[string, string | null]>): void {
  if (entries.length === 0) return;
  let next: Record<string, string> | null = null;
  for (const [k, v] of entries) {
    const current = next ? (k in next ? next[k] : undefined) : names[k];
    if (v === null ? current === undefined : current === v) continue;
    next ??= { ...names };
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (!next) return;
  names = next;
  persist();
  emit();
}

/** useSyncExternalStore subscribe. */
export function subscribeAutoNamed(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** useSyncExternalStore getSnapshot. Returns a stable reference that only
 *  swaps when names land (immutable update), so React doesn't loop. */
export function getAutoNamedSnapshot(): Record<string, string> {
  return names;
}
