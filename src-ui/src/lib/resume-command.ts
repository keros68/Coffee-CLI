// Resume command builder — backed by `list_tools` IPC (`lib/tool-info.ts`,
// sourced directly from `AGENT_PRESETS` in `src/terminal.rs`), with a static
// fallback table for pre-IPC boot and non-Tauri browser previews.

import { getToolResumeShape, type ToolResumeShape } from './tool-info';

const FALLBACK_RESUME_SHAPES: Record<string, ToolResumeShape> = {
  claude:      { program: 'claude',    argsBefore: ['--resume'] },
  antigravity: { program: 'agy',       argsBefore: ['--conversation'] },
  hermes:      { program: 'hermes',    argsBefore: ['--resume'] },
  opencode:    { program: 'opencode',  argsBefore: ['--session'] },
  mimocode:    { program: 'mimo',      argsBefore: ['--session'] },
  kilo:        { program: 'kilo',      argsBefore: ['--session'] },
  codex:       { program: 'codex',     argsBefore: ['resume'] },
  grok:        { program: 'grok',      argsBefore: ['--resume'] },
  qwen:        { program: 'qwen',      argsBefore: ['--resume'] },
  pi:          { program: 'pi',        argsBefore: ['--session'] },
  omp:         { program: 'omp',       argsBefore: ['--resume'] },
  codebuddy:   { program: 'codebuddy', argsBefore: ['--resume'] },
  kimicode:    { program: 'kimi',      argsBefore: ['--session'] },
  // openclaw has resume_program: None in AGENT_PRESETS - no CLI resume.
};

/** Returns the copy-pasteable resume command for a tool+token, or null if
 *  the tool doesn't support CLI resume (openclaw / T3) or the token is missing. */
export function buildResumeCommand(tool: string, token: string | null): string | null {
  if (!token) return null;
  const live = getToolResumeShape(tool);
  const shape = live !== undefined ? live : (FALLBACK_RESUME_SHAPES[tool] ?? null);
  if (!shape) return null;
  return [shape.program, ...shape.argsBefore, token].join(' ');
}
