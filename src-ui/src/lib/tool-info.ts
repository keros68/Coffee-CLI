// Cached frontend mirror of the Rust tool registry (src/tools/).
//
// Loaded exactly once via `list_tools` IPC during App boot, then read
// synchronously by every component that needs a display name for a
// tool id (launchpad cards, tab labels, picker options, history rows,
// session titles). Replaces the five hardcoded `id → label` tables
// that used to live in CenterPanel / FourSplitGrid / MultiAgentGrid /
// TierTerminal / HistoryBoard.
//
// Until the load resolves, `getToolDisplayName(id)` falls back to the
// id itself — visible during the ~ms window between mount and IPC
// response. Components rendered after `loadToolInfo()` resolves see
// the canonical display name.
//
// Pseudo-tools not in the registry (`terminal`, `remote`) get the
// fallback path: callers either special-case them or pass through
// the id. Don't add them to the Rust registry — they don't have a
// binary to probe and don't need hook installation.

import { commands } from '../tauri';

interface ToolInfo {
  id: string;
  displayName: string;
  resumeProgram?: string | null;
  resumeArgsBefore?: string[];
}

export interface ToolResumeShape {
  program: string;
  argsBefore: string[];
}

interface CachedToolEntry {
  displayName: string;
  resume: ToolResumeShape | null;
}

let cache: Map<string, CachedToolEntry> | null = null;
let pending: Promise<void> | null = null;

export async function loadToolInfo(): Promise<void> {
  if (cache) return;
  if (pending) return pending;
  pending = (async () => {
    try {
      const tools: ToolInfo[] = await commands.listTools();
      cache = new Map(
        tools.map((t) => [
          t.id,
          {
            displayName: t.displayName,
            resume: t.resumeProgram
              ? { program: t.resumeProgram, argsBefore: t.resumeArgsBefore ?? [] }
              : null,
          },
        ]),
      );
    } catch (e) {
      // IPC failure shouldn't block app boot — components will just
      // see fallback labels/shapes until a later retry. Log and move on.
      console.warn('[tool-info] list_tools IPC failed:', e);
      cache = new Map();
    }
  })();
  return pending;
}

export function getToolDisplayName(id: string): string {
  return cache?.get(id)?.displayName ?? id;
}

/** Returns the registry-backed CLI resume shape when `list_tools` has loaded,
 *  `null` when the registered tool has no CLI resume support, or `undefined`
 *  before the boot IPC resolves (or for unregistered tool ids). */
export function getToolResumeShape(id: string): ToolResumeShape | null | undefined {
  if (!cache || !cache.has(id)) return undefined;
  return cache.get(id)!.resume;
}
