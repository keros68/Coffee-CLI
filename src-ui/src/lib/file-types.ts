const MARKDOWN_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkd',
  'mkdn',
  'mdx',
])

export function isMarkdownFilePath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  const clean = filePath.trim().replace(/[\\/]+$/, '')
  const base = clean.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return false
  return MARKDOWN_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

export function fileBaseName(filePath: string): string {
  const clean = filePath.trim().replace(/[\\/]+$/, '')
  return clean.split(/[\\/]/).pop() || filePath
}
