import { useState } from 'react';
import type { Context } from '../types';
import { createTask } from '../lib/store';

interface Props {
  contexts: Context[];
  /** When a filter context is active, pre-tag new tasks with it. */
  activeContextId: string | null;
}

export function CaptureBar({ contexts, activeContextId }: Props) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>(activeContextId ? [activeContextId] : []);
  const [showTags, setShowTags] = useState(false);

  function toggleTag(id: string) {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    createTask(value, tags);
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
