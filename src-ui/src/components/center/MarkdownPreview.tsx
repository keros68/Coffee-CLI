import { useEffect, useState } from 'react'
import { useAppDispatch } from '../../store/app-state'
import { readTextFile } from '../../tauri'
import { useT } from '../../i18n/useT'
import { fileBaseName } from '../../lib/file-types'
import { MarkdownContent } from './MarkdownContent'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  /** Absolute path of the Markdown file to render. */
  path: string
  /** "tab" owns the center tab chrome (close button); "embedded" lives inside
   *  the diff panel, where the panel header already carries the file name. */
  surface?: 'tab' | 'embedded'
}

export function MarkdownPreview({ path, surface = 'tab' }: MarkdownPreviewProps) {
  const dispatch = useAppDispatch()
  const t = useT()
  // Loaded content is tagged with the request it belongs to, so "loading" is
  // derived instead of set inside the effect (avoids cascading renders).
  const [doc, setDoc] = useState<{ key: string; content: string; error: string | null } | null>(null)
  const [view, setView] = useState<{ path: string; mode: 'rendered' | 'source' }>({ path: '', mode: 'rendered' })
  const [reloadSeq, setReloadSeq] = useState(0)
  const loadKey = `${path}\u0000${reloadSeq}`

  useEffect(() => {
    if (!path) return
    let cancelled = false
    readTextFile(path)
      .then((text) => {
        if (cancelled) return
        setDoc({ key: loadKey, content: text, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setDoc({ key: loadKey, content: '', error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [path, loadKey])

  if (!path) return null

  const loading = doc?.key !== loadKey
  const content = doc?.key === loadKey ? doc.content : ''
  const error = doc?.key === loadKey ? doc.error : null
  const mode = view.path === path ? view.mode : 'rendered'
  const setMode = (next: 'rendered' | 'source') => setView({ path, mode: next })

  const fileName = fileBaseName(path)

  return (
    <div className={`md-preview${surface === 'embedded' ? ' md-preview--embedded' : ''}`}>
      <div className="md-preview__header">
        <div className="md-preview__path" title={path}>
          <span className="md-preview__badge">{t('preview.badge')}</span>
          <span className="md-preview__name">{fileName}</span>
          <span className="md-preview__fullpath">{path}</span>
        </div>

        <div className="md-preview__actions">
          <div className="md-preview__mode-switch" role="tablist">
            <button
              type="button"
              className={`md-preview__mode-btn ${mode === 'rendered' ? 'md-preview__mode-btn--active' : ''}`}
              onClick={() => setMode('rendered')}
              title={t('preview.rendered')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{t('preview.rendered')}</span>
            </button>
            <button
              type="button"
              className={`md-preview__mode-btn ${mode === 'source' ? 'md-preview__mode-btn--active' : ''}`}
              onClick={() => setMode('source')}
              title={t('preview.source')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span>{t('preview.source')}</span>
            </button>
          </div>

          <button
            type="button"
            className="md-preview__icon-btn"
            onClick={() => setReloadSeq((n) => n + 1)}
            title={t('preview.reload')}
            aria-label={t('preview.reload')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
          {surface === 'tab' && (
            <button
              type="button"
              className="md-preview__icon-btn"
              onClick={() => dispatch({ type: 'CLOSE_PREVIEW_TAB' })}
              title={t('preview.close')}
              aria-label={t('preview.close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="md-preview__body">
        {loading && (
          <div className="md-preview__state">{t('preview.loading')}</div>
        )}
        {!loading && error && (
          <div className="md-preview__state md-preview__state--error">
            <span>{t('preview.error', { msg: error })}</span>
          </div>
        )}
        {!loading && !error && content.trim().length === 0 && (
          <div className="md-preview__state">{t('preview.empty')}</div>
        )}
        {!loading && !error && content.trim().length > 0 && mode === 'rendered' && (
          <article className="md-preview__article">
            <MarkdownContent content={content} />
          </article>
        )}
        {!loading && !error && content.trim().length > 0 && mode === 'source' && (
          <pre className="md-preview__source">
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
