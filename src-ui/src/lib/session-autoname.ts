// session-autoname.ts — auto-generated session titles (`项目｜目标`).
//
// The session list shows each CLI's own title, which is the first user message
// truncated to 40 chars. Once a few dozen sessions pile up (across several
// tools and projects) those titles stop being tellable apart. This module
// generates a title on its own: project name + a cleaned-up goal phrase.
//
// Trigger and identity are deliberately NOT tied to a terminal tab:
//   • Only 4 of the ~20 supported tools publish live working/idle state
//     (claude / codex / omp via native OSC titles, kimicode via rendered
//     screen), so a tab-status trigger would leave the rest unnamed.
//   • Only claude / hermes can have their session token scraped from PTY
//     output (`session_id_pattern` in terminal.rs) — the rest are matched to
//     history rows through the history reader, which the live tab does not
//     know about.
// Renaming the history row itself needs neither: a row that has gone quiet is
// a finished turn, for every tool alike. A name is written once and then
// frozen (see auto-named-sessions.ts), so the title never drifts while you
// keep working in the session.
//
// What this can and cannot do: the phrase is derived textually — filler
// stripped, cut at a clause boundary. Abstracting "修复写入失败" into the
// enduring goal "草稿写入稳定性" needs semantics, which a rule table cannot
// supply (trying leads to a table of awkward rephrasings). The title therefore
// reads as a cleaned task, not as a goal state. The project prefix is what
// makes a long list scannable; a manual rename covers the rest.

import { isTauri } from '../tauri';
import type { SavedSession } from '../tauri';
import { getHistorySnapshot, savedAtMs, subscribeHistory } from './history-cache';
import { getCustomName } from './renamed-sessions';
import { projectLabel } from './session-groups';
import {
  getAutoName,
  isAutoNameOptedOut,
  setAutoNames,
} from './auto-named-sessions';

/** `cc-*` localStorage preference, default ON — same reader shape notify-sound
 *  uses for its `cc-sound-*` keys. Kept in memory as well so the list can
 *  subscribe to it: turning auto-naming off hides the generated titles
 *  (restoring the CLI's own ones) rather than leaving names on screen that the
 *  switch claims to have stopped. The stored names stay put, so switching it
 *  back on is free. */
export const AUTO_NAME_PREF_KEY = 'cc-auto-name';

let prefEnabled: boolean | null = null;
const prefListeners = new Set<() => void>();

export function autoNameEnabled(): boolean {
  if (prefEnabled === null) {
    try {
      prefEnabled = localStorage.getItem(AUTO_NAME_PREF_KEY) !== 'false';
    } catch {
      prefEnabled = true;
    }
  }
  return prefEnabled;
}

export function setAutoNameEnabled(enabled: boolean): void {
  if (prefEnabled === enabled) return;
  prefEnabled = enabled;
  try {
    localStorage.setItem(AUTO_NAME_PREF_KEY, String(enabled));
  } catch {
    // Best-effort operation; failure is non-fatal.
  }
  for (const listener of prefListeners) listener();
}

/** useSyncExternalStore subscribe (Settings ▸ Sessions toggle, list display). */
export function subscribeAutoNameEnabled(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => { prefListeners.delete(listener); };
}

/** useSyncExternalStore getSnapshot — a primitive, so it only re-renders the
 *  components when the switch actually flips. */
export function getAutoNameEnabledSnapshot(): boolean {
  return autoNameEnabled();
}

/** How long a session must have been quiet before it is considered "first task
 *  finished". The history poll runs every 60s, so a session created now is
 *  named on the next pass after this window — 1–2 minutes. Waiting past the
 *  turn avoids naming a session from a half-typed first message. */
const SETTLE_MS = 60_000;

/** Longest goal phrase, in characters. The card title is a single ellipsized
 *  line, so anything longer is cut by CSS anyway. */
const MAX_PHRASE = 26;

/** Shortest prefix worth cutting at (below this a boundary is too close to the
 *  start to be a real clause break). */
const MIN_PHRASE = 4;

/** Conversational lead-ins stripped before the phrase is kept. Sorted
 *  longest-first so "帮我看看" wins over "帮我". Latin entries are matched
 *  case-insensitively. */
const FILLER_PREFIXES: readonly string[] = [
  '帮我看看', '帮忙看看', '麻烦帮我', '请你帮我',
  '你能不能', '可不可以', '我需要你', '我想让你',
  'i would like you to', "i'd like you to", 'i want you to', 'i need you to',
  'can you please', 'could you please', 'please help me',
  '帮我', '帮忙', '请你', '麻烦你', '麻烦', '我想', '我要', '我需要', '现在', '接下来', '我们来', '让我们',
  '任务：', '需求：', '任务:', '需求:',
  'i would like to', "i'd like to", 'we need to', 'can you', 'could you', 'would you', 'help me',
  'please', 'how do i', 'how can i', 'how to', "let's", 'lets', 'let us',
  '请',
];

/** Injected-context wrappers that survive into the recorded title (the backend
 *  filters whole injected messages, not markers glued onto a real one). */
const INJECTED_MARKERS: readonly RegExp[] = [
  /<[^<>]{1,40}>/g,          // <ide_opened_file>, <command-name>, …
  /\[Image #\d+\]/gi,        // pasted-image marker
  /\[Pasted text #\d+\]/gi,
];

/** Left-side noise: list bullets, quotes, stray punctuation. */
const LEAD_NOISE = /^[\s>#*•·:：,，。."'“‘’”「」『』\-–—]+/;
const TRAIL_NOISE = /[\s,，。.!！?？;；:："'“”‘’「」『』\-–—]+$/;

/** Context pasted in front of a real request: an absolute path (Windows drive /
 *  UNC / POSIX / home / relative) or a URL. Dropped together with the tokens
 *  that continue an already-started path — `C:/Program Files/Git/ai-cross 现在
 *  改成…` keeps only the request. A *relative* path that reads as part of the
 *  sentence ("src-ui/src 的列表…") is left alone: only a leading token with an
 *  absolute/URL prefix starts the strip. */
const LEADING_PATH_TOKEN = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/]|https?:\/\/)\S*/;
const PATH_CONTINUATION = /^(?=[^\s\u3400-\u9fff]*[\\/])\S+$/;

/** A bare path or URL is not a goal — "E:\work\coffeecli" prefixed with the
 *  project name would just repeat it. Sessions titled that way keep their own
 *  title. */
const BARE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/]|https?:\/\/)\S*$/;

/** Titles that are a fragment of injected context rather than something the
 *  user asked for. The backend filters whole injected messages; these survive
 *  as the visible remainder when a tag was glued to the front. */
const INJECTED_PREFIX = /^(caveat:|the messages below|this session is being continued|below is a conversation)/i;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;

function stripFillers(s: string): string {
  let out = s;
  // A message can open with several of these ("麻烦 请你帮我 看一下…"), and a
  // pasted path or URL can sit in front of the real request, so the strip
  // repeats — bounded, since each pass must shorten the string.
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    out = out.replace(LEAD_NOISE, '');

    // Pasted context, token by token: the first token only counts when it has
    // an absolute/URL prefix; after that the rest of that path follows.
    let strippedPath = false;
    for (let i = 0; i < 6; i++) {
      const token = out.split(/\s+/, 1)[0] ?? '';
      if (!LEADING_PATH_TOKEN.test(token) && !(strippedPath && PATH_CONTINUATION.test(token))) break;
      const rest = out.slice(token.length).replace(LEAD_NOISE, '');
      if (rest.length < MIN_PHRASE) break;
      out = rest;
      strippedPath = true;
    }

    const lower = out.toLowerCase();
    for (const filler of FILLER_PREFIXES) {
      if (!lower.startsWith(filler)) continue;
      out = out.slice(filler.length);
      break;
    }
    if (out === before) break;
  }
  return out.replace(LEAD_NOISE, '');
}

/** How far past the length budget a clause break may pull the phrase: keeping
 *  a whole clause is worth a few extra characters (the card ellipsizes
 *  anyway), while a mid-sentence cut is what makes a title unreadable. */
const CUT_LOOKAHEAD = MAX_PHRASE + 8;

/** Cut a long phrase at a break point, so the kept text ends on a clause or a
 *  word rather than mid-token: the first sentence ender, else the last
 *  punctuation break inside the (slightly extended) budget, else the last
 *  space, else a hard cut. A break closer than MIN_PHRASE to the start is
 *  ignored — it would leave a fragment too short to identify anything. */
function cutPhrase(s: string): string {
  const sentenceEnd = s.search(/[。！？!?；;]/);
  if (sentenceEnd >= MIN_PHRASE) return s.slice(0, sentenceEnd);
  if (s.length <= MAX_PHRASE) return s;

  /** Last clause break in the text: comma / enumeration / colon. A colon glued
   *  to a path separator belongs to a path (`E:\work`, `http://…`), not to a
   *  clause. */
  const lastClauseBreak = (text: string): number => {
    let at = -1;
    for (const match of text.matchAll(/[，,、：:]/g)) {
      const index = match.index;
      if ((match[0] === ':' || match[0] === '：') && /[/\\]/.test(text[index + 1] ?? '')) continue;
      at = index;
    }
    return at;
  };

  // Punctuation beats a space: "这个报错：TypeError: x is…" should end at the
  // second colon, and "…记下遥感土地利用交给新会话做，你那边…" at the comma,
  // rather than trailing off wherever a space happens to fall. Hyphens and
  // dashes stay out of the set — they break identifiers (mcp__kimi-cu__list_apps)
  // far more often than they end a clause.
  const punct = lastClauseBreak(s.slice(0, CUT_LOOKAHEAD));
  if (punct >= MIN_PHRASE) return s.slice(0, punct);
  const window = s.slice(0, MAX_PHRASE + 1);
  const space = window.lastIndexOf(' ');
  if (space >= MIN_PHRASE) return s.slice(0, space);
  return s.slice(0, MAX_PHRASE);
}

/** Clean the CLI's own title into a phrase worth putting on a card. Returns
 *  null when nothing usable is left. */
export function goalPhrase(rawTitle: string): string | null {
  let s = (rawTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  for (const marker of INJECTED_MARKERS) s = s.replace(marker, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // The backend appends "..." when it truncated the first message at 40 chars.
  s = s.replace(/\.{2,}$|…$/, '').trim();
  if (INJECTED_PREFIX.test(s)) return null;
  s = stripFillers(s);
  s = s.replace(TRAIL_NOISE, '');
  if (!s) return null;
  if (BARE_PATH.test(s)) return null;
  // Quotes are noise in a title, and a cut can leave one of a pair behind
  // ("PROCESS.md 里我已记下"遥感…" ); drop them all rather than balance them.
  s = cutPhrase(s).replace(/["'“”‘’「」『』]/g, '');
  s = s.replace(/\s+/g, ' ').replace(TRAIL_NOISE, '');
  return s.length >= 2 ? s : null;
}

/** Build the display title for one session: `项目｜目标`. Null when the
 *  session has nothing to work from (no recorded title, or no title beyond a
 *  pasted path). */
export function buildAutoName(session: SavedSession): string | null {
  const phrase = goalPhrase(session.name ?? '');
  if (!phrase) return null;
  const project = projectLabel(session);
  // Already self-describing — don't repeat the folder name in front of it.
  if (!project || phrase.toLowerCase().startsWith(project.toLowerCase())) return phrase;
  const separator = CJK.test(project) || CJK.test(phrase) ? '｜' : ' | ';
  return `${project}${separator}${phrase}`;
}

/** True when this row is ready to be named: quiet long enough to count as a
 *  finished first turn, and neither manually renamed nor opted out. */
function eligible(session: SavedSession, nowMs: number): boolean {
  const tool = session.tool ?? '';
  const id = session.id;
  if (!id || !tool) return false;
  if (getCustomName(tool, id)) return false;      // a manual rename already wins
  if (getAutoName(tool, id)) return false;        // named once, frozen
  if (isAutoNameOptedOut(tool, id)) return false; // user asked for the original
  const savedAt = savedAtMs(session.saved_at);
  if (!savedAt || nowMs - savedAt < SETTLE_MS) return false;
  return !!session.name?.trim();
}

/** Name every eligible session in one pass. Returns how many names were
 *  written. Cheap when there is nothing to do: one already-in-memory scan.
 *  Never throws — a malformed row is skipped. */
export function runAutoNamePass(sessions: SavedSession[], nowMs = Date.now()): number {
  if (!isTauri || !autoNameEnabled()) return 0;
  const pending: Array<[string, string]> = [];
  for (const session of sessions) {
    try {
      if (!eligible(session, nowMs)) continue;
      const name = buildAutoName(session);
      if (!name) continue;
      pending.push([`${session.tool ?? ''}:${session.id}`, name]);
    } catch (err) {
      console.warn('[session-autoname] skipped a session:', err);
    }
  }
  setAutoNames(pending);
  return pending.length;
}

/** Install the pass on the history store. Call once from an always-mounted
 *  component (App.tsx); the history cache only flips to 'ready' once its
 *  prefetch lands, and only for users who opened the History tab. */
export function initSessionAutoName(): () => void {
  if (!isTauri) return () => {};
  const run = () => runAutoNamePass(getHistorySnapshot().sessions);
  const unsubscribe = subscribeHistory(run);
  run();
  return unsubscribe;
}
