import { useState } from 'react';
import type { Context } from '../types';
import { createTask } from '../lib/store';

interface Props {
  contexts: Context[];
  /** When a filter context is active, pre-tag new tasks with it. */
  activeContextId: string | null;
  /** Text shared into the app via the PWA share target, used to prefill the input. */
  initialTitle?: string;
}

/**
 * Pull `#context` tokens out of the title. Tokens matching an existing context
 * (case-insensitive) become tag ids and are stripped; unmatched ones stay literal.
 */
function parseTags(title: string, contexts: Context[]): { title: string; tagIds: string[] } {
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

export function CaptureBar({ contexts, activeContextId, initialTitle = '' }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState<string[]>(activeContextId ? [activeContextId] : []);
  const [showTags, setShowTags] = useState(false);

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { title: parsedTitle, tagIds } = parseTags(title, contexts);
    if (!parsedTitle) return;
    const merged = [...new Set([...tags, ...tagIds])];
    createTask(parsedTitle, merged);
    setTitle('');
    setTags(activeContextId ? [activeContextId] : []);
    setShowTags(false);
  }

  return (
    <form onSubmit={submit} className="border-b border-line bg-bg/95 px-4 pb-3 pt-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          enterKeyHint="done"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
        />
        {contexts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTags((s) => !s)}
            aria-label="Add context tags"
            className={`shrink-0 rounded-xl border px-3 py-3 text-sm transition ${
              tags.length > 0 || showTags
                ? 'border-accent text-accent'
                : 'border-line text-muted'
            }`}
          >
            {tags.length > 0 ? `#${tags.length}` : '#'}
          </button>
        )}
        <button
          type="submit"
          disabled={!title.trim()}
          className="shrink-0 rounded-xl bg-accent px-4 py-3 font-medium text-black transition active:scale-95 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {showTags && contexts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {contexts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleTag(c.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                tags.includes(c.id)
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line text-muted'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
