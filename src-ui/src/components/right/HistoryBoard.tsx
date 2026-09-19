import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/useT';
import { useAppState, type ToolType } from '../../store/app-state';
import { isTauri } from '../../tauri';
import type { SavedSession } from '../../tauri';
import { getToolDisplayName } from '../../lib/tool-info';
import { useAgentClient, openAgentConversation, refreshAgentConversations } from '../../lib/agent-client';
import {
  prefetchHistory,
  subscribeHistory,
  getHistorySnapshot,
  sortByMtime,
} from '../../lib/history-cache';
import { subscribeHidden, getHiddenSnapshot, hideSession } from '../../lib/hidden-sessions';
import { subscribePinned, getPinnedSnapshot } from '../../lib/pinned-sessions';
import { subscribeRenamed, getRenamedSnapshot, setCustomName } from '../../lib/renamed-sessions';
import {
  subscribeGroups,
  getGroupsSnapshot,
  bucketSessions,
  sessionKey,
  renameGroup,
  deleteGroup,
  setGroupCollapsed,
  setGroupRule,
  type SessionGroup,
} from '../../lib/session-groups';
import { SessionCard, SessionSectionHeader } from './SessionCard';
import { SessionContextMenu, type SessionCtxMenuState } from './SessionContextMenu';
import { useTextContextMenu } from '../../lib/use-text-context-menu';
// hermes/opencode PNG assets live in src/icons-inline/ so the Launchpad
// can `?inline`-import them as data URIs and bypass the <img> async-decode
// flash. We pull the same data URIs here so HistoryBoard doesn't need a
// separate file copy on disk.
import CLAUDE_DATA_URL from '../../icons-inline/claude.svg?inline';
import MIMOCODE_DATA_URL from '../../icons-inline/mimocode.png?inline';
import HERMES_DATA_URL from '../../icons-inline/hermes.png?inline';
import OPENCODE_DATA_URL from '../../icons-inline/opencode.png?inline';
// Kimi Code (PNG squircle) — fixed-color brand mark, ?inline data URI.
import KIMICODE_DATA_URL from '../../icons-inline/kimicode.png?inline';
// Pi is a fixed-color brand mark, rendered as an INLINE SVG so it shares the
// synchronous rendering path used by CenterPanel (?raw + inlineSvgIcon).
import PI_SVG from '../../icons-inline/pi.svg?raw';
import OMP_SVG from '../../icons-inline/omp.svg?raw';
// Grok Build - monochrome currentColor mark rendered inline so it inherits
// the surrounding text color across light/dark themes.
import GROK_SVG from '../../icons-inline/grok.svg?raw';
// OpenClaw (lobster mascot) — full-color brand mark (red gradient + teal
// eyes), NOT currentColor, so it renders as an INLINE SVG rather than <img>;
// inlining shares the same SVG bytes CenterPanel uses, no duplicate file on
// disk. The markup carries its own fills, so it does NOT go through the
// currentColor branch above.
import OPENCLAW_SVG from '../../icons-inline/openclaw.svg?raw';
// CodeBuddy — same full-color inline treatment as OpenClaw (gradient squircle
// with its own fills, no currentColor).
import CODEBUDDY_SVG from '../../icons-inline/codebuddy.svg?raw';
import './HistoryBoard.css';

// Tool icons — codex/qwen load via <img src=public/...>
// because HistoryBoard mounts once at app start and never re-mounts on tab
// switch, so the one-time decode flash is invisible. Other imported assets
// share the same bytes the Launchpad uses (no duplicate files).

const TOOL_ICON_SRC: Record<string, string> = {
  claude:      CLAUDE_DATA_URL,
  codex:       '/icons/tools/codex.svg',
  qwen:        '/icons/tools/qwen.svg',
  antigravity: '/icons/tools/antigravity.svg',
  hermes:      HERMES_DATA_URL,
  opencode:    OPENCODE_DATA_URL,
  kimicode:    KIMICODE_DATA_URL,
  mimocode:    MIMOCODE_DATA_URL,
  kilo:        '/icons/tools/kilo.svg',
};

const getToolIcon = (tool: string) => {
  // Pi is a fixed-color brand mark. Keep it inline so it shares the
  // synchronous rendering path used by the launchpad; other fixed-color
  // brand marks stay <img>.
  if (tool === 'pi' || tool === 'grok' || tool === 'omp') {
    const svg = tool === 'pi' ? PI_SVG : tool === 'omp' ? OMP_SVG : GROK_SVG;
    return (
      <span
        aria-hidden
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1em', height: '1em', flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  // OpenClaw / CodeBuddy are full-color brand marks (lobster gradient; teal →
  // violet squircle) — inline SVG with their own fills, NOT currentColor.
  // Renders as an inline span so the markup's hardcoded colors show verbatim
  // (an <img> would also work, but we reuse the same SVG bytes CenterPanel
  // imports).
  if (tool === 'openclaw' || tool === 'codebuddy') {
    return (
      <span
        aria-hidden
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1em', height: '1em', flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: tool === 'codebuddy' ? CODEBUDDY_SVG : OPENCLAW_SVG }}
      />
    );
  }
  const src = TOOL_ICON_SRC[tool];
  if (!src) return <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 'var(--radius-xs)', background: '#555' }}/>;
  const extra = (tool === 'hermes' || tool === 'opencode' || tool === 'kilo') ? { borderRadius: 'var(--radius-xs)', objectFit: 'cover' as const }
    : tool === 'kimicode' ? { borderRadius: 'var(--radius-xs)', objectFit: 'contain' as const }
    : {};
  return <img src={src} alt="" style={{ width: '1em', height: '1em', flexShrink: 0, objectFit: 'contain', ...extra }}/>;
};

const getToolName = (tool: string) => getToolDisplayName(tool);

// Project folder basename (e.g. "EchoBird" from "E:\EchoBird", "coffee"
// from "~/projects/coffee") — the icon already conveys the tool, so the
// text line earns its keep by showing which project the session belongs
// to. Falls back to the tool name only when cwd wasn't recorded (rare:
// legacy sessions that predate cwd capture, or whose ~/.claude.json
// project entry is gone).
const projectName = (cwd: string, tool: string) => {
  // OpenClaw has no user-project concept — its sessions all carry the same
  // internal `~/.openclaw/workspace` cwd, so the basename would print the
  // meaningless "workspace" on every card. Show the tool name instead,
  // matching the project-filter dropdown that already excludes openclaw
  // (it has no user-project concept). Same story as the launchpad: the row
  // should read "OpenClaw", not a leaked internal folder name.
  if (tool === 'openclaw') {
    return getToolName(tool);
  }
  if (cwd) {
    const trimmed = cwd.replace(/[\\/]+$/, '');
    const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    if (idx >= 0) return trimmed.slice(idx + 1);
    if (trimmed) return trimmed;
  }
  return getToolName(tool);
};

// Normalize a recorded cwd for grouping: trim trailing slashes and unify
// separators. Deliberately NOT case-folded — Linux paths are case-sensitive.
const normCwd = (cwd: string) => cwd.replace(/[\\/]+$/, '').replace(/\//g, '\\');

// Last path segment of either separator flavor.
const pathBasename = (p: string) => {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
};

export function HistoryBoard() {
  const t = useT();
  const { state, dispatch } = useAppState();
  const { conversations, conversationId: activeAgentConversation } = useAgentClient();
  const agentConversations = useMemo(() => conversations.filter(conversation => conversation.messageCount > 0), [conversations]);
  const [agentError, setAgentError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The shared cache restores the previous list before this first render.
  // Opening the panel starts one background scan without hiding cached rows.
  const { sessions: cachedSessions, status } = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistorySnapshot,
  );
  // Soft-delete (hide) markers from localStorage - re-renders the list the
  // instant a user hides a session, no refresh needed.
  const hidden = useSyncExternalStore(subscribeHidden, getHiddenSnapshot);
  // Pinned (置顶) markers from localStorage - re-renders + re-sorts the list
  // the instant a pin toggles from the context menu.
  const pinned = useSyncExternalStore(subscribePinned, getPinnedSnapshot);
  // Custom session titles from localStorage (rename feature) - re-renders
  // the list the instant a rename lands.
  const renamed = useSyncExternalStore(subscribeRenamed, getRenamedSnapshot);
  // Inline-rename editing state: which card is being renamed (`${tool}:${id}`
  // key, null = none) and the draft value.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Escape should cancel (discard) the rename, but unmounting the focused
  // input fires onBlur — which would otherwise commit the draft anyway. This
  // flag is set on Escape so onBlur knows to skip the save. Reset each edit.
  const cancelRenameRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<SessionCtxMenuState | null>(null);
  useEffect(() => { prefetchHistory(); refreshAgentConversations().catch(() => {}); }, []);
  const isLoading = isTauri && (status === 'idle' || status === 'loading') && cachedSessions.length === 0 && agentConversations.length === 0;

  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  // Project (workspace) filter dropdown: which cwd's sessions to show
  // (null = all). The option list is derived from the *visible* (unhidden)
  // data so its counts always match what the list would show.
  const [activeProject, setActiveProject] = useState<string | null>(null);
  // The filter is a themed dropdown (NOT a native <select> — that can't be
  // themed, and can't even open while a terminal is active because the
  // global focus enforcer steals focus back; see FontPicker.tsx). React-
  // state controlled + portaled to body like FontPicker's.
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPos, setFilterMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  const toggleFilterMenu = () => {
    if (filterMenuOpen) { setFilterMenuOpen(false); return; }
    const r = filterTriggerRef.current?.getBoundingClientRect();
    if (r) {
      // Right-align to the trigger — the menu is wider than the button and
      // the trigger hugs the rail's right edge.
      const width = Math.max(r.width, 180);
      setFilterMenuPos({ left: r.right - width, top: r.bottom + 4, width });
    }
    setFilterMenuOpen(true);
  };

  // Keep the portaled menu glued to its trigger on scroll/resize (it's
  // fixed-positioned; same pattern as FontPicker).
  useEffect(() => {
    if (!filterMenuOpen) return;
    const reposition = () => {
      const r = filterTriggerRef.current?.getBoundingClientRect();
      if (r) {
        const width = Math.max(r.width, 180);
        setFilterMenuPos({ left: r.right - width, top: r.bottom + 4, width });
      }
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [filterMenuOpen]);
  // Escape closes the portaled filter menu — same dismissal UX as the right-
  // click menu and the rename input.
  useEffect(() => {
    if (!filterMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilterMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [filterMenuOpen]);
  // Right-click cut/copy/paste/select menu for the search box (same one
  // Gambit/terminal/task-list use).
  const { menu: ctxMenuEl, openMenu: openCtxMenu } = useTextContextMenu();

  // Memoize baseSessions on cachedSessions so the filter useMemo below doesn't
  // re-run every render (the isTauri? ternary otherwise rebuilds a fresh array
  // literal each render, defeating the debounce — a burst of keystrokes would
  // filter the whole list once per render instead of once per debounce tick).
  const nativeSessions: SavedSession[] = useMemo(() => isTauri ? cachedSessions : cachedSessions.length > 0 ? cachedSessions : [
    { id: 'mock-1', name: 'build a flash card website', tool: 'claude', cwd: '~/projects/flashcards', session_token: 'tk1', saved_at: new Date(nowMs).toISOString() },
    { id: 'mock-2', name: 'build a snake game', tool: 'claude', cwd: '~/projects/snake', session_token: 'tk2', saved_at: new Date(nowMs - 3600000).toISOString() },
    { id: 'mock-3', name: 'refactor components', tool: 'qwen', cwd: '~/projects/coffee', session_token: 'tk3', saved_at: new Date(nowMs - 86400000 * 2).toISOString() },
  ], [cachedSessions, nowMs]);
  const baseSessions: SavedSession[] = useMemo(() => sortByMtime([...nativeSessions, ...agentConversations.map(conversation => ({
    id: conversation.id, name: conversation.title, tool: 'coffee-agent', cwd: '', session_token: null,
    saved_at: new Date(conversation.updatedAt).toISOString(), turn_count: conversation.messageCount,
  }))]), [nativeSessions, agentConversations]);

  // Project (workspace) filter: which cwd's sessions to show (null = all).
  // Keyed by normalized cwd (trailing slashes trimmed, separators unified —
  // no case-folding: Linux paths are case-sensitive).
  // OpenClaw is excluded: it has no user-project concept — every session's
  // cwd is its own internal `~/.openclaw/workspace`, so it would form one
  // meaningless bucket that all OpenClaw sessions collapse into. It still
  // shows in the flat list (and under "all"); it just never contributes a
  // selectable project bucket.
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    // Display form of each normalized key: first-seen original cwd wins.
    const display = new Map<string, string>();
    for (const s of baseSessions) {
      if (s.tool === 'openclaw') continue;
      const raw = (s.cwd ?? '').trim();
      if (!raw || hidden.has(`${s.tool ?? ''}:${s.id}`)) continue;
      const key = normCwd(raw);
      if (!display.has(key)) display.set(key, raw.replace(/[\\/]+$/, ''));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, cwd: display.get(key)!, count }))
      .sort((a, b) => b.count - a.count);
  }, [baseSessions, hidden]);

  // Basename collisions (two different parents both named "coffee") get the
  // parent dir appended in the menu label so they're tellable apart.
  const projectLabel = useMemo(() => {
    const baseCount = new Map<string, number>();
    for (const p of projectCounts) {
      const base = pathBasename(p.cwd);
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
    }
    return (cwd: string): string => {
      const base = pathBasename(cwd);
      if ((baseCount.get(base) ?? 0) <= 1) return base;
      const parent = pathBasename(cwd.slice(0, cwd.length - base.length).replace(/[\\/]+$/, ''));
      return parent ? `${base} — ${parent}` : base;
    };
  }, [projectCounts]);

  // Same auto-reset discipline as the agent filter. Also closes the portaled
  // menu if the trigger is about to unmount: soft-deleting sessions down to
  // <2 projects makes projectCounts.length drop below the render threshold,
  // the trigger vanishes, and the fixed-position menu would otherwise strand
  // at stale screen coordinates.
  /* eslint-disable react-hooks/set-state-in-effect -- Invalid filter selections are reset when the available project set changes. */
  useEffect(() => {
    if (projectCounts.length < 2 && agentConversations.length === 0 && filterMenuOpen) {
      setFilterMenuOpen(false);
    }
    if (activeProject && activeProject !== 'coffee-agent' && !projectCounts.some(p => p.key === activeProject)) {
      setActiveProject(null);
    }
  }, [projectCounts, activeProject, filterMenuOpen, agentConversations.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounce the raw query so fast typing doesn't re-filter the full session
  // list on every keystroke (history-cache can hold thousands of sessions —
  // a per-key full scan stutters). 150ms is short enough to feel instant and
  // long enough to coalesce a burst of keystrokes into one filter pass.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(sessionSearchQuery), 150);
    return () => clearTimeout(h);
  }, [sessionSearchQuery]);

  // Normalize once: trim + collapse runs of whitespace + lowercase. Empty after
  // normalization means "no query → show all". Matching against projectName(cwd)
  // too so a user can find a project's sessions by typing its folder name — the
  // folder is already printed on every card, so this is the one search
  // dimension the flat time-sorted list genuinely earns. The tool display name
  // is matched as well ("kimi" surfaces all Kimi Code sessions) — the chip row
  // below covers mouse users, this covers keyboard users. All fields are
  // null-guarded: legacy sessions can carry a blank cwd (projectName then
  // falls back to the tool display name).
  const matchedSessions = useMemo(() => {
    // Hide filter first so soft-deleted sessions never take a visible slot or
    // count toward load-more paging.
    let list = baseSessions;
    if (hidden.size > 0) {
      list = list.filter(s => !hidden.has(`${s.tool ?? ''}:${s.id}`));
    }
    // Project (cwd) filter — AND semantics with the text query below.
    if (activeProject) {
      list = activeProject === 'coffee-agent' ? list.filter(s => s.tool === 'coffee-agent') : list.filter(s => !!s.cwd && normCwd(s.cwd) === activeProject);
    }
    const q = debouncedQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    if (q) {
      list = list.filter(s => {
        const name = (renamed[`${s.tool ?? ''}:${s.id}`] ?? s.name ?? '').toLowerCase();
        const proj = projectName(s.cwd ?? '', s.tool ?? '').toLowerCase();
        const tool = s.tool === 'coffee-agent' ? 'coffee agent' : getToolName(s.tool ?? '').toLowerCase();
        return name.includes(q) || proj.includes(q) || tool.includes(q);
      });
    }
    // Pinned (置顶) sessions sort to the top. history-cache already returns
    // saved_at desc, so a stable sort on the pinned flag keeps that order
    // within each group. Skipped entirely when nothing is pinned.
    if (pinned.size > 0) {
      list = [...list].sort((a, b) => {
        const pa = pinned.has(`${a.tool ?? ''}:${a.id}`) ? 1 : 0;
        const pb = pinned.has(`${b.tool ?? ''}:${b.id}`) ? 1 : 0;
        return pb - pa;
      });
    }
    return list;
  }, [baseSessions, debouncedQuery, hidden, pinned, activeProject, renamed]);

  // Progressive render: data is already fully in memory (history-cache reads
  // every jsonl on startup), so "load more" is just rendering more rows.
  // IntersectionObserver on a bottom sentinel bumps visibleCount when it
  // scrolls into view. Reset to PAGE on the debounced query landing — keying
  // on the raw query would reset mid-burst while results haven't changed yet,
  // making the list flap; the debounced value only moves when results actually
  // change.
  const PAGE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 分区 (sections) — local buckets over the flat list. Nothing renders
  // differently until the user creates one, so an unused feature costs the
  // existing view nothing.
  const { groups, members } = useSyncExternalStore(subscribeGroups, getGroupsSnapshot);
  const sectioned = groups.length > 0;
  // Per-section paging. The flat list auto-loads on scroll (one observer);
  // sections use an explicit "show more" per section instead, so a collapsed
  // or short section can't fire an observer for a list nobody is reading.
  const [visibleBySection, setVisibleBySection] = useState<Record<string, number>>({});
  /* eslint-disable-next-line react-hooks/set-state-in-effect -- A changed query/filter starts a new pagination window. */
  useEffect(() => { setVisibleCount(PAGE); setVisibleBySection({}); }, [debouncedQuery, activeProject]);
  const filteredSessions = matchedSessions.slice(0, visibleCount);
  const hasMore = matchedSessions.length > visibleCount;

  // Bucket the filtered rows. Section order is the user's; empty sections drop
  // out; everything outside a rule/explicit move lands in the ungrouped
  // bucket at the end. See bucketSessions().
  const sections = useMemo(
    () => (sectioned ? bucketSessions(groups, members, matchedSessions) : []),
    [sectioned, groups, members, matchedSessions],
  );

  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupMenu, setGroupMenu] = useState<{ group: SessionGroup; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisibleCount(c => c + PAGE);
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);

  // ── Row rendering (shared by both list shapes) ───────────────────────

  const dateLabel = (session: SavedSession) => {
    // Parse saved_at carefully to handle unix ms strings or invalid SystemTime strings
    let savedMs = Date.parse(session.saved_at);
    if (isNaN(savedMs)) {
      const num = Number(session.saved_at);
      if (!isNaN(num) && num > 0) savedMs = num < 1e11 ? num * 1000 : num;
      else savedMs = nowMs - 86400000;
    }
    const dateDiff = nowMs - savedMs;
    const now = new Date(nowMs);
    const savedDate = new Date(savedMs);

    const isSameDay = now.getDate() === savedDate.getDate() && now.getMonth() === savedDate.getMonth() && now.getFullYear() === savedDate.getFullYear();

    const yesterday = new Date(nowMs - 86400000);
    const isYesterday = yesterday.getDate() === savedDate.getDate() && yesterday.getMonth() === savedDate.getMonth() && yesterday.getFullYear() === savedDate.getFullYear();

    if (dateDiff < 3600000) {
      return t('time.just_now') || 'Just now';
    }
    if (isSameDay) {
      return t('time.today') || 'Today';
    }
    if (isYesterday) {
      return t('time.yesterday') || 'Yesterday';
    }
    const days = Math.floor(dateDiff / 86400000);
    if (days < 7) {
      return (t('time.days_ago') || '{days} days ago').replace('{days}', days.toString());
    }
    const locale = state.currentLang === 'zh-CN' ? 'zh-CN' : 'en-US';
    return savedDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  const renderCard = (session: SavedSession) => {
    const rowKey = sessionKey(session.tool, session.id);
    const messages = session.turn_count
      ? ` · ${(t('task.messages') || '{count} messages').replace('{count}', session.turn_count.toString())}`
      : '';
    // Agent conversations live in the agent service, not on disk — they get
    // no tool icon, a fixed meta label, and no row context menu.
    const isAgent = session.tool === 'coffee-agent';
    return (
      <SessionCard
        key={`${rowKey}:${session.file_path ?? session.saved_at}`}
        hideLabel={t('menu.delete')}
        active={isAgent && session.id === activeAgentConversation && state.agentPageActive === 'agent'}
        displayName={renamed[rowKey] ?? session.name}
        toolIcon={isAgent ? null : getToolIcon(session.tool)}
        metaText={`${isAgent ? 'Coffee Agent' : projectName(session.cwd, session.tool)} · ${dateLabel(session)}${messages}`}
        isRenaming={renamingKey === rowKey}
        renameValue={renameValue}
        onOpen={() => handleViewHistory(session)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isAgent) return;
          setCtxMenu({ session, x: e.clientX, y: e.clientY });
        }}
        onRenameChange={setRenameValue}
        onRenameCommit={() => {
          if (!cancelRenameRef.current) setCustomName(session.tool ?? '', session.id, renameValue);
          cancelRenameRef.current = false;
          setRenamingKey(null);
        }}
        onRenameCancel={() => {
          // Discard: flag the blur handler to skip the save, then unmount
          // (blur fires on the way out).
          cancelRenameRef.current = true;
          setRenamingKey(null);
        }}
        onHide={() => hideSession(session.tool ?? '', session.id)}
      />
    );
  };

  // Enter inline-rename mode on a card (invoked from the context menu).
  const startRename = (saved: SavedSession) => {
    const k = `${saved.tool ?? ''}:${saved.id}`;
    cancelRenameRef.current = false;
    setRenamingKey(k);
    setRenameValue(renamed[k] ?? saved.name ?? '');
  };

  const handleViewHistory = (saved: SavedSession) => {
    if (saved.tool === 'coffee-agent') {
      setAgentError('');
      dispatch({ type: 'OPEN_AGENT_PAGE', page: 'agent' });
      openAgentConversation(saved.id).catch(error => setAgentError(String(error)));
      return;
    }
    // Click = resume directly. The old flow opened an intermediate read-only
    // preview and made the user click "Continue this session"
    // inside it; that intermediate step was slower than just resuming —
    // claude --resume loads its own TUI history faster than the bubble
    // view renders, and the extra tab was one more concept to navigate.
    // Now a click stages a real terminal tab with resumeToken;
    // TierTerminal's mount effect spawns `<tool> --resume <token>` in
    // saved.cwd. Sessions without a token (legacy / unresolved cwd) are
    // silently skipped — nothing to resume.
    if (!saved.session_token) return;
    const targetId = crypto.randomUUID();
    dispatch({
      type: 'ADD_TERMINAL',
      session: { id: targetId, tool: saved.tool as ToolType, folderPath: saved.cwd, resumeToken: saved.session_token }
    });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', id: targetId });
  };

  return (
    <>
      <div className="agent-session-search-row">
        <div className="agent-session-search-wrap">
          <svg className="agent-session-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="agent-session-search"
            placeholder={t('task.search_sessions') || 'Search sessions...'}
            value={sessionSearchQuery}
            onChange={e => setSessionSearchQuery(e.target.value)}
            onContextMenu={(e) => openCtxMenu(e, setSessionSearchQuery)}
          />
        </div>
        {/* Project (workspace) filter dropdown, keyed by normalized cwd.
            Only worth the control when 2+ distinct projects exist. Shows the
            active project's folder icon + name. */}
        {(projectCounts.length >= 2 || agentConversations.length > 0) && (
          <button
            ref={filterTriggerRef}
            type="button"
            className={`history-tool-filter-trigger${activeProject ? ' active' : ''}`}
            onClick={toggleFilterMenu}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="history-tool-filter-label">
              {activeProject === 'coffee-agent' ? 'Coffee Agent' : activeProject
                ? projectLabel(projectCounts.find(p => p.key === activeProject)?.cwd ?? '')
                : (t('task.filter_all_projects') || 'All projects')}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
      {agentError && <p className="agent-feedback error" role="alert">{agentError}</p>}
      <div className="task-list" style={{ marginTop: '0', paddingBottom: '20px' }}>
      {isLoading && Array.from({ length: 6 }).map((_, i) => (
        <div key={`skel-${i}`} className="history-card history-card-skeleton" aria-hidden="true">
          <div className="history-card-content">
            <span className="skeleton-bar skeleton-bar-title" />
            <div className="history-card-meta">
              <span className="skeleton-bar skeleton-bar-meta" />
            </div>
          </div>
        </div>
      ))}
      {/* Sectioned view (分区). Each section pages independently; the header
          collapses it and carries the section menu. */}
      {!isLoading && sectioned && sections.map(section => {
        const limit = visibleBySection[section.id] ?? PAGE;
        const rows = section.rows.slice(0, limit);
        const remaining = section.rows.length - rows.length;
        const collapsed = !!section.group?.collapsed;
        return (
          <div key={section.id} className="history-section">
            <SessionSectionHeader
              name={section.group ? section.group.name : (t('group.ungrouped') || 'Ungrouped')}
              count={section.rows.length}
              collapsed={collapsed}
              menuLabel={t('group.actions') || 'Section actions'}
              isRenaming={!!section.group && renamingGroupId === section.group.id}
              renameValue={groupNameDraft}
              onToggle={() => {
                if (section.group) setGroupCollapsed(section.group.id, !collapsed);
              }}
              onMenu={section.group ? (e) => {
                setRenamingGroupId(null);
                setGroupMenu({ group: section.group!, x: e.clientX, y: e.clientY });
              } : undefined}
              onRenameChange={setGroupNameDraft}
              onRenameCommit={() => {
                if (section.group && groupNameDraft.trim()) renameGroup(section.group.id, groupNameDraft);
                setRenamingGroupId(null);
              }}
              onRenameCancel={() => setRenamingGroupId(null)}
            />
            {!collapsed && rows.map(renderCard)}
            {!collapsed && remaining > 0 && (
              <button
                type="button"
                className="history-section-more"
                onClick={() => setVisibleBySection(v => ({ ...v, [section.id]: limit + PAGE }))}
              >
                {(t('group.show_more') || 'Show more ({count})').replace('{count}', String(remaining))}
              </button>
            )}
          </div>
        );
      })}

      {/* Flat view — unchanged shape for users who never create a section. */}
      {!isLoading && !sectioned && filteredSessions.map(renderCard)}

      {!sectioned && hasMore && (
        <>
          {/* Skeleton placeholders give immediate visual feedback that
           * "more is coming" the moment scroll reaches the end —
           * without them React's brief commit gap reads as "stuck".
           * Sentinel sits at the bottom of the skeleton group so the
           * observer fires while the user is still scrolling through
           * them, by which point the next batch is already rendered. */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`load-skel-${i}`} className="history-card history-card-skeleton" aria-hidden="true">
              <div className="history-card-content">
                <span className="skeleton-bar skeleton-bar-title" />
                <div className="history-card-meta">
                  <span className="skeleton-bar skeleton-bar-meta" />
                </div>
              </div>
            </div>
          ))}
          <div ref={sentinelRef} style={{ height: 1 }} />
        </>
      )}

      {!isLoading && matchedSessions.length === 0 && (
        <div className="task-empty">
          <div className="task-empty-text">{t('menu.no_recent') || 'No recent sessions'}</div>
        </div>
      )}
    </div>

    {/* Section menu (the header's ⋯ button): rename, stop auto-assigning,
        delete. Same .ctx-menu surface as every other right-click menu. */}
    {groupMenu && createPortal(
      <GroupMenu
        menu={groupMenu}
        onClose={() => setGroupMenu(null)}
        onRename={() => {
          setGroupNameDraft(groupMenu.group.name);
          setRenamingGroupId(groupMenu.group.id);
          setGroupMenu(null);
        }}
      />,
      document.body
    )}
    {filterMenuOpen && filterMenuPos && createPortal(
      <>
        <div className="history-tool-filter-backdrop" onClick={() => setFilterMenuOpen(false)} />
        <div
          className="history-tool-filter-menu"
          style={{ position: 'fixed', left: filterMenuPos.left, top: filterMenuPos.top, width: filterMenuPos.width }}
        >
          <button
            type="button"
            className={`history-tool-filter-opt${activeProject === null ? ' active' : ''}`}
            onClick={() => { setActiveProject(null); setFilterMenuOpen(false); }}
          >
            <span className="history-tool-filter-opt-name">{t('task.filter_all_projects') || 'All projects'}</span>
            <span className="history-tool-filter-count">{baseSessions.reduce((n, s) => (hidden.has(`${s.tool ?? ''}:${s.id}`) ? n : n + 1), 0)}</span>
          </button>
          {projectCounts.map((p) => (
            <button
              type="button"
              key={p.key}
              className={`history-tool-filter-opt${activeProject === p.key ? ' active' : ''}`}
              onClick={() => { setActiveProject(activeProject === p.key ? null : p.key); setFilterMenuOpen(false); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="history-tool-filter-opt-name">{projectLabel(p.cwd)}</span>
              <span className="history-tool-filter-count">{p.count}</span>
            </button>
          ))}
          {agentConversations.length > 0 && <button type="button" className={`history-tool-filter-opt${activeProject === 'coffee-agent' ? ' active' : ''}`} onClick={() => { setActiveProject('coffee-agent'); setFilterMenuOpen(false); }}>
            <span className="history-tool-filter-opt-name">Coffee Agent</span>
            <span className="history-tool-filter-count">{baseSessions.filter(s => s.tool === 'coffee-agent' && !hidden.has(`coffee-agent:${s.id}`)).length}</span>
          </button>}
        </div>
      </>,
      document.body
    )}
    {ctxMenu && (
      <SessionContextMenu
        menu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        onRename={startRename}
      />
    )}
    {ctxMenuEl}
  </>
  );
}

/** Section-level menu, opened from a section header's ⋯ button. Deleting a
 *  section never touches the sessions — they fall back to the ungrouped
 *  bucket, which is why this needs no confirmation step. */
function GroupMenu({ menu, onClose, onRename }: {
  menu: { group: SessionGroup; x: number; y: number };
  onClose: () => void;
  onRename: () => void;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const { group } = menu;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const closeKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeKey);
    };
  }, [onClose]);

  const ICON_PROPS = {
    width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };

  const MENU_WIDTH = 220;
  const MENU_HEIGHT = 160;
  const style: React.CSSProperties = {
    position: 'fixed',
    ...(menu.y + MENU_HEIGHT > window.innerHeight
      ? { bottom: Math.max(0, window.innerHeight - menu.y) }
      : { top: menu.y }),
    ...(menu.x + MENU_WIDTH > window.innerWidth
      ? { right: Math.max(0, window.innerWidth - menu.x) }
      : { left: menu.x }),
  };

  return createPortal(
    <div className="ctx-menu" ref={menuRef} style={style}>
      <button className="ctx-menu-item" onClick={onRename}>
        <svg {...ICON_PROPS}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
        {t('group.rename') || 'Rename section'}
      </button>
      {group.cwd && (
        <button
          className="ctx-menu-item"
          onClick={() => { setGroupRule(group.id, null); onClose(); }}
        >
          <svg {...ICON_PROPS}>
            <path d="M4 4h16v5H4z"/><path d="M4 13h10v7H4z"/>
          </svg>
          {t('group.auto_off') || 'Stop auto-assigning'}
        </button>
      )}
      <div className="ctx-menu-divider" />
      <button
        className="ctx-menu-item"
        onClick={() => { deleteGroup(group.id); onClose(); }}
      >
        <svg {...ICON_PROPS}>
          <polyline points="3 6 5 6 21 6"/>
          <path d="m19 6-.867 13.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        {t('group.delete') || 'Delete section'}
      </button>
    </div>,
    document.body,
  );
}
