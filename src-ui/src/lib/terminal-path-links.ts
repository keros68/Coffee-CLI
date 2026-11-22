// terminal-path-links.ts — file paths printed in a terminal, made clickable.
//
// A line is cut into tokens at whitespace, quotes, brackets and CJK
// punctuation; tokens that look like paths become candidates, and only the
// ones the backend finds on disk are linked. The existence check is what makes
// loose matching safe: a wrong guess is simply not underlined. Quoted/backticked
// paths and drive-letter paths (e.g. `D:/.../Coffee CLI_3.6.6_x64-setup.exe`)
// can also span spaces.

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
const QUOTED_RE = /(["'`])([^"'`\r\n]{3,400})\1/g;
const DRIVE_PATH_START_RE = /[A-Za-z]:[\\/][^\s"'`<>|*?()[\]{}，。：；！？、“”‘’（）【】《》─-╿]+/g;
const SPACED_TAIL_STOP_RE = /["'`<>|*?()[\]{}，。：；！？、“”‘’（）【】《》─-╿\r\n]/;
const LINE_SUFFIX_RE = /(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/;
const EXTENSION_RE = /\.\w*[A-Za-z]\w*$/;
const MAX_PATH_LENGTH = 400;
const MAX_SPACED_WORDS = 6;

function normalizeCandidate(raw: string, baseIndex: number): PathCandidate | null {
  if (raw.includes('://')) return null;
  // `@src/a.ts` is Claude Code's file reference; `**a.ts**` is bold.
  const lead = /^[@*]+/.exec(raw)?.[0].length ?? 0;
  const token = raw.slice(lead).replace(/[.,;:!*]+$/, '');
  const index = baseIndex + lead;
  const path = token.replace(LINE_SUFFIX_RE, '');
  if (path.length < 3 || path.length > MAX_PATH_LENGTH || path.startsWith('-')) return null;
  const hasSeparator = /[\\/]/.test(path);
  if (!hasSeparator && !EXTENSION_RE.test(path)) return null;
  // Bare `/` or `\` runs and `C:` alone name nothing.
  if (!/[^\\/.:]/.test(path)) return null;
  return { index, length: token.length, path };
}

/** Path-like tokens of one terminal line. URLs are left to the URL matcher. */
export function findPathCandidates(text: string): PathCandidate[] {
  const out: PathCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: PathCandidate | null) => {
    if (!candidate) return;
    const key = `${candidate.index}:${candidate.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  // 1. Quoted / backticked spans that contain spaces and a path separator
  //    (e.g. `"C:\Program Files\Git\bin\git.exe"` or `` `D:/a/Coffee CLI.exe` ``).
  QUOTED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTED_RE.exec(text)) !== null) {
    const inner = m[2];
    if (!/\s/.test(inner) || !/[\\/]/.test(inner)) continue;
    const trimmedLead = /^\s+/.exec(inner)?.[0].length ?? 0;
    const trimmed = inner.trim();
    push(normalizeCandidate(trimmed, m.index + 1 + trimmedLead));
  }

  // 2. Unquoted Windows drive-letter paths that contain spaces
  //    (e.g. `D:/work/.../Coffee CLI_3.6.6_x64-setup.exe`). We generate up to
  //    MAX_SPACED_WORDS progressive extensions ending at a token with an
  //    extension; the backend existence check discards any false guesses.
  DRIVE_PATH_START_RE.lastIndex = 0;
  while ((m = DRIVE_PATH_START_RE.exec(text)) !== null) {
    // Must not sit inside a URL (`file:///D:/...`) or middle of an identifier.
    if (m.index > 0 && /[A-Za-z0-9_:/\\]/.test(text[m.index - 1])) continue;
    let cursor = m.index + m[0].length;
    for (let w = 1; w <= MAX_SPACED_WORDS && cursor < text.length; w++) {
      if (text[cursor] !== ' ') break;
      const wordStart = cursor + 1;
      if (wordStart >= text.length || text[wordStart] === ' ' || SPACED_TAIL_STOP_RE.test(text[wordStart])) break;
      let wordEnd = wordStart;
      while (wordEnd < text.length && text[wordEnd] !== ' ' && !SPACED_TAIL_STOP_RE.test(text[wordEnd])) {
        wordEnd++;
      }
      if (wordEnd - m.index > MAX_PATH_LENGTH) break;
      const candidateText = text.slice(m.index, wordEnd);
      const cand = normalizeCandidate(candidateText, m.index);
      if (cand && EXTENSION_RE.test(cand.path)) {
        push(cand);
      }
      cursor = wordEnd;
    }
  }

  // 3. Standard single-token candidates (no spaces).
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    push(normalizeCandidate(m[0], m.index));
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
