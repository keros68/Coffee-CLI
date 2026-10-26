// terminal-path-links.ts — file paths printed in a terminal, made clickable.
//
// A line is cut into tokens at whitespace, quotes, brackets and CJK
// punctuation; tokens that look like paths become candidates, and only the
// ones the backend finds on disk are linked. The existence check is what makes
// loose matching safe: a wrong guess is simply not underlined. Paths with
// unquoted spaces split into several tokens and are not matched.

import { commands } from '../tauri';

export interface PathCandidate {
  /** Offset of the path in the line text. */
  index: number;
  /** Length of the path text, line suffix included (`a.ts:42`). */
  length: number;
  /** The path to look up, without the line suffix. */
  path: string;
}

// Box-drawing characters frame TUI panels and sit right against paths.
const TOKEN_RE = /[^\s"'`<>|*?()[\]{}，。：；！？、“”‘’（）【】《》─-╿]+/g;
const LINE_SUFFIX_RE = /(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/;
const EXTENSION_RE = /\.\w*[A-Za-z]\w*$/;
const MAX_PATH_LENGTH = 400;

/** Path-like tokens of one terminal line. URLs are left to the URL matcher. */
export function findPathCandidates(text: string): PathCandidate[] {
  const out: PathCandidate[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    let token = m[0];
    let index = m.index;
    if (token.includes('://')) continue;
    // `@src/a.ts` is Claude Code's file reference; `**a.ts**` is bold.
    const lead = /^[@*]+/.exec(token)?.[0].length ?? 0;
    token = token.slice(lead).replace(/[.,;:!*]+$/, '');
    index += lead;
    const path = token.replace(LINE_SUFFIX_RE, '');
    if (path.length < 3 || path.length > MAX_PATH_LENGTH || path.startsWith('-')) continue;
    const hasSeparator = /[\\/]/.test(path);
    if (!hasSeparator && !EXTENSION_RE.test(path)) continue;
    // Bare `/` or `\` runs and `C:` alone name nothing.
    if (!/[^\\/.:]/.test(path)) continue;
    out.push({ index, length: token.length, path });
  }
  return out;
}

// Files appear while an agent works, so a miss is only trusted briefly.
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 3_000;
const CACHE_LIMIT = 2_000;
const cache = new Map<string, { resolved: string | null; at: number }>();

/** Absolute path for each candidate that exists, null for the rest. */
export async function resolvePathCandidates(
  cwd: string | null | undefined,
  paths: string[],
): Promise<(string | null)[]> {
  const now = Date.now();
  const keyOf = (p: string) => `${cwd ?? ''}\n${p}`;
  const fresh = (p: string) => {
    const hit = cache.get(keyOf(p));
    if (!hit) return false;
    return now - hit.at < (hit.resolved ? HIT_TTL_MS : MISS_TTL_MS);
  };
  const missing = [...new Set(paths.filter(p => !fresh(p)))];
  if (missing.length) {
    let resolved: (string | null)[];
    try {
      resolved = await commands.resolveExistingPaths(cwd ?? null, missing);
    } catch {
      resolved = missing.map(() => null);
    }
    // Simple size cap: drop everything once it grows past the limit.
    if (cache.size > CACHE_LIMIT) cache.clear();
    missing.forEach((p, i) => cache.set(keyOf(p), { resolved: resolved[i] ?? null, at: now }));
  }
  return paths.map(p => cache.get(keyOf(p))?.resolved ?? null);
}
