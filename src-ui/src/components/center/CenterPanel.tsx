import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { focusTerminal } from '../../lib/focus-registry';
import { onWindowForeground } from '../../lib/window-focus-filter';
import { TierTerminal } from './TierTerminal';
import { ConversationView } from './ConversationView';
import { FourSplitGrid } from './FourSplitGrid';
import { ToolConfigModal } from './ToolConfigModal';
import { ContributionHeatmap } from './ContributionHeatmap';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { DiffPanel } from '../right/DiffPanel';
import { MarkdownPreview } from './MarkdownPreview';
import { getTabOrder, supportsAgentStatus, useAppState, type ToolType } from '../../store/app-state';
import { isFrostShape } from '../../lib/personalization';
import { supportsConversationTool } from '../../lib/chat-tools';

// Dropdown shown when a tool card's folder icon is clicked: the globally
// recent project folders (any tool that used one) + "Open folder…" last.
// Clicking a recent launches THIS card's tool in that folder; the card body
// click is unchanged (old flow). Portal-rendered with outside-click / Esc to
// close — same pattern as the terminal context menu.
function RecentFolderMenu({ x, y, recent, openLabel, onPick, onRemove, onOpenNew, onClose }: {
  x: number;
  y: number;
  recent: string[];
  openLabel: string;
  onPick: (folder: string) => void;
  onRemove: (folder: string) => void;
  onOpenNew: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Defer so the opening click doesn't immediately close the menu.
    const id = setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 290);
  const top = Math.min(y, window.innerHeight - (recent.length * 40 + 56));
  const split = (p: string) => {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
    const i = norm.lastIndexOf('/');
    return { name: i >= 0 ? norm.slice(i + 1) : norm, parent: i >= 0 ? norm.slice(0, i) : '' };
  };
  const FolderGlyph = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
  const XGlyph = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
  // Same folder body as FolderGlyph + a plus, so "open new" reads as the same
  // family as the recents above it, just clearly the "add another" action.
  const FolderPlusGlyph = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );

  return createPortal(
    <div ref={ref} className="folder-menu" style={{ left, top }}>
      {recent.map(f => {
        const { name, parent } = split(f);
        return (
          <button key={f} className="folder-menu-item" onMouseDown={(e) => { e.preventDefault(); onPick(f); }}>
            {FolderGlyph}
            <span className="folder-menu-name">{name}</span>
            {parent && <span className="folder-menu-path">{parent}</span>}
            <span
              className="folder-menu-del"
              role="button"
              aria-label={`Remove ${name}`}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(f); }}
            >
              {XGlyph}
            </span>
          </button>
        );
      })}
      {recent.length > 0 && <div className="folder-menu-sep" />}
      <button className="folder-menu-item folder-menu-open" onMouseDown={(e) => { e.preventDefault(); onOpenNew(); }}>
        {FolderPlusGlyph}
        <span className="folder-menu-name">{openLabel}</span>
      </button>
    </div>,
    document.body,
  );
}

interface RemoteHistoryItem {
  id: string;
  protocol: 'ssh' | 'ws';
  host: string;
  port: string;
  user: string;
}
import { isTauri, commands } from '../../tauri';
import { getToolDisplayName } from '../../lib/tool-info';
import {
  getToolIcon,
  SvgFourSplit,
  SvgThreeSplit,
  SvgTwoSplit,
  TerminalIcon,
} from '../../lib/tool-icons';
import { useT } from '../../i18n/useT';
import './CenterPanel.css';

export { getToolIcon };

// Coffee 101 card icon — static coffee mark (cup body draws on first paint
// then fills; steam stays still without an indefinite loop). Inlined SVG so
// currentColor follows the theme accent. Sized at 1em so it scales with the
// launchpad card font-size like other utility cards.
//
// Component is named SvgInstaller (not SvgCoffee101) because the launchpad
// card key is `'installer'` — kept that way to preserve users' existing
// localStorage pin state (`coffee_pinned_items` may contain "agent:installer").
// The card itself is no longer a one-click installer (that approach was
// abandoned, see the click handler comment); it now opens the Coffee 101
// course on coffeecli.com.
const SvgInstaller = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    style={{ flexShrink: 0, color: 'var(--accent)' }}
  >
    <defs>
      <mask id="coffee101IconMask">
        <path
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M8 -8c0 2 -2 2 -2 4s2 2 2 4s-2 2 -2 4s2 2 2 4M12 -8c0 2 -2 2 -2 4s2 2 2 4s-2 2 -2 4s2 2 2 4M16 -8c0 2 -2 2 -2 4s2 2 2 4s-2 2 -2 4s2 2 2 4"
        />
        <path d="M4 7h16v0h-16v12h16v-32h-16Z">
          <animate
            fill="freeze"
            attributeName="d"
            begin="1s"
            dur="0.6s"
            to="M4 2h16v5h-16v12h16v-24h-16Z"
          />
        </path>
      </mask>
    </defs>
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path
        fill="currentColor"
        fillOpacity="0"
        strokeDasharray="48"
        d="M17 9v9c0 1.66 -1.34 3 -3 3h-6c-1.66 0 -3 -1.34 -3 -3v-9Z"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="48;0" />
        <animate fill="freeze" attributeName="fill-opacity" begin="1.6s" dur="0.4s" to="1" />
      </path>
      <path
        fill="none"
        strokeDasharray="16"
        strokeDashoffset="16"
        d="M17 9h3c0.55 0 1 0.45 1 1v3c0 0.55 -0.45 1 -1 1h-3"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.6s" dur="0.3s" to="0" />
      </path>
    </g>
    <path fill="currentColor" d="M0 0h24v24H0z" mask="url(#coffee101IconMask)" />
  </svg>
);

const SvgPlus = ({ active }: { active: boolean }) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'inherit' }}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

// Pin sanitizer: must mirror AGENT_CATALOG keys below. Used at init to
// drop obsolete IDs from `coffee_pinned_items` (e.g. `agent:vibeid`
// from back when /vibeid was a launcher tool, before it became a
// regular skill). Without this, retired pins inflate the
// "Agents N/MAX_PINS" counter on the library tab — the stale cards
// render nothing because no AGENT_CATALOG entry matches, but they
// still count. Update this set when adding or removing AGENT_CATALOG
// entries below.
const VALID_PIN_KEYS = new Set<string>([
  'claude', 'opencode', 'mimocode', 'kilo', 'openclaw', 'codex', 'grok', 'antigravity', 'qwen', 'hermes', 'terminal',
  'pi', 'crush', 'aider', 'kimicode', 'goose', 'copilot', 'cursor', 'cline', 'omp',
  'codebuddy', 'muse', 'kiro', 'minimax',
  'installer', 'four-split', 'three-split', 'two-split',
]);

const CONFIGURABLE_AGENT_TOOLS = new Set<ToolType>([
  'claude', 'codex', 'grok', 'antigravity', 'qwen', 'opencode',
  'mimocode', 'kilo', 'openclaw', 'hermes', 'pi', 'kimicode', 'omp',
  'codebuddy', 'copilot',
]);

// Dynamic Island visibility follows the shared agent-status capability: native
// OSC title tools plus TUIs covered by the rendered-screen semantic parser.
export function CenterPanel() {
  const { state, dispatch } = useAppState();
  const t = useT();
  const terminals = state.terminals;
  const activeTerminalId = state.activeTerminalId;
  // Diff tab surface: visible only in tab mode with a selection. The diff
  // chrome-tab sits in the strip beside terminal tabs; diffTabActive tracks
  // whether it (not a terminal tab) is the focused surface.
  const diffTabVisible = state.diffMode === 'tab' && state.diffSelection !== null;
  const diffTabActive = state.diffTabActive;
  const previewTabVisible = state.previewSelection !== null;
  const previewTabActive = state.previewTabActive;
  // Diff tab title = basename of the selected file (mirrors DiffPanel's own
  // header name). Computed here so the chrome-tab strip shows it without
  // mounting the DiffPanel body.
  const diffTabTitle = useMemo(() => {
    const p = state.diffSelection?.path ?? '';
    return p.replace(/\\/g, '/').split('/').pop() || p || (t('task.tab.changes') || 'Diff');
  }, [state.diffSelection?.path, t]);
  const previewTabTitle = useMemo(() => {
    const p = state.previewSelection ?? '';
    return p.replace(/\\/g, '/').split('/').pop() || p || (t('preview.tab') || 'Preview');
  }, [state.previewSelection, t]);

  const [toolsInstalled, setToolsInstalled] = useState<Record<string, boolean>>({});
  // Per-tool launch override modal (gear icon → opens settings for that tool).
  const [configModalTool, setConfigModalTool] = useState<{ key: string; label: string } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pinnedItems, setPinnedItems] = useState<string[]>(() => {
    // Hard cap must match MAX_PINS constant below. Inlined as a literal
    // because MAX_PINS is declared after this initializer runs.
    const CAP = 6;
    try {
      const stored = localStorage.getItem('coffee_pinned_items');
      if (stored !== null) {
        let arr = JSON.parse(stored);
        if (!Array.isArray(arr)) return [];
        // Migrate the retired multi-agent pin to four-split so upgrading
        // users keep a card in that home-screen slot instead of an empty
        // hole — the coordinated multi-agent tool was removed and the
        // independent four-split is its closest replacement. Dedup after,
        // in case four-split was already pinned.
        arr = arr.map((id: unknown) => (id === 'agent:multi-agent' ? 'agent:four-split' : id));
        arr = arr.filter((id: unknown, i: number) => arr.indexOf(id) === i);
        // Drop stale pin IDs from retired AGENT_CATALOG entries (e.g.
        // `agent:vibeid` after /vibeid became a skill, or the other retired
        // coordinated tools `agent:two-agent` / `agent:three-agent` /
        // `agent:hyper-agent`). These ghosts render nothing but inflate the
        // "Agents N/6" counter.
        arr = arr.filter((id: unknown) =>
          typeof id === 'string' && id.startsWith('agent:') && VALID_PIN_KEYS.has(id.slice('agent:'.length))
        );
        // Defensive cap: historical bugs (e.g. earlier migrations that
        // pushed past the limit) may have left > CAP items in storage.
        // Trim and persist back so the state stays consistent.
        if (arr.length > CAP) arr = arr.slice(0, CAP);
        try { localStorage.setItem('coffee_pinned_items', JSON.stringify(arr)); } catch { /* Best-effort operation; failure is non-fatal. */ }
        return arr;
      }
      // First launch: pre-pin 6 useful defaults so desktop shows a full MAX_PINS
      // grid out of the box (4 AI CLIs covering major providers + 2 utilities).
      // Returning users' pin choices are respected (stored !== null path above).
      const defaults = [
        'agent:claude',
        'agent:codex',
        'agent:opencode',
        'agent:antigravity',
        'agent:four-split',
        'agent:terminal',
      ];
      localStorage.setItem('coffee_pinned_items', JSON.stringify(defaults));
      return defaults;
    } catch { return []; }
  });

  const MAX_PINS = 6;

  // Agent list is fully local (baked into BUILTIN_AI_CLI_FALLBACK below) — no
  // loading / cache state here. The remote catalog fetch at
  // coffeecli.com/agents/catalog.json was deleted in v1.1.5 to eliminate
  // first-paint icon flashes and reduce startup network dependency.

  // Built-in AI CLI catalog. Fully local — no remote fetch. Display
  // names are sourced from the Rust registry (see lib/tool-info.ts);
  // the order here is the launchpad's preferred presentation order.
  const BUILTIN_AI_CLI_FALLBACK: { key: ToolType; label: string }[] = [
    'claude', 'opencode', 'mimocode', 'kilo', 'openclaw', 'codex', 'grok', 'antigravity', 'qwen', 'hermes',
    // Pi/Oh-My-Pi (T2), Kimi Code (T1), Antigravity/Crush/Aider/Goose/Copilot/Cursor/Cline (T3).
    'pi', 'crush', 'aider', 'kimicode', 'goose', 'copilot', 'cursor', 'cline', 'omp',
    'codebuddy', 'muse', 'kiro', 'minimax',
  ].map((key) => ({ key: key as ToolType, label: getToolDisplayName(key) }));

  // Unified agent catalog — fully local. The remote catalog fetch
  // (coffeecli.com/agents/catalog.json) was deleted in v1.1.5; product
  // decision is that software is bundled with the app (delete-logic-not-add).
  // AI CLIs and utilities are both hardcoded below.
  // - `type`: semantic category ('ai-cli' | 'utility'). Lets future code group/filter items.
  // - `requiresCwd`: behavior flag — drives folder-button + cwd display on Desktop cards.
  const AGENT_CATALOG: { key: ToolType; label: string; icon: React.ReactNode; type: 'ai-cli' | 'utility'; requiresCwd: boolean }[] = (() => {
    // OpenClaw (persona forge) is directory-agnostic — its primary
    // workflow is global persona/skill management, not a project folder.
    // Skip the folder-picker + cwd display so it launches in one click,
    // like utilities. Hermes Agent IS folder-aware (its splash screen
    // displays the launch cwd, and its tools can scope to a project),
    // so it gets the folder-picker on its launchpad card just like
    // Claude Code / Codex.
    const CWD_AGNOSTIC_AI_CLI = new Set<ToolType>(['openclaw']);
    const aiCliEntries = BUILTIN_AI_CLI_FALLBACK.map(item => ({
      key: item.key,
      label: item.label,
      icon: getToolIcon(item.key) ?? null,
      type: 'ai-cli' as const,
      requiresCwd: !CWD_AGNOSTIC_AI_CLI.has(item.key),
    }));

    // "Agent Tools" grid on the Library page: Terminal + Coffee 101, then
    // the independent split tools descending 4→3→2.
    const utilities = [
      // Terminal is an AI-CLI-like tool (needs cwd) rather than a 'utility'.
      { key: 'terminal' as ToolType, label: t('tool.terminal'), icon: <TerminalIcon />, type: 'ai-cli' as const, requiresCwd: true },
      // ─── Independent split (descending 4→3→2): N side-by-side PTYs ──
      {
        key: 'four-split' as ToolType,
        label: t('tool.four_split'),
        icon: <SvgFourSplit />,
        type: 'utility' as const,
        requiresCwd: false,
      },
      {
        key: 'three-split' as ToolType,
        label: t('tool.three_split'),
        icon: <SvgThreeSplit />,
        type: 'utility' as const,
        requiresCwd: false,
      },
      {
        key: 'two-split' as ToolType,
        label: t('tool.two_split'),
        icon: <SvgTwoSplit />,
        type: 'utility' as const,
        requiresCwd: false,
      },
      { key: 'installer' as ToolType, label: 'Coffee 101', icon: <SvgInstaller />, type: 'utility' as const, requiresCwd: false },
    ];

    return [...aiCliEntries, ...utilities];
  })();

  const togglePin = (id: string) => {
    setPinnedItems(prev => {
      const isPinned = prev.includes(id);
      let next: string[];
      if (isPinned) {
        next = prev.filter(x => x !== id);
      } else {
        if (prev.length >= MAX_PINS) return prev;
        next = [...prev, id];
      }
      try { localStorage.setItem('coffee_pinned_items', JSON.stringify(next)); } catch { /* Best-effort operation; failure is non-fatal. */ }
      return next;
    });
  };

  // (renderPinIcon removed — selection state is now indicated by the
  // .library-item.is-pinned border + opacity, not a right-side icon.)
  // Tracks last successful checkToolsInstalled() scan (epoch ms). Used
  // to skip the back-to-desktop re-scan if it would just repeat work
  // we already did seconds ago — the laggy "click 9-dot, wait, library
  // opens" feel was 7 CLIs × up to 1s of serial PATH scan blocking the
  // IPC queue between back-click and the next 9-dot click.
  const lastToolsScanAt = useRef<number>(0);
  // Previous toolsInstalled snapshot — diffed against each new scan so
  // we can maintain its cleanup/theme integration exactly when a CLI flips from
  // not-installed → installed during a Coffee CLI session. `null`
  // sentinel = "we haven't scanned yet"; the very first scan does not
  // trigger any install IPCs because startup's install_all() already
  // covered whatever was on PATH at launch — diffing against `null`
  // would re-fire those redundantly.
  const prevToolsInstalledRef = useRef<Record<string, boolean> | null>(null);
  const applyToolsInstalled = (result: Record<string, boolean>) => {
    const prev = prevToolsInstalledRef.current;
    if (prev !== null) {
      for (const tool of Object.keys(result)) {
        if (result[tool] === true && prev[tool] === false) {
          commands.maintainToolIntegration(tool).catch(() => {});
        }
      }
    }
    prevToolsInstalledRef.current = result;
    // Unchanged result (the common case on a foreground rescan — tools don't
    // get installed/removed between alt-tabs) keeps the same ref so React skips
    // the re-render. setToolsInstalled always receives a fresh IPC object, so
    // without this an unchanged rescan reconciles the whole CenterPanel and a
    // tab switch right after returning to the foreground stutters (#43 #5).
    setToolsInstalled(curr => {
      const keys = Object.keys(result);
      const same = keys.length === Object.keys(curr).length
        && keys.every(k => curr[k] === result[k]);
      return same ? curr : result;
    });
    lastToolsScanAt.current = Date.now();
  };

  // ── Remote Terminal SSH form state ─────────────────────────────────────────
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteProtocol, setRemoteProtocol] = useState<'ssh' | 'ws'>('ssh');
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('root');
  const [sshPass, setSshPass] = useState('');
  
  const [remoteHistory, setRemoteHistory] = useState<RemoteHistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('remote_terminal_history') || '[]'); } catch { return []; }
  });

  const saveRemoteHistory = (item: Omit<RemoteHistoryItem, 'id'>) => {
    setRemoteHistory(prev => {
      const filtered = prev.filter(p => !(p.host === item.host && p.port === item.port && p.protocol === item.protocol));
      const next = [{ id: crypto.randomUUID(), ...item }, ...filtered].slice(0, 10);
      localStorage.setItem('remote_terminal_history', JSON.stringify(next));
      return next;
    });
  };

  const deleteRemoteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoteHistory(prev => {
      const next = prev.filter(p => p.id !== id);
      localStorage.setItem('remote_terminal_history', JSON.stringify(next));
      return next;
    });
  };
  const [connStatus, setConnStatus] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const [lastCwdByTool, setLastCwdByTool] = useState<Record<string, string>>({});
  // Global recent project folders (across all folder-using tools) — backs the
  // folder-icon dropdown. Separate from the per-tool last-cwd above.
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try { const r = localStorage.getItem('coffee:recent-folders'); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; tool: ToolType } | null>(null);
  const pushRecentFolder = (folder: string) => {
    setRecentFolders(prev => {
      const next = [folder, ...prev.filter(f => f !== folder)].slice(0, 8);
      try { localStorage.setItem('coffee:recent-folders', JSON.stringify(next)); } catch { /* Best-effort operation; failure is non-fatal. */ }
      return next;
    });
  };
  const removeRecentFolder = (folder: string) => {
    setRecentFolders(prev => {
      const next = prev.filter(f => f !== folder);
      try { localStorage.setItem('coffee:recent-folders', JSON.stringify(next)); } catch { /* Best-effort operation; failure is non-fatal. */ }
      return next;
    });
  };

  // ── Global focus enforcer ────────────────────────────────────────────────
  // One pair of window listeners for the whole app (previously each
  // TierTerminal added its own focusin + mouseup handlers, causing O(N)
  // dispatch per click with N tabs). When focus wanders to the body or a
  // non-input element, steal it back for the currently active terminal.
  const activeIdRef = useRef((diffTabActive || previewTabActive) ? null : activeTerminalId);
  useEffect(() => { activeIdRef.current = (diffTabActive || previewTabActive) ? null : activeTerminalId; }, [activeTerminalId, diffTabActive, previewTabActive]);
  useEffect(() => {
    const enforce = () => {
      setTimeout(() => {
        const el = document.activeElement;
        // Any focused INPUT/TEXTAREA is the real target, INCLUDING xterm's
        // .xterm-helper-textarea. Earlier this branch excluded the xterm
        // helper to "steal focus back to the active terminal", but that
        // broke the multi-agent quadrant — every pane has its own xterm
        // helper, and stealing the focus always landed on the wrong one.
        // The enforcer now only pulls focus back when it wanders to
        // genuinely non-input DOM (<div>, <body>, a clicked tab bar).
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          return;
        }
        const id = activeIdRef.current;
        if (id) focusTerminal(id);
      }, 10);
    };
    window.addEventListener('focusin', enforce);
    window.addEventListener('mouseup', enforce);
    return () => {
      window.removeEventListener('focusin', enforce);
      window.removeEventListener('mouseup', enforce);
    };
  }, []);

  // Load sticky config — non-sensitive fields from localStorage, password from OS keychain
  useEffect(() => {
    try {
      const saved = localStorage.getItem('coffee_remote_cfg');
      if (saved) {
        const c = JSON.parse(saved);
        if (c.protocol) setRemoteProtocol(c.protocol);
        if (c.host) setSshHost(c.host);
        if (c.port) setSshPort(String(c.port));
        if (c.username) setSshUser(c.username);
        if (isTauri && c.host && c.username) {
          commands.loadPassword(c.host, c.username)
            .then(pw => { if (pw) setSshPass(pw); })
            .catch(() => {});
        }
      }
    } catch { /* Best-effort operation; failure is non-fatal. */ }
  }, []);

  // Derived state — must be before hooks that depend on it
  const activeSession = terminals.find(t => t.id === activeTerminalId);
  const isLaunchpadMode = activeSession && activeSession.tool === null;
  // Mirrored into a ref so the window-foreground rescan (which has [] deps and
  // can't see the latest value otherwise) can skip work while in a terminal tab.
  const isLaunchpadModeRef = useRef(isLaunchpadMode);
  useEffect(() => { isLaunchpadModeRef.current = isLaunchpadMode; }, [isLaunchpadMode]);



  // Detect tool availability only when the Desktop (not Library) is actually visible.
  // Library is pure UI: pin/unpin never trigger IPC, scan is silent during browsing.
  // Scan runs on:
  //   - Launchpad first shown
  //   - Remote catalog refreshed
  //   - User returns from Library to Desktop (back arrow) — picks up new pins' install state
  // Never on pinnedItems changes → pin click stays instant.
  useEffect(() => {
    if (!isTauri || !isLaunchpadMode) return;
    if (showLibrary) return; // Library open: stay silent
    // Debounce: rapid 9-dot ↔ back toggles would otherwise stack up
    // checkToolsInstalled() IPCs (PATH scan for 7 CLIs, ~200ms-1s each
    // on Windows). The serial IPC queue blocked React reconciliation
    // and the next mode-switch click looked dead. Only fire after the
    // user has actually settled on the launchpad for 300ms.
    //
    // Cache gate (30s TTL): tool install state doesn't change just
    // because the user toggled in/out of Library — binaries are on
    // PATH or not regardless of pin actions. Skipping the rescan when
    // we just did one seconds ago kills the "click back, wait, click
    // 9-dot, lag" feel without losing the legitimate refresh-after-
    // a-real-install case (TTL expires after idle).
    const SCAN_TTL_MS = 30_000;
    const handle = setTimeout(() => {
      if (Date.now() - lastToolsScanAt.current < SCAN_TTL_MS) return;
      commands.checkToolsInstalled()
        .then(applyToolsInstalled)
        .catch(() => {});
      try {
        const raw = localStorage.getItem('coffee:last-cwd-by-tool');
        if (raw) setLastCwdByTool(JSON.parse(raw));
      } catch { /* Best-effort operation; failure is non-fatal. */ }
    }, 300);
    return () => clearTimeout(handle);
  }, [isLaunchpadMode, showLibrary]);

  // Window-focus rescan — picks up CLIs the user just installed in an
  // external terminal without forcing them to restart Coffee CLI. The
  // launchpad-mode useEffect above only re-fires when isLaunchpadMode
  // / showLibrary actually change; sitting on the launchpad while
  // alt-tabbing out to install a CLI doesn't toggle either, so the
  // scan-cache stays warm and the gray card never flips. Focus event
  // is the natural "user just came back, may have done something
  // external" signal. Bypasses the SCAN_TTL_MS cache for the same
  // reason. Debounced (500ms) so rapid alt-tab spam doesn't stack
  // up serial PATH scans on the IPC queue.
  //
  // Routed through window-focus-filter so the spurious blur+focus pair
  // emitted by `start_dragging()` on Windows doesn't fire a 770ms PATH
  // scan every time the user grabs the titlebar (root cause of the
  // first-drag stall on Windows; Linux is unaffected).
  useEffect(() => {
    if (!isTauri) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onWindowForeground(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Only the launchpad shows per-tool install state. Rescanning while the
        // user is inside a terminal tab is wasted work whose setState reflows
        // the whole CenterPanel, making the next tab switch stutter (#43 #5).
        // Re-entering the launchpad runs its own (TTL-gated) rescan anyway.
        if (!isLaunchpadModeRef.current) return;
        commands.checkToolsInstalled()
          .then(applyToolsInstalled)
          .catch(() => {});
      }, 500);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);



  const handleAddTab = () => {
    dispatch({
      type: 'ADD_TERMINAL',
      session: { id: crypto.randomUUID(), tool: null, folderPath: null }
    });
  };

  // External launch (`coffee-cli launch --tool <id> [--cwd <dir>]`) — reached
  // from the cold-start drain (takePendingLaunch) and the warm-start
  // single-instance forward ('launch-request' event). Reuses an idle
  // launchpad tab when one exists so the agent never hijacks a tab that
  // already runs a session; otherwise opens a fresh tab (no cap — matches
  // the + button, which is also uncapped so launcher scripts never stall).
  const launchCtxRef = useRef({ terminals, activeTerminalId });
  useEffect(() => { launchCtxRef.current = { terminals, activeTerminalId }; });
  const applyLaunchRequest = (tool: ToolType, cwd?: string) => {
    if (!BUILTIN_AI_CLI_FALLBACK.some(item => item.key === tool)) return;
    const { terminals: terms, activeTerminalId: activeId } = launchCtxRef.current;
    const current = terms.find(t => t.id === activeId);
    let id: string;
    if (current && current.tool === null) {
      id = current.id;
    } else {
      const idle = terms.find(t => t.tool === null);
      if (idle) {
        id = idle.id;
        dispatch({ type: 'SET_ACTIVE_TERMINAL', id });
      } else {
        id = crypto.randomUUID();
        dispatch({ type: 'ADD_TERMINAL', session: { id, tool: null, folderPath: cwd ?? null } });
      }
    }
    if (cwd) {
      dispatch({ type: 'SET_FOLDER', path: cwd });
      setLastCwdByTool(prev => {
        const next = { ...prev, [tool as string]: cwd };
        try { localStorage.setItem('coffee:last-cwd-by-tool', JSON.stringify(next)); } catch { /* storage full/blocked — non-fatal */ }
        return next;
      });
      pushRecentFolder(cwd);
    }
    dispatch({ type: 'SET_TERMINAL_TOOL', id, tool });
  };

  // Drain the cold-start launch request once on mount, then keep listening
  // for warm-start forwards emitted by the single-instance plugin (second
  // process invoked as `launch …` — the running instance never restarts).
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    commands.takePendingLaunch()
      .then(req => { if (!cancelled && req) applyLaunchRequest(req.tool as ToolType, req.cwd); })
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        const handle = await listen<{ tool: string; cwd?: string }>('launch-request', e => {
          if (!cancelled) applyLaunchRequest(e.payload.tool as ToolType, e.payload.cwd);
        });
        if (cancelled) handle(); else unlisten = handle;
      } catch { /* event bridge unavailable (e.g. browser dev) — ignore */ }
    })();
    return () => { cancelled = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dispatch({ type: 'REMOVE_TERMINAL', id });
  };

  // ── Tab drag-to-reorder ─────────────────────────────────────────────────
  // Browser-style: pointer-down a tab, drag horizontally past 5px, drop
  // wherever you want it. Pointer events (not HTML5 drag-and-drop) because
  // Tauri v2 + WebView2 swallows intra-app dragstart on Windows when its
  // own file-drop capture is enabled (memory: reference_webview2_html5_drag).
  const tabsHeaderRef = useRef<HTMLDivElement | null>(null);
  // Active drag state. `fromIdx` / `targetIdx` are positions in the
  // **visible tab strip** (including Agent pages, in DOM order) — not the underlying
  // `state.terminals` array — because the slide-aside math operates on
  // what the user actually sees. `slotWidth` is the dragged tab's
  // visual footprint (own width + the flex `gap`); siblings translateX
  // by ±slotWidth to make room.
  const [tabDrag, setTabDrag] = useState<{
    tabId: string;
    deltaX: number;
    fromIdx: number;
    targetIdx: number;
    slotWidth: number;
  } | null>(null);
  // Suppress the click that would otherwise fire on pointerup at end of
  // a drag (the click handler activates the tab — we don't want a drop
  // to count as an activation if the tab moved).
  const tabDragSuppressClickRef = useRef(false);

  // The chrome tab strip renders into the titlebar (Windows-Terminal style),
  // not a separate row inside the content — the tabs sit on the drag bar like
  // Chrome / the OS terminals. We keep ALL the tab logic/state here (the tabs
  // ARE the center's terminals) and just portal the rendered strip up into
  // TitleBar's #titlebar-tab-slot. Slot resolves after first mount; the strip
  // renders one frame later, which is imperceptible.
  const [tabSlot, setTabSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setTabSlot(document.getElementById('titlebar-tab-slot')); }, []);

  const onTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, tabId: string) => {
    // Ignore non-primary buttons + clicks on close button / status indicator
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

    const headerEl = tabsHeaderRef.current;
    if (!headerEl) return;

    // Snapshot every visible tab's center X at drag start. Used by
    // drop AND by the shift math during drag — DOM is animating
    // during drag, so re-measuring would feed back into itself.
    const tabEls = Array.from(
      headerEl.querySelectorAll<HTMLElement>('.chrome-tab[data-tab-id]'),
    );
    const positions = tabEls.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tabId: el.dataset.tabId!,
        center: rect.left + rect.width / 2,
        width: rect.width,
      };
    });
    const fromIdx = positions.findIndex(p => p.tabId === tabId);
    if (fromIdx < 0) return;
    const ownPos = positions[fromIdx];

    // Dragged tab's "occupied slot width" = distance from its center to
    // its nearest neighbor's center. This includes the flex `gap`
    // between tabs, so siblings shifting by slotWidth visually fill
    // the vacated slot exactly.
    let slotWidth: number;
    if (fromIdx + 1 < positions.length) {
      slotWidth = positions[fromIdx + 1].center - ownPos.center;
    } else if (fromIdx > 0) {
      slotWidth = ownPos.center - positions[fromIdx - 1].center;
    } else {
      slotWidth = ownPos.width; // only one tab — no siblings to shift anyway
    }

    const startX = e.clientX;
    let started = false;
    const THRESHOLD = 5;

    // For a given cursor X, what's the without-dragged-array index that
    // the dragged tab would land on? Derived from the dragged tab's
    // visual center vs every OTHER tab's recorded center. Returns a
    // value in [0, positions.length - 1] — same domain as the
    // `insertIdx` the reducer uses.
    const computeTargetIdx = (clientX: number): number => {
      const draggedCenter = ownPos.center + (clientX - startX);
      let count = 0;
      for (let i = 0; i < positions.length; i++) {
        if (i === fromIdx) continue;
        if (positions[i].center > draggedCenter) return count;
        count++;
      }
      return count;
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!started && Math.abs(dx) < THRESHOLD) return;
      started = true;
      setTabDrag({
        tabId,
        deltaX: dx,
        fromIdx,
        targetIdx: computeTargetIdx(ev.clientX),
        slotWidth,
      });
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (started) {
        // Suppress the upcoming click (tab activation) — the user dragged,
        // they didn't click. Cleared on the next click that fires.
        tabDragSuppressClickRef.current = true;
        const targetIdx = computeTargetIdx(ev.clientX);
        // beforeId = the tab at `targetIdx` in the without-dragged strip;
        // `null` when dropping past every other tab (insert at end).
        const others = positions.filter((_, i) => i !== fromIdx);
        const beforeId = targetIdx < others.length ? others[targetIdx].tabId : null;
        dispatch({ type: 'REORDER_TAB', tabId, beforeId });
      }
      setTabDrag(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const onTabClickGuarded = (tabId: string) => {
    if (tabDragSuppressClickRef.current) {
      tabDragSuppressClickRef.current = false;
      return;
    }
    dispatch({ type: 'SET_ACTIVE_TERMINAL', id: tabId });
  };

  const getTabDragStyle = (tabId: string, visibleIndex: number): React.CSSProperties | undefined => {
    if (!tabDrag) return undefined;
    if (tabDrag.tabId === tabId) return { transform: `translateX(${tabDrag.deltaX}px)` };
    const withoutIdx = visibleIndex < tabDrag.fromIdx ? visibleIndex : visibleIndex - 1;
    const shift = visibleIndex < tabDrag.fromIdx && withoutIdx >= tabDrag.targetIdx
      ? tabDrag.slotWidth
      : visibleIndex > tabDrag.fromIdx && withoutIdx < tabDrag.targetIdx ? -tabDrag.slotWidth : 0;
    return shift ? { transform: `translateX(${shift}px)` } : undefined;
  };

  const formatCwd = (cwd: string): string => {
    if (!cwd) return '';
    // Detect Windows path (e.g. C:\... or c:/...)
    const isWin = /^[a-zA-Z]:/.test(cwd);
    if (isWin) {
      // Uppercase drive letter, normalize to backslashes
      const formatted = cwd[0].toUpperCase() + ':' + cwd.slice(2).replace(/\//g, '\\');
      return formatted.length > 30 ? '\u2026' + formatted.slice(-28) : formatted;
    }
    // Unix path — show last 2 segments
    const parts = cwd.split('/').filter(Boolean);
    if (parts.length === 0) return cwd;
    const label = parts.length >= 2
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[parts.length - 1];
    return label.length > 30 ? '\u2026' + label.slice(-28) : label;
  };

  const selectTool = (tool: ToolType, toolData?: string, cwd?: string) => {
    // Concurrent multi-agent Tabs are now supported as of the per-pane
    // MCP / per-pane system-prompt rework: each pane has its own MCP
    // listener (different port), Claude panes write zero workspace
    // files, and `list_panes` / `send_to_pane` filter by the caller's
    // own Tab id so two open multi-agent Tabs never see each other.
    // The old single-instance lock that lived here has been removed.
    if (activeTerminalId) {
      if (cwd) {
        setLastCwdByTool(prev => {
          const next = { ...prev, [tool as string]: cwd };
          try { localStorage.setItem('coffee:last-cwd-by-tool', JSON.stringify(next)); } catch { /* Best-effort operation; failure is non-fatal. */ }
          return next;
        });
        pushRecentFolder(cwd);
      }
      dispatch({ type: 'LAUNCH_TERMINAL_TOOL', id: activeTerminalId, tool, toolData, cwd });
    }
  };

  const handlePickFolder = async (toolKey: ToolType) => {
    if (!toolKey) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true });
      if (selected && typeof selected === 'string') {
        selectTool(toolKey, undefined, selected);
      }
    } catch (err) {
      console.error('[CenterPanel] Folder picker failed:', err);
    }
  };

  const handleRemoteConnect = async () => {
    if (!sshHost.trim()) return;
    if (remoteProtocol === 'ssh' && !sshUser.trim()) return;
    
    setConnStatus('connecting');

    saveRemoteHistory({ protocol: remoteProtocol, host: sshHost.trim(), port: sshPort.trim(), user: sshUser.trim() });

    // Validate network connection using real TCP check instead of mock
    let isOffline = false;
    try {
      const portNum = parseInt(sshPort) || (remoteProtocol === 'ssh' ? 22 : 7681);
      const isReachable = await commands.checkNetworkPort(sshHost.trim(), portNum);
      if (!isReachable) isOffline = true;
    } catch {
      isOffline = true;
    }

    if (isOffline) {
      setConnStatus('failed');
      setTimeout(() => setConnStatus('idle'), 3000);
      return;
    }

    const connDataObj = {
      protocol: remoteProtocol,
      host: sshHost.trim(),
      port: parseInt(sshPort) || (remoteProtocol === 'ssh' ? 22 : 7681),
      username: sshUser.trim(),
      // password intentionally omitted — stored in OS keychain, not localStorage
    };

    try {
      localStorage.setItem('coffee_remote_cfg', JSON.stringify(connDataObj));
    } catch { /* Best-effort operation; failure is non-fatal. */ }

    // Save password to OS keychain (Windows Credential Manager / macOS Keychain)
    if (isTauri && sshPass) {
      commands.savePassword(sshHost.trim(), sshUser.trim(), sshPass).catch(() => {});
    }

    // connData sent in-memory to Rust for the connection — includes password
    const connData = JSON.stringify({ ...connDataObj, password: sshPass });

    selectTool('remote', connData);
    setShowRemoteForm(false);
    setConnStatus('idle');
  };

  // Last path segment, Windows ("\") and POSIX ("/") safe. null when path unknown.
  const cwdBasename = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const trimmed = p.replace(/[\\/]+$/, '');
    if (!trimmed) return '/';
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\';
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || trimmed;
  };

  // Local shell-bearing tabs show cwd basename (Explorer-style): icon = tool identity,
  // text = location. Remote/non-shell tabs keep their existing labels.
  const renderTabContent = (session: typeof terminals[0], isActive: boolean) => {
    const cwd = cwdBasename(session.folderPath);
    const pathTip = session.folderPath ?? undefined;
    // Icon comes from the shared tool→glyph map (also used by the Gambit
    // workspace chip) so the tab and the compose footer can't drift apart.
    // The placeholder new-tab (tool === null) falls back to the plus glyph.
    const icon = getToolIcon(session.tool) ?? <SvgPlus active={isActive} />;
    switch (session.tool) {
      case 'claude': return { icon, title: cwd ?? getToolDisplayName('claude'), tooltip: pathTip };
      case 'qwen': return { icon, title: cwd ?? getToolDisplayName('qwen'), tooltip: pathTip };
      // OpenClaw / Hermes are directory-agnostic tools — their tab title
      // stays as the tool name regardless of any inherited folderPath.
      case 'hermes': return { icon, title: getToolDisplayName('hermes'), tooltip: undefined };
      case 'opencode': return { icon, title: cwd ?? getToolDisplayName('opencode'), tooltip: pathTip };
      case 'mimocode': return { icon, title: cwd ?? getToolDisplayName('mimocode'), tooltip: pathTip };
      case 'kilo': return { icon, title: cwd ?? getToolDisplayName('kilo'), tooltip: pathTip };
      case 'openclaw': return { icon, title: getToolDisplayName('openclaw'), tooltip: undefined };
      case 'codex': return { icon, title: cwd ?? getToolDisplayName('codex'), tooltip: pathTip };
      case 'grok': return { icon, title: cwd ?? getToolDisplayName('grok'), tooltip: pathTip };
      case 'antigravity': return { icon, title: cwd ?? getToolDisplayName('antigravity'), tooltip: pathTip };
      // Directory-aware tabs use their icon plus cwd basename. Status-capable
      // TUIs below can still show an island through rendered-screen semantics.
      case 'pi': return { icon, title: cwd ?? getToolDisplayName('pi'), tooltip: pathTip };
      case 'crush': return { icon, title: cwd ?? getToolDisplayName('crush'), tooltip: pathTip };
      case 'aider': return { icon, title: cwd ?? getToolDisplayName('aider'), tooltip: pathTip };
      case 'kimicode': return { icon, title: cwd ?? getToolDisplayName('kimicode'), tooltip: pathTip };
      case 'goose': return { icon, title: cwd ?? getToolDisplayName('goose'), tooltip: pathTip };
      case 'copilot': return { icon, title: cwd ?? getToolDisplayName('copilot'), tooltip: pathTip };
      case 'cursor': return { icon, title: cwd ?? getToolDisplayName('cursor'), tooltip: pathTip };
      case 'cline': return { icon, title: cwd ?? getToolDisplayName('cline'), tooltip: pathTip };
      case 'omp': return { icon, title: cwd ?? getToolDisplayName('omp'), tooltip: pathTip };
      case 'codebuddy': return { icon, title: cwd ?? getToolDisplayName('codebuddy'), tooltip: pathTip };
      case 'muse': return { icon, title: cwd ?? getToolDisplayName('muse'), tooltip: pathTip };
      case 'kiro': return { icon, title: cwd ?? getToolDisplayName('kiro'), tooltip: pathTip };
      case 'minimax': return { icon, title: cwd ?? getToolDisplayName('minimax'), tooltip: pathTip };
      case 'remote': {
        let title = t('tool.remote') as string;
        if (session.toolData) {
          try {
            const data = JSON.parse(session.toolData);
            if (data.protocol === 'ssh' && data.username && data.host) {
              title = `${data.username}@${data.host}`;
            } else if (data.host) {
              title = data.host;
            }
          } catch { /* Best-effort operation; failure is non-fatal. */ }
        }
        return { icon, title, tooltip: undefined };
      }
      case 'terminal': return { icon, title: cwd ?? t('tool.terminal'), tooltip: pathTip };
      case 'two-split': return { icon, title: cwd ?? t('tool.two_split'), tooltip: pathTip };
      case 'three-split': return { icon, title: cwd ?? t('tool.three_split'), tooltip: pathTip };
      case 'four-split': return { icon, title: cwd ?? t('tool.four_split'), tooltip: pathTip };
      default: return { icon: <SvgPlus active={isActive} />, title: t('tab.new'), tooltip: undefined };
    }
  };

  // ── Custom background (image/video) ──────────────────────────────────────
  // Background state lives in global AppState (set via theme menu in Explorer)
  const bgPath = state.bgPath;
  const bgType = state.bgType;
  // Glass, Carbon, Monogram, and Character Flow force terminal-as-transparent even without an
  // in-app wallpaper, so the backdrop bleeds through (body bg is dropped /
  // replaced by the shape texture in those [data-shape] overrides). Without
  // this, the xterm canvas renders its solid `bgOpaque` and covers the
  // backdrop exactly where it matters most — the largest surface.
  const isBackdropShape = state.currentShape === 'glass' || isFrostShape(state.currentShape) || state.currentShape === 'carbon' || state.currentShape === 'monogram' || state.currentShape === 'characters';
  const hasBg = (bgType !== 'none' && bgPath !== '') || isBackdropShape;

  // Convert wallpaper path to a displayable URL. User-picked local
  // files go through Tauri's convertFileSrc (asset protocol) for
  // zero-copy streaming, with a file:// fallback for non-Tauri
  // (e.g. browser dev) contexts.
  const [bgUrl, setBgUrl] = useState('');
  useEffect(() => {
    // Two reasons to keep bgUrl empty:
    //   1. hasBg is false — wallpaper layer is off entirely.
    //   2. hasBg is true but bgPath is empty — happens when Glass shape
    //      forces hasBg=true to pull the terminal canvas transparent,
    //      but the user has no wallpaper picked. Without this second
    //      guard, the fall-through below would call convertFileSrc('')
    //      → Tauri returns a stub asset URL → <img> renders the
    //      broken-image icon over a black backdrop. Users perceived this
    //      as "切到 Glass 后左上角出现裂开图标 + 整个区域变黑".
    if (!hasBg || !bgPath) { setBgUrl(''); return; }
    import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
      setBgUrl(convertFileSrc(bgPath));
    }).catch(() => {
      setBgUrl('file:///' + bgPath.replace(/\\/g, '/'));
    });
  }, [hasBg, bgPath]);

  return (
    <>
      {tabSlot && createPortal(
      <div ref={tabsHeaderRef} className="chrome-tabs-header" data-count={terminals.filter(s => !s.isHidden || s.id === activeTerminalId).length}>
        {(() => {
          const sessions = new Map(terminals.map(session => [session.id, session]));
          const visibleTabs = getTabOrder(state).filter(id => {
            const session = sessions.get(id);
            return !session || !session.isHidden || id === activeTerminalId;
          });
          return visibleTabs.map((tabId, visibleIndex) => {
          const isDragging = tabDrag?.tabId === tabId;
          const dragStyle = getTabDragStyle(tabId, visibleIndex);
          const session = sessions.get(tabId)!;

          // A terminal tab is "active" only when it's the focused surface —
          // when the diff tab is focused (diffTabActive), no terminal tab
          // should show the active highlight (the diff chrome-tab does).
          const isActive = session.id === activeTerminalId && !diffTabActive && !previewTabActive;
          const { icon, title: baseTitle } = renderTabContent(session, isActive);
          // Tool's live OSC 0/2 title (Claude Code conversation summary, etc.)
          // overrides the cwd basename when the tool has set a non-empty one.
          // Muse inherits its Windows launcher's title; keep the workspace name.
          const title = session.tool === 'muse' ? baseTitle : session.toolTitle?.trim() || baseTitle;
          const showAgentStatus = supportsAgentStatus(session.tool)
            && (session.tool !== 'opencode' || session.agentStatus !== undefined);
          return (
            <div
              key={session.id}
              data-session-id={session.id}
              data-tab-id={session.id}
              className={`chrome-tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
              style={dragStyle}
              onClick={() => onTabClickGuarded(session.id)}
              onPointerDown={(e) => onTabPointerDown(e, session.id)}
            >
              {icon}
              <span className="tab-title" style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{title}</span>
              <div className={`tab-actions${showAgentStatus ? '' : ' tab-actions--close-only'}`}>
                {showAgentStatus && (
                  <div className={`tab-status-grid status-${
                    session.agentStatus === 'wait_input' ? 'waiting' : session.agentStatus ?? 'idle'
                  }${__IS_LINUX__ ? ' tab-status-grid--static' : ''}`}>
                    {/* Linux gate — the 9 dot wave/snake/ripple animations are
                        opacity-loop infinites with box-shadow halos. WebKit2GTK
                        + Cairo doesn't promote these to compositor layers, so
                        each frame re-rasters the box-shadow blur on CPU; with
                        N tabs that's 9N indefinite repaints. Linux gets a
                        single static colored dot instead — same idle/working/
                        waiting color signal, zero animation cost. */}
                    {__IS_LINUX__
                      ? <div className="tab-status-dot tab-status-dot--solo" />
                      : Array.from({ length: 9 }, (_, i) => <div key={i} className="tab-status-dot" />)}
                  </div>
                )}
                <button
                   className="tab-close-btn"
                   onClick={(e) => handleCloseTab(e, session.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
          );
        });
        })()}

        {/* Diff tab — a peer of the terminal tabs in the strip, but not a
            PTY. Visible only in tab mode with a selection. Clicking it
            focuses the diff surface (SET_DIFF_TAB_ACTIVE); its X clears the
            diff entirely. No status-grid (diff has no agent state). */}
        {diffTabVisible && (
          <div
            className={`chrome-tab ${diffTabActive ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_DIFF_TAB_ACTIVE', active: true })}
          >
            {/* Diff tab glyph: a document with text lines — reads as "file
                content view" (the diff is a read-only file viewer), in the
                same icon family as the terminal/tool tabs. currentColor so
                it follows the theme like the other tab icons. */}
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="16" y2="17"/>
            </svg>
            <span className="tab-title" style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{diffTabTitle}</span>
            <div className="tab-actions tab-actions--close-only">
              <button
                className="tab-close-btn"
                onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLEAR_DIFF' }); }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        )}

        {previewTabVisible && (
          <div
            className={`chrome-tab ${previewTabActive ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_PREVIEW_TAB_ACTIVE', active: true })}
          >
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span className="tab-title" style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{previewTabTitle}</span>
            <div className="tab-actions tab-actions--close-only">
              <button
                className="tab-close-btn"
                onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_PREVIEW_TAB' }); }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        )}

        <button className="chrome-tab-new" onClick={handleAddTab}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>,
      tabSlot)}
      <div className="main-content">

        {terminals.map(t => t.tool !== null ? (
          <div
            key={t.id}
            className="terminal-wrapper"
            data-session-id={t.id}
            style={{
              // Hide every terminal wrapper while the diff tab is focused —
              // the diff surface takes over the content area (the underlying
              // PTYs stay mounted, just not displayed).
              display: (t.id === activeTerminalId && !diffTabActive && !previewTabActive) ? 'flex' : 'none',
              width: '100%',
              height: '100%',
              position: 'relative'
            }}
          >
            {t.tool === 'two-split' ? (
              <FourSplitGrid
                tab={t}
                hasBg={hasBg}
                bgUrl={bgUrl}
                bgType={bgType}
                paneCount={2}
              />
            ) : t.tool === 'three-split' ? (
              <FourSplitGrid
                tab={t}
                hasBg={hasBg}
                bgUrl={bgUrl}
                bgType={bgType}
                paneCount={3}
              />
            ) : t.tool === 'four-split' ? (
              // Independent Quad: 4 side-by-side PTYs, each its own CLI +
              // folder, zero coordination.
              <FourSplitGrid
                tab={t}
                hasBg={hasBg}
                bgUrl={bgUrl}
                bgType={bgType}
                paneCount={4}
              />
            ) : (
              <>
                <div className="terminal-mode-surface" style={{ display: supportsConversationTool(t.tool) && t.viewMode === 'chat' ? 'none' : 'flex' }}>
                  <ErrorBoundary key={`err-${t.id}-${t.restartKey || 0}`} fallbackLabel="Tier Terminal Error">
                    <TierTerminal
                      key={`tier-${t.id}-${t.restartKey || 0}`}
                      sessionId={t.id}
                      tool={t.tool}
                      toolName={AGENT_CATALOG.find(a => a.key === t.tool)?.label}
                      theme={state.currentTheme}
                      lang={state.currentLang}
                      isActive={t.id === activeTerminalId && !diffTabActive && !previewTabActive && (!supportsConversationTool(t.tool) || t.viewMode !== 'chat')}
                      conversationActive={t.id === activeTerminalId && !diffTabActive && !previewTabActive && supportsConversationTool(t.tool) && t.viewMode === 'chat'}
                      toolData={t.toolData}
                      folderPath={t.folderPath}
                      resumeToken={t.resumeToken}
                      hasBg={hasBg && (!supportsConversationTool(t.tool) || t.viewMode !== 'chat')}
                      bgUrl={supportsConversationTool(t.tool) && t.viewMode === 'chat' ? '' : bgUrl}
                      bgType={bgType}
                      termColorScheme={state.termColorScheme}
                      termFont={state.termFont}
                    />
                  </ErrorBoundary>
                </div>
                {supportsConversationTool(t.tool) && (
                  <div
                    className="conversation-mode-surface"
                    style={{ display: t.viewMode === 'chat' ? 'flex' : 'none' }}
                  >
                    <ErrorBoundary fallbackLabel="Conversation Error">
                      <ConversationView
                        key={`conversation-${t.id}-${t.tool}-${t.folderPath ?? ''}-${t.resumeToken ?? ''}-${t.startedAt ?? 0}-${t.restartKey ?? 0}`}
                        sessionId={t.id}
                        tool={t.tool}
                        folderPath={t.folderPath}
                        resumeToken={t.resumeToken}
                        startedAt={t.startedAt}
                        pending={t.chatPending}
                        agentStatus={t.agentStatus}
                        isActive={t.id === activeTerminalId && !diffTabActive && (t.viewMode === 'chat' || Boolean(t.chatPending))}
                        isVisible={t.viewMode === 'chat'}
                        onPendingResolved={() => dispatch({ type: 'SET_CHAT_PENDING', id: t.id })}
                        onPasteToDraft={(text) => dispatch({ type: 'APPEND_GAMBIT_DRAFT', id: t.id, text })}
                        hasBg={hasBg && t.viewMode === 'chat'}
                        bgUrl={t.viewMode === 'chat' ? bgUrl : ''}
                        bgType={bgType}
                        competingBindings={state.terminals
                          .filter(other =>
                            other.id !== t.id &&
                            other.tool === t.tool &&
                            Boolean(other.chatPending) &&
                            (other.folderPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
                              (t.folderPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
                          )
                          .map(other => ({
                            startedAt: other.startedAt,
                            sentAt: other.chatPending?.sentAt,
                          }))}
                      />
                    </ErrorBoundary>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null)}

        {/* Diff tab content — fills the content area when the diff tab is
            focused. The DiffPanel body handles its own loading/error/too-large
            states; mode="tab" makes it fill this slot (no portal/backdrop). */}
        {diffTabVisible && diffTabActive && state.diffSelection && (
          <div className="terminal-wrapper" style={{ display: 'flex', width: '100%', height: '100%', position: 'relative' }}>
            <DiffPanel
              mode="tab"
              path={state.diffSelection.path}
              repoRoot={state.diffSelection.repoRoot}
              rel={state.diffSelection.rel}
              kind={state.diffSelection.kind}
              commitHash={state.diffSelection.commitHash}
              onClose={() => dispatch({ type: 'CLEAR_DIFF' })}
              onToggleExpanded={() => dispatch({ type: 'SET_DIFF_MODE', mode: 'overlay' })}
              added={state.diffSelection.added}
              deleted={state.diffSelection.deleted}
            />
          </div>
        )}

        {previewTabVisible && previewTabActive && state.previewSelection && (
          <div className="terminal-wrapper" style={{ display: 'flex', width: '100%', height: '100%', position: 'relative' }}>
            <MarkdownPreview path={state.previewSelection} surface="tab" />
          </div>
        )}

        {isLaunchpadMode && activeTerminalId && !diffTabActive && !previewTabActive && (
          <div className={`launchpad-container${hasBg && bgUrl ? ' launchpad-has-bg' : ''}`} style={{ position: 'relative' }}>
            {hasBg && bgUrl && (
              <div className="launchpad-bg">
                {bgType === 'video'
                  ? <video src={bgUrl} autoPlay loop muted playsInline onError={() => { setBgUrl(''); }} />
                  : <img src={bgUrl} alt="" onError={() => { setBgUrl(''); }} />}
              </div>
            )}
            {/* Close button removed: handles via Tab bar */}
            <div className="launchpad-slider-viewport">
              <div className={`launchpad-slider-track ${showLibrary ? 'slide-to-library' : ''}`}>

                {/* ─── Page 1: Desktop (pinned items) ─── */}
                <div className="launchpad-page">
                  <div className="launchpad-inner">
                    {(() => {
                      const pinnedAgents = AGENT_CATALOG.filter(a => pinnedItems.includes(`agent:${a.key}`));

                      if (pinnedAgents.length === 0) {
                        return null;
                      }

                      // Coordinated multi-agent is single-instance. If any
                      // Concurrent multi-agent Tabs are now supported —
                      // each Tab gets its own per-pane MCP servers on
                      // distinct ports, Claude panes write zero workspace
                      // files, and the MCP `list_panes` / `send_to_pane`
                      // tools filter by Tab id. So we no longer grey out
                      // the multi-agent cards just because one Tab is
                      // already open.
                      return (
                        <div className="launchpad-grid">
                          {pinnedAgents.map(tool => {
                            const isTerminal = tool.key === 'terminal';
                            const installed = isTerminal || toolsInstalled[tool.key ?? ''] !== false;
                            const disabled = !installed;
                            return (
                              <div key={`agent-${tool.key}`} className={`launchpad-card-group ${disabled ? 'launchpad-card-disabled' : ''}`}>
                                <div
                                  className="launchpad-card"
                                  onClick={() => {
                                    if (disabled) return;
                                    // The "Coffee 101" card (key kept as
                                    // 'installer' for backward compat with
                                    // pinned-state in localStorage) is no
                                    // longer a one-click installer — that
                                    // approach was abandoned because reliable
                                    // cross-platform install of git/node/
                                    // python + each AI CLI is intractable
                                    // and failure modes leave users worse off
                                    // than self-serve. The card now opens the
                                    // Claude Code course on coffeecli.com,
                                    // which is the upstream of all our
                                    // install/usage knowledge.
                                    if (tool.key === 'installer') {
                                      commands.openUrl('https://coffeecli.com/courses/claude-code').catch(() => {});
                                      return;
                                    }
                                    selectTool(tool.key, undefined, lastCwdByTool[tool.key!]);
                                  }}
                                >
                                  <div className="launchpad-icon">{tool.icon}</div>
                                  <div className="launchpad-card-info">
                                    <span style={isTerminal ? { display: 'inline-flex', alignItems: 'center', gap: '6px' } : undefined}>
                                      {tool.label}
                                      {isTerminal && (
                                        <span
                                          className="remote-link-hint"
                                          onClick={(e) => { e.stopPropagation(); setShowRemoteForm(true); }}
                                        >
                                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M2 12h20"/>
                                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                                          </svg>
                                        </span>
                                      )}
                                    </span>
                                    {tool.requiresCwd && lastCwdByTool[tool.key!] && (
                                      <span className="launchpad-card-cwd">
                                        {formatCwd(lastCwdByTool[tool.key!])}
                                      </span>
                                    )}
                                  </div>
                                  {tool.requiresCwd && (
                                    <div className="launchpad-folder-btn" onClick={(e) => {
                                      e.stopPropagation();
                                      if (disabled) return;
                                      // No recents yet → behave like before (straight to the picker).
                                      if (recentFolders.length === 0) { handlePickFolder(tool.key!); return; }
                                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                      setFolderMenu({ x: r.left, y: r.bottom + 4, tool: tool.key! });
                                    }}>
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                      </svg>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                        </div>
                      );
                    })()}

                    {/* "Can't detect?" help link - for users whose PATH was
                        garbled by an English-only AI terminal tool: CJK /
                        non-ASCII path segments become mojibake so `where`
                        can't resolve the binary and the card stays greyed.
                        Hover reveals the cause + 3 fixes. Sits between the
                        pinned cards and the heatmap; tiny + muted so it
                        doesn't compete with the cards. Tooltip is a themed
                        data-tip pill (same pattern as the heatmap / commit
                        subject tooltips), not a native title=. */}
                    <div className="detect-help">
                      <span
                        className="detect-help-trigger"
                        data-tip={t('launchpad.detect_help_tip')}
                      >
                        {t('launchpad.detect_help_trigger')}
                      </span>
                      {/* "Switch model" — external link to EchoBird, our
                          sister project for switching/comparing AI models.
                          Sits next to "Can't detect?" in the same muted
                          footer row. Tooltip explains where it goes; click
                          opens via commands.openUrl (system browser, NOT an
                          in-app webview — we don't do in-app viewers, see
                          feedback_no_in_app_file_viewers). Same data-tip pill
                          pattern as the detect-help trigger. */}
                      <a
                        className="switch-model-trigger"
                        href="https://echobird.ai/"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-tip={t('launchpad.switch_model_tip')}
                        onClick={(e) => {
                          e.preventDefault();
                          commands.openUrl('https://echobird.ai/').catch(() => {});
                        }}
                      >
                        {t('launchpad.switch_model_trigger')}
                      </a>
                    </div>

                    {/* Activity heatmap — sits below the pinned cards so
                        when Gambit's input panel grows from the bottom and
                        squeezes available height, the heatmap (decorative)
                        gets cropped first, not the pinned cards (functional).
                        Renders independently of pinned state so a brand-
                        new install still sees the grid. */}
                    <ContributionHeatmap />

                    {/* ─── Remote Terminal Connection Form ─── */}
                    {showRemoteForm && (
                      <div className="remote-form-overlay">
                        <div className="remote-form-wrapper">
                          <div className="remote-form-card">
                            <div className="remote-form-header">
                            <TerminalIcon />
                            <span>{t('remote.title')}</span>
                            <button className="remote-form-close" onClick={() => setShowRemoteForm(false)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                          </div>
                          <div className="remote-form-body">
                            {/* Protocol Toggle */}
                            <div className="remote-protocol-toggle">
                              <button
                                className={`remote-proto-btn ${remoteProtocol === 'ssh' ? 'active' : ''}`}
                                onClick={() => { setRemoteProtocol('ssh'); setSshPort('22'); }}
                              >SSH</button>
                              <button
                                className={`remote-proto-btn ${remoteProtocol === 'ws' ? 'active' : ''}`}
                                onClick={() => { setRemoteProtocol('ws'); setSshPort('7681'); }}
                              >WebSocket</button>
                            </div>
                            <div className="remote-form-row">
                              <label>{t('remote.host')}</label>
                              <div className="remote-form-host-row">
                                <input
                                  type="text"
                                  placeholder={t('remote.host_placeholder') || "192.168.1.100"}
                                  value={sshHost}
                                  onChange={e => setSshHost(e.target.value)}
                                  className="remote-input remote-input-host"
                                  autoFocus
                                  onKeyDown={e => e.key === 'Enter' && handleRemoteConnect()}
                                />
                                <span className="remote-port-sep">:</span>
                                <input
                                  type="text"
                                  placeholder={remoteProtocol === 'ssh' ? '22' : '7681'}
                                  value={sshPort}
                                  onChange={e => setSshPort(e.target.value)}
                                  className="remote-input remote-input-port"
                                  onKeyDown={e => e.key === 'Enter' && handleRemoteConnect()}
                                />
                              </div>
                            </div>
                            {remoteProtocol === 'ssh' && (
                              <>
                                <div className="remote-form-row">
                                  <label>{t('remote.username')}</label>
                                  <input
                                    type="text"
                                    placeholder="root"
                                    value={sshUser}
                                    onChange={e => setSshUser(e.target.value)}
                                    className="remote-input"
                                    onKeyDown={e => e.key === 'Enter' && handleRemoteConnect()}
                                  />
                                </div>
                                <div className="remote-form-row">
                                  <label>{t('remote.password')}</label>
                                  <input
                                    type="password"
                                    value={sshPass}
                                    onChange={e => setSshPass(e.target.value)}
                                    className="remote-input"
                                    onKeyDown={e => e.key === 'Enter' && handleRemoteConnect()}
                                  />
                                </div>
                              </>
                            )}
                            <button
                              className={`remote-connect-btn status-${connStatus}`}
                              onClick={handleRemoteConnect}
                              disabled={!sshHost.trim() || (remoteProtocol === 'ssh' && !sshUser.trim()) || connStatus !== 'idle'}
                            >
                              {connStatus === 'connecting' && t('remote.connecting')}
                              {connStatus === 'failed' && t('remote.connect_failed')}
                              {connStatus === 'idle' && t('remote.connect')}
                            </button>
                          </div>
                        </div>

                        {/* History Pills */}
                        {remoteHistory.length > 0 && (
                          <div className="remote-history-pills">
                            {remoteHistory.map(item => (
                              <div
                                key={item.id}
                                className={`remote-pill remote-pill-${item.protocol}`}
                                onClick={async () => {
                                  setRemoteProtocol(item.protocol);
                                  setSshHost(item.host);
                                  setSshPort(item.port);
                                  if (item.protocol === 'ssh') setSshUser(item.user);
                                  
                                  setConnStatus('connecting');
                                  saveRemoteHistory(item); // Refresh history order
                                  
                                  let isOffline = false;
                                  try {
                                    const portNum = parseInt(item.port) || (item.protocol === 'ssh' ? 22 : 7681);
                                    const isReachable = await commands.checkNetworkPort(item.host.trim(), portNum);
                                    if (!isReachable) isOffline = true;
                                  } catch {
                                    isOffline = true;
                                  }

                                  if (isOffline) {
                                    setConnStatus('failed');
                                    setTimeout(() => setConnStatus('idle'), 3000);
                                    return;
                                  }

                                  const connDataObj = {
                                    protocol: item.protocol,
                                    host: item.host.trim(),
                                    port: parseInt(item.port) || (item.protocol === 'ssh' ? 22 : 7681),
                                    username: item.user || '',
                                    // password omitted from localStorage
                                  };
                                  try { localStorage.setItem('coffee_remote_cfg', JSON.stringify(connDataObj)); } catch { /* Best-effort operation; failure is non-fatal. */ }
                                  // Load password for this specific host from keychain, fall back to current sshPass state
                                  const doConnect = (pw: string) => {
                                    if (isTauri && pw) commands.savePassword(item.host.trim(), item.user || '', pw).catch(() => {});
                                    selectTool('remote', JSON.stringify({ ...connDataObj, password: pw }));
                                  };
                                  if (isTauri && item.host && item.user) {
                                    commands.loadPassword(item.host.trim(), item.user)
                                      .then(pw => doConnect(pw ?? sshPass))
                                      .catch(() => doConnect(sshPass));
                                  } else {
                                    doConnect(sshPass);
                                  }
                                  setShowRemoteForm(false);
                                  setConnStatus('idle');
                                }}
                              >
                                <span className="remote-pill-proto">{item.protocol}</span>
                                <span>{item.host}</span>
                                <button className="remote-pill-close" onClick={(e) => deleteRemoteHistory(item.id, e)}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  </div>
                </div>

                {/* Page 2: Library (Agents) */}
                <div className="launchpad-page library-page">
                  <div className="launchpad-inner">
                        {/* Section 1: AI CLI agents (3-col) */}
                        <div className="library-grid">
                          {AGENT_CATALOG.filter(item => item.type === 'ai-cli').map(item => {
                            const pinId = `agent:${item.key}`;
                            const isPinned = pinnedItems.includes(pinId);
                            const hasGear = CONFIGURABLE_AGENT_TOOLS.has(item.key);
                            return (
                              <div
                                key={item.key}
                                className={`library-item ${isPinned ? 'is-pinned' : ''}`}
                                onClick={() => togglePin(pinId)}
                              >
                                <div className="library-item-icon">{item.icon}</div>
                                <span className="library-item-name">{item.label}</span>
                                {hasGear && (
                                  <span
                                    className="library-gear-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfigModalTool({ key: item.key as string, label: item.label });
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="3"/>
                                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                    </svg>
                                  </span>
                                )}
                                <div className={`library-toggle${isPinned ? ' on' : ''}`}><div className="library-toggle-knob" /></div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Section 2: Agent Tools (3-col, split tools first, Coffee 101 last) */}
                        <div className="library-section-title">{t('library.agent_tools')}</div>
                        <div className="library-grid library-grid--tools">
                          {AGENT_CATALOG.filter(item => item.type === 'utility').map(item => {
                            const pinId = `agent:${item.key}`;
                            const isPinned = pinnedItems.includes(pinId);
                            // Utility tools (multi-agent / Coffee 101 /
                            // hyper-agent / N-split) don't take a launch
                            // path — no gear, just border-as-state.
                            return (
                              <div
                                key={item.key}
                                className={`library-item ${isPinned ? 'is-pinned' : ''}`}
                                onClick={() => togglePin(pinId)}
                              >
                                <div className="library-item-icon">{item.icon}</div>
                                <span className="library-item-name">{item.label}</span>
                              <div className={`library-toggle${isPinned ? ' on' : ''}`}><div className="library-toggle-knob" /></div>
                              </div>
                            );
                          })}
                        </div>
                  </div>

                </div>

              </div>
            </div>

            {/* ── Top-anchored chrome (always mounted, opacity-toggled) ──
                Placed OUTSIDE the slider track so it doesn't slide
                horizontally with the page transition. Instead each
                chrome group cross-fades against the other based on
                showLibrary. Slide is for content (nav between modes);
                fade is for chrome (the mode label). Mixing the two
                kinds of motion reads more polished than forcing one
                animation type onto both. */}
            <div
              className={`launchpad-chrome launchpad-chrome--desktop ${showLibrary ? '' : 'is-visible'}`}
              aria-hidden={showLibrary}
            >
              <button
                className="mode-switch-btn"
                onClick={() => setShowLibrary(true)}
                aria-label="Open library"
              >
                <div className="mode-switch-icon">
                  {/* 2×2 app grid = "open the tools/apps library" — the
                      macOS Launchpad / iOS App Library metaphor for this
                      button's actual job. The "+" in the last cell reads as
                      "more / add a tool". Replaces the former gear, which
                      collided with the settings-screen gear and mis-read as
                      "设置" rather than "应用页". A grid is concrete here, not
                      abstract — it depicts the apps the button opens. */}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/>
                    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/>
                    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/>
                    <line x1="17.25" y1="14.3" x2="17.25" y2="20.2"/>
                    <line x1="14.3" y1="17.25" x2="20.2" y2="17.25"/>
                  </svg>
                </div>
              </button>
            </div>

            <div
              className={`launchpad-chrome launchpad-chrome--library ${showLibrary ? 'is-visible' : ''}`}
              aria-hidden={!showLibrary}
            >
              <button
                className="mode-switch-btn launchpad-chrome-back"
                onClick={() => setShowLibrary(false)}
                aria-label="Back to desktop"
              >
                <div className="mode-switch-icon">
                  {/* Pure chevron < — no extension line, fewer strokes,
                      visually paired with the gear (both naked glyphs,
                      same stroke width, same hit area). */}
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </div>
              </button>
              <div className="library-counter">{pinnedItems.length} / {MAX_PINS}</div>
            </div>

          </div>
                )}
      </div>

      {/* Per-tool launch override modal. Mounted at root so its fixed-
          position backdrop covers the whole window, not just the
          launchpad area. */}
      {configModalTool && (
        <ToolConfigModal
          toolKey={configModalTool.key}
          toolLabel={configModalTool.label}
          onClose={() => setConfigModalTool(null)}
        />
      )}
      {folderMenu && (
        <RecentFolderMenu
          x={folderMenu.x}
          y={folderMenu.y}
          recent={recentFolders}
          openLabel={t('launchpad.open_folder') || 'Open folder…'}
          onPick={(f) => { selectTool(folderMenu.tool, undefined, f); setFolderMenu(null); }}
          onRemove={(f) => removeRecentFolder(f)}
          onOpenNew={() => { const tk = folderMenu.tool; setFolderMenu(null); handlePickFolder(tk); }}
          onClose={() => setFolderMenu(null)}
        />
      )}
    </>
  );
}

