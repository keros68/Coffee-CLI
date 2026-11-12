// Per-tool launch override & global memory modal.
//
// Reached from the small gear on Library cards. Lets the user override
// how a specific CLI tool is spawned (launch path, extra args, default cwd,
// custom history scan path) AND edit the tool's global memory file
// (CLAUDE.md, AGENTS.md, GEMINI.md, SOUL.md, copilot-instructions.md).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { commands, type ToolConfigEntry, type ToolMemoryDocument } from '../../tauri';
import { useT } from '../../i18n/useT';

interface Props {
  toolKey: string;
  toolLabel: string;
  onClose: () => void;
}

const EMPTY: ToolConfigEntry = {
  command: '',
  extra_args: [],
  default_cwd: '',
  history_path: '',
};

const TOOL_DEFAULTS: Record<string, ToolConfigEntry> = {
  claude:      { command: 'claude',    extra_args: [], default_cwd: '', history_path: '~/.claude/projects' },
  codex:       { command: 'codex',     extra_args: [], default_cwd: '', history_path: '~/.codex/sessions' },
  grok:        { command: 'grok',      extra_args: [], default_cwd: '', history_path: '~/.grok/sessions' },
  antigravity: { command: 'agy',       extra_args: [], default_cwd: '', history_path: '~/.gemini/tmp' },
  qwen:        { command: 'qwen',      extra_args: [], default_cwd: '', history_path: '' },
  opencode:    { command: 'opencode',  extra_args: [], default_cwd: '', history_path: '~/.local/share/opencode' },
  mimocode:    { command: 'mimo',      extra_args: [], default_cwd: '', history_path: '~/.local/share/mimocode' },
  kilo:        { command: 'kilo',      extra_args: [], default_cwd: '', history_path: '~/.local/share/kilo' },
  openclaw:    { command: 'openclaw',  extra_args: [], default_cwd: '', history_path: '~/.openclaw/agents' },
  hermes:      { command: 'hermes',    extra_args: [], default_cwd: '', history_path: '' },
  pi:          { command: 'pi',        extra_args: [], default_cwd: '', history_path: '~/.pi/agent/sessions' },
  omp:         { command: 'omp',       extra_args: [], default_cwd: '', history_path: '~/.omp/agent/sessions' },
  codebuddy:   { command: 'codebuddy', extra_args: [], default_cwd: '', history_path: '~/.codebuddy/projects' },
  kimicode:    { command: 'kimi',      extra_args: [], default_cwd: '', history_path: '~/.kimi-code' },
  copilot:     { command: 'copilot',   extra_args: [], default_cwd: '', history_path: '' },
};

const HISTORY_SCANNED_TOOLS = new Set([
  'claude', 'codex', 'grok', 'antigravity', 'hermes', 'opencode', 'openclaw', 'mimocode', 'kilo', 'pi', 'kimicode', 'omp', 'codebuddy',
]);

const MEMORY_SUPPORTED_TOOLS = new Set([
  'claude', 'codex', 'copilot', 'opencode', 'pi', 'omp', 'hermes', 'antigravity', 'kimicode',
]);

const defaultsFor = (key: string): ToolConfigEntry => TOOL_DEFAULTS[key] ?? EMPTY;

function withFallback(user: ToolConfigEntry, def: ToolConfigEntry): ToolConfigEntry {
  return {
    command:      user.command      || def.command,
    extra_args:   user.extra_args.length ? user.extra_args : def.extra_args,
    default_cwd:  user.default_cwd  || def.default_cwd,
    history_path: user.history_path || def.history_path,
  };
}

function diffField<T extends string | string[]>(value: T, defaultValue: T): T {
  if (Array.isArray(value) && Array.isArray(defaultValue)) {
    const a = value.join('\n'); const b = defaultValue.join('\n');
    return (a === b ? ([] as unknown as T) : value);
  }
  return value === defaultValue ? ('' as unknown as T) : value;
}

export function ToolConfigModal({ toolKey, toolLabel, onClose }: Props) {
  const t = useT();
  const def = useMemo(() => defaultsFor(toolKey), [toolKey]);
  const hasMemory = MEMORY_SUPPORTED_TOOLS.has(toolKey);
  const [activeTab, setActiveTab] = useState<'launch' | 'memory'>('launch');

  // Launch settings state
  const [entry, setEntry] = useState<ToolConfigEntry>(def);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [extraArgsText, setExtraArgsText] = useState('');

  // Global memory state
  const [memDoc, setMemDoc] = useState<ToolMemoryDocument | null>(null);
  const [memText, setMemText] = useState('');
  const [memLoading, setMemLoading] = useState(false);
  const [memSaving, setMemSaving] = useState(false);
  const [memSaved, setMemSaved] = useState(false);
  const [memError, setMemError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSaveError(false);
    (async () => {
      try {
        const user = await commands.getToolConfig(toolKey);
        if (cancelled) return;
        const merged = withFallback(user, def);
        setEntry(merged);
        setExtraArgsText(merged.extra_args.join('\n'));
      } catch {
        /* swallow — leave the form at defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [toolKey, def]);

  const loadMemory = useCallback(async () => {
    if (!hasMemory) return;
    setMemLoading(true);
    setMemError(null);
    setMemSaved(false);
    try {
      const doc = await commands.readToolMemory(toolKey);
      setMemDoc(doc);
      setMemText(doc.content);
    } catch {
      setMemError(t('tools.memory.read_error'));
    } finally {
      setMemLoading(false);
    }
  }, [hasMemory, toolKey, t]);

  useEffect(() => {
    if (activeTab === 'memory' && !memDoc && !memLoading) {
      void loadMemory();
    }
  }, [activeTab, memDoc, memLoading, loadMemory]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      const args = extraArgsText.split('\n').map(s => s.trim()).filter(Boolean);
      const payload: ToolConfigEntry = {
        command:      diffField(entry.command.trim(), def.command),
        extra_args:   diffField(args, def.extra_args),
        default_cwd:  diffField(entry.default_cwd.trim(), def.default_cwd),
        history_path: diffField(entry.history_path.trim(), def.history_path),
      };
      await commands.setToolConfig(toolKey, payload);
      onClose();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await commands.setToolConfig(toolKey, EMPTY);
      setEntry(def);
      setExtraArgsText(def.extra_args.join('\n'));
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const memDirty = memDoc !== null && memText !== memDoc.content;

  const handleSaveMemory = useCallback(async () => {
    if (!memDoc || memSaving || memLoading || !memDirty) return;
    setMemSaving(true);
    setMemError(null);
    setMemSaved(false);
    try {
      const saved = await commands.saveToolMemory(toolKey, memText);
      setMemDoc(saved);
      setMemText(saved.content);
      setMemSaved(true);
    } catch {
      setMemError(t('tools.memory.write_error'));
    } finally {
      setMemSaving(false);
    }
  }, [memDoc, memSaving, memLoading, memDirty, toolKey, memText, t]);

  return (
    <div onClick={onClose} className="tool-config-backdrop">
      <div
        onClick={e => e.stopPropagation()}
        className={`tool-config-modal${activeTab === 'memory' ? ' tool-config-modal--wide' : ''}`}
      >
        <div className="tool-config-header">
          <span>{toolLabel}</span>
          {hasMemory && (
            <div className="tool-config-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'launch'}
                className={`tool-config-tab${activeTab === 'launch' ? ' active' : ''}`}
                onClick={() => setActiveTab('launch')}
              >
                {t('tools.title')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'memory'}
                className={`tool-config-tab${activeTab === 'memory' ? ' active' : ''}`}
                onClick={() => setActiveTab('memory')}
              >
                {t('tools.tab.memory')}
              </button>
            </div>
          )}
          <button onClick={onClose} className="tool-config-close" aria-label="close">×</button>
        </div>

        {activeTab === 'launch' ? (
          <>
            {!loading && (
              <div className="tool-config-body">
                {saveError && (
                  <div className="tool-config-error" role="alert">
                    {t('tool_config.save_failed')}
                  </div>
                )}
                <Field
                  label={t('tool_config.command')}
                  value={entry.command}
                  onChange={v => { setSaveError(false); setEntry({ ...entry, command: v }); }}
                />
                <Field
                  label={t('tool_config.extra_args')}
                  value={extraArgsText}
                  onChange={v => { setSaveError(false); setExtraArgsText(v); }}
                  multiline
                  rows={3}
                />
                <Field
                  label={t('tool_config.default_cwd')}
                  value={entry.default_cwd}
                  onChange={v => { setSaveError(false); setEntry({ ...entry, default_cwd: v }); }}
                />
                {HISTORY_SCANNED_TOOLS.has(toolKey) && (
                  <Field
                    label={t('tool_config.history_path')}
                    value={entry.history_path}
                    onChange={v => { setSaveError(false); setEntry({ ...entry, history_path: v }); }}
                    placeholder={toolKey === 'hermes' ? '<HERMES_HOME>/sessions' : undefined}
                  />
                )}
              </div>
            )}

            <div className="tool-config-buttons">
              <button onClick={handleReset} disabled={saving || loading} className="tool-config-btn tool-config-btn-subtle">
                {t('tool_config.reset')}
              </button>
              <button onClick={onClose} disabled={saving} className="tool-config-btn tool-config-btn-subtle">
                {t('tool_config.cancel')}
              </button>
              <button onClick={handleSave} disabled={saving || loading} className="tool-config-btn tool-config-btn-primary">
                {t('tool_config.save')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tool-config-body tool-config-memory-body">
              <div className="tool-config-memory-meta">
                <code className="tool-config-memory-path" title={memDoc?.path}>
                  {memDoc?.path || '…'}
                </code>
                <span className="tool-config-memory-status">
                  {memLoading
                    ? t('diff.loading')
                    : memDirty
                      ? t('tools.memory.unsaved')
                      : memSaved
                        ? t('tools.memory.saved')
                        : ''}
                </span>
                {memDoc?.path && (
                  <button
                    type="button"
                    className="tool-config-btn tool-config-btn-subtle tool-config-btn-sm"
                    onClick={() => { commands.showInFolder(memDoc.path).catch(() => {}); }}
                  >
                    {t('menu.show_in_folder')}
                  </button>
                )}
              </div>

              {memError && (
                <div className="tool-config-error" role="alert">
                  {memError}
                </div>
              )}

              <textarea
                className="tool-config-input tool-config-memory-editor"
                value={memText}
                disabled={memLoading || memSaving}
                spellCheck={false}
                rows={12}
                placeholder={memDoc?.fileName || 'AGENTS.md'}
                onChange={e => {
                  setMemText(e.target.value);
                  setMemSaved(false);
                }}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleSaveMemory();
                  }
                }}
              />
            </div>

            <div className="tool-config-buttons">
              <button
                type="button"
                onClick={() => void loadMemory()}
                disabled={memLoading || memSaving}
                className="tool-config-btn tool-config-btn-subtle"
              >
                {t('tools.memory.reload')}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={memSaving}
                className="tool-config-btn tool-config-btn-subtle"
              >
                {t('tool_config.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveMemory()}
                disabled={memLoading || memSaving || !memDirty}
                className="tool-config-btn tool-config-btn-primary"
              >
                {t('tool_config.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, multiline, rows, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="tool-config-field">
      <span className="tool-config-field-label">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows ?? 3}
          spellCheck={false}
          placeholder={placeholder}
          className="tool-config-input"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          placeholder={placeholder}
          className="tool-config-input"
        />
      )}
    </label>
  );
}
