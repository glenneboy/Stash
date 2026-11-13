/**
 * A deliberately tiny markdown subset for task notes. Parsed into a plain tree
 * (no HTML strings) so rendering can never inject markup.
 *
 *   **bold**   *italic* / _italic_   __underline__   - bullet / * bullet / • bullet
 *
 * Every line break the user typed is preserved.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'underline'; children: Inline[] };

export type Block =
  | { type: 'line'; children: Inline[] } // a paragraph line; empty children = blank line
  | { type: 'list'; items: Inline[][] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;

// Order matters: two-char markers before their single-char forms.
const MARKERS: { token: string; type: 'bold' | 'italic' | 'underline' }[] = [
  { token: '**', type: 'bold' },
  { token: '__', type: 'underline' },
  { token: '*', type: 'italic' },
  { token: '_', type: 'italic' },
];

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };

  while (i < src.length) {
    const marker = MARKERS.find((m) => src.startsWith(m.token, i));
    if (marker) {
      const start = i + marker.token.length;
      const end = findClose(src, marker.token, start);
      // Needs non-empty content that doesn't start/end with whitespace, so
      // "2 * 3 * 4" and snake_case_words stay literal.
      if (end > start && !/\s/.test(src[start]) && !/\s/.test(src[end - 1]) && !wordy(src, i, end + marker.token.length, marker.token)) {
        flush();
        out.push({ type: marker.type, children: parseInline(src.slice(start, end)) });
        i = end + marker.token.length;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

function findClose(src: string, token: string, from: number): number {
  let j = src.indexOf(token, from);
  // For single-char markers, skip a doubled one (e.g. "*a **b** c*" closes at the last *).
  while (j !== -1 && token.length === 1 && src[j + 1] === token) {
    j = src.indexOf(token, j + 2);
  }
  return j;
}

// Underscore emphasis shouldn't trigger inside words (snake_case).
function wordy(src: string, open: number, closeEnd: number, token: string): boolean {
  if (token[0] !== '_') return false;
  const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  return isWord(src[open - 1]) || isWord(src[closeEnd]);
}

export function parseNote(src: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = raw.match(BULLET);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      const item = parseInline(bullet[1]);
      if (last?.type === 'list') last.items.push(item);
      else blocks.push({ type: 'list', items: [item] });
    } else {
      blocks.push({ type: 'line', children: parseInline(raw) });
    }
  }
  return blocks;
}

/** Plain text without markers — for search and one-line previews. */
export function stripMarkdown(src: string): string {
  const flat = (nodes: Inline[]): string => nodes.map((n) => (n.type === 'text' ? n.text : flat(n.children))).join('');
  return parseNote(src)
    .map((b) => (b.type === 'line' ? flat(b.children) : b.items.map((it) => `• ${flat(it)}`).join('\n')))
    .join('\n');
}
