// URLs are ASCII per RFC 3986; the \u0080-\uffff guard stops the match at
// any non-ASCII char so trailing CJK punctuation/text (e.g. "https://x，看到…")
// doesn't get swallowed into the link.
export const LINK_RE = /(https?:\/\/[^\s<>()"'\u0080-\uffff]+|file:\/\/\/[^\s<>()"'\u0080-\uffff]+)/g;

/** A matched URL without the punctuation or Markdown emphasis (**https://…**) that follows it in prose. */
export const trimLink = (url: string): string => url.replace(/[),.*_~]+$/, '');
