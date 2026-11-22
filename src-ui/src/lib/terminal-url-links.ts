// URLs are ASCII per RFC 3986; the \u0080-\uffff guard stops the match at
// any non-ASCII char so trailing CJK punctuation/text (e.g. "https://x，看到…")
// doesn't get swallowed into the link.
export const LINK_RE = /(https?:\/\/[^\s<>()"'\u0080-\uffff]+|file:\/\/\/[^\s<>()"'\u0080-\uffff]+)/g;

/** A matched URL without the punctuation or Markdown emphasis (**https://…**) that follows it in prose. */
export const trimLink = (url: string): string => url.replace(/[),.*_~]+$/, '');

export interface ParsedOsc8Link {
  /** Safe URI to pass to `commands.openUrl`. */
  target: string;
  /** Native local file path for `file://` URIs (backs right-click file actions). */
  localPath: string | null;
}

/** Validate an OSC 8 hyperlink URI and extract a local path when it uses `file:`. */
export function parseOsc8Link(raw: string): ParsedOsc8Link | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
    return { target: trimmed, localPath: null };
  }
  if (proto === 'file:') {
    let pathname = parsed.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Fall back to raw pathname if malformed percent-encoding appears.
    }
    let localPath: string;
    if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
      localPath = `\\\\${parsed.hostname}${pathname.replace(/\//g, '\\')}`;
    } else if (/^\/[A-Za-z]:\//.test(pathname)) {
      localPath = pathname.slice(1).replace(/\//g, '\\');
    } else {
      localPath = pathname;
    }
    return { target: trimmed, localPath };
  }
  return null;
}
