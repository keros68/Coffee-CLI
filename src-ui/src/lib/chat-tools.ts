import type { ToolType } from '../store/app-state';

const ENHANCED_TOOLS = new Set<ToolType>([
  'claude', 'codex', 'kimicode',
]);

// Kimi Code paints an inverse-video caret and hides the terminal cursor.
// Claude Code and Codex move the real terminal cursor to the input instead,
// so they must keep it visible.
const SELF_RENDERED_CARET_TOOLS = new Set<ToolType>([
  'kimicode',
]);

/** Tools with source-grounded enhanced integration. All other tools stay
 * terminal-only, even when their native TUI happens to resemble a selector. */
export function supportsEnhancedTool(tool: ToolType | null | undefined): boolean {
  return Boolean(tool && ENHANCED_TOOLS.has(tool));
}

export function supportsConversationTool(tool: ToolType | null | undefined): boolean {
  return supportsEnhancedTool(tool);
}

/** Only hide xterm's cursor when the upstream TUI is verified to paint its own. */
export function usesSelfRenderedCaret(tool: ToolType | null | undefined): boolean {
  return Boolean(tool && SELF_RENDERED_CARET_TOOLS.has(tool));
}
