import type { Context } from '../types';

/**
 * Pull `#context` tokens out of the title. Tokens matching an existing context
 * (case-insensitive) become tag ids and are stripped; unmatched ones stay literal.
 */
export function parseTags(title: string, contexts: Context[]): { title: string; tagIds: string[] } {
  const byName = new Map(contexts.map((c) => [c.name.toLowerCase(), c.id]));
  const tagIds: string[] = [];
  const cleaned = title.replace(/#([\p{L}\p{N}_-]+)/gu, (full, word: string) => {
    const id = byName.get(word.toLowerCase());
    if (!id) return full;
    if (!tagIds.includes(id)) tagIds.push(id);
    return '';
  });
  return { title: cleaned.replace(/\s{2,}/g, ' ').trim(), tagIds };
}
