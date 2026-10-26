// SessionCard — one row of the 会话记录 list.
//
// Extracted from HistoryBoard so the flat list and the sectioned list (分区)
// render identical cards instead of two copies that drift apart. Everything
// list-specific (title resolution, icons, project name, date string, which
// section the row sits in) is computed by the caller and handed in as props:
// this file only knows how a card looks and which events it emits.

import type { ReactNode } from 'react';

export function SessionCard({
  displayName,
  toolIcon,
  metaText,
  hideLabel,
  isRenaming,
  renameValue,
  onOpen,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onHide,
}: {
  displayName: string;
  toolIcon: ReactNode;
  metaText: string;
  /** Accessible name of the hide button. */
  hideLabel: string;
  isRenaming: boolean;
  renameValue: string;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  /** Enter or blur: save the draft. */
  onRenameCommit: () => void;
  /** Escape: discard. Runs before the unmount-induced blur. */
  onRenameCancel: () => void;
  onHide: () => void;
}) {
  return (
    <div className="history-card" onClick={onOpen} onContextMenu={onContextMenu}>
      <div className="history-card-content">
        <div className="history-card-title-row">
          {isRenaming ? (
            <input
              className="history-card-rename-input"
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              // Keep the card's click-to-resume and right-click menu off the
              // editing field.
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onRenameCommit();
                } else if (e.key === 'Escape') {
                  onRenameCancel();
                }
              }}
              onBlur={onRenameCommit}
              onFocus={(e) => e.target.select()}
            />
          ) : (
            <>
              <span className="history-card-title">{displayName}</span>
              {/* One-click soft-delete (hide), revealed in the title row.
                  stopPropagation keeps it from resuming the session. */}
              <button
                type="button"
                className="history-card-delete-btn"
                aria-label={hideLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  onHide();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="m19 6-.867 13.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="history-card-meta">
          <span className="history-card-tool-wrap">
            {toolIcon}
            <span className="history-card-meta-text">{metaText}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Section header for the 分区 view: chevron + name + count, with the group
 *  menu button (rename / stop auto-assigning / delete) revealed on hover. */
export function SessionSectionHeader({
  name,
  count,
  collapsed,
  menuLabel,
  isRenaming,
  renameValue,
  onToggle,
  onMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  menuLabel: string;
  isRenaming: boolean;
  renameValue: string;
  onToggle: () => void;
  /** Omitted for the ungrouped bucket — there is nothing to manage there. */
  onMenu?: (e: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}) {
  return (
    <div className="history-section-header" onClick={() => !isRenaming && onToggle()}>
      <span className={`history-section-chevron${collapsed ? ' collapsed' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      {isRenaming ? (
        <input
          className="history-section-rename-input"
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onRenameCommit();
            } else if (e.key === 'Escape') {
              onRenameCancel();
            }
          }}
          onBlur={onRenameCommit}
          onFocus={(e) => e.target.select()}
        />
      ) : (
        <span className="history-section-name">{name}</span>
      )}
      <span className="history-section-count">{count}</span>
      {onMenu && (
        <button
          type="button"
          className="history-section-menu-btn"
          title={menuLabel}
          aria-label={menuLabel}
          onClick={(e) => {
            e.stopPropagation();
            onMenu(e);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      )}
    </div>
  );
}
